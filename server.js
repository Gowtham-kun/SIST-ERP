const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const ERP_ORIGIN = 'https://erp.sathyabama.ac.in';

// ─── Direct ERP API Caller (Fast REST HTTP) ──────────────────────────────────
async function erpPostDirect(endpoint, token = null, body = {}) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Origin': ERP_ORIGIN,
      'Referer': `${ERP_ORIGIN}/student/view`
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['Access-Token'] = token;
      headers['Token'] = token;
    }

    const res = await fetch(`${ERP_ORIGIN}/erp/api/v1.0/${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000)
    });

    if (!res.ok) {
      console.log(`[ERP-API] ${endpoint} returned HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data;
  } catch (e) {
    console.log(`[ERP-API] ${endpoint} error:`, e.message);
    return null;
  }
}

// ─── Attendance Reconstruction (Exact match of official ERP Angular logic) ───
function reconstructAttendance(respData, fromDateStr = '2026-07-01', toDateStr = '2026-12-30') {
  if (!respData) return null;
  const m = respData.AttendanceDetails || [];
  const s = respData.HolidayList || [];
  const c = respData.TimetableDetails || {};
  const timeSetDays = (c.TimeSetDays || '1,2,3,4,5').split(',').map(x => x.trim());
  const u = respData.ActualWorkingDays || [];

  const absentSet = new Set(m.map(x => (x.AttendanceDate || '').trim()));
  const holidayMap = new Map(s.map(x => [(x.HoliDay || '').trim(), x.Comments || 'Holiday']));
  const actualWorkList = u.map(x => (x.Date || '').trim()).filter(Boolean);

  const dailyLogs = [];
  let totalPresent = 0;
  let totalAbsent = 0;

  const now = new Date();
  const todayTime = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  if (actualWorkList.length > 0) {
    for (const isoDate of actualWorkList) {
      const parts = isoDate.split('-');
      if (parts.length !== 3) continue;
      const y = parseInt(parts[0], 10);
      const mNum = parseInt(parts[1], 10);
      const dNum = parseInt(parts[2], 10);

      const dTime = new Date(y, mNum - 1, dNum).getTime();
      const dmyDate = `${String(dNum).padStart(2, '0')}/${String(mNum).padStart(2, '0')}/${y}`;

      if (absentSet.has(dmyDate)) {
        totalAbsent++;
        dailyLogs.push({
          sNo: dailyLogs.length + 1,
          date: dmyDate,
          day: 'Working Day',
          status: 'Absent'
        });
      } else if (holidayMap.has(dmyDate)) {
        // Holiday - skip
      } else if (dTime > todayTime) {
        // Future date - skip
      } else if (dTime === todayTime) {
        if (now.getHours() >= 15) {
          totalPresent++;
          dailyLogs.push({
            sNo: dailyLogs.length + 1,
            date: dmyDate,
            day: 'Working Day',
            status: 'Present'
          });
        }
      } else {
        totalPresent++;
        dailyLogs.push({
          sNo: dailyLogs.length + 1,
          date: dmyDate,
          day: 'Working Day',
          status: 'Present'
        });
      }
    }
  } else {
    // Fallback: loop day by day
    const startParts = fromDateStr.split('-').map(Number);
    const endParts = toDateStr.split('-').map(Number);
    const start = new Date(startParts[0], startParts[1] - 1, startParts[2]);
    const end = new Date(endParts[0], endParts[1] - 1, endParts[2]);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = String(d.getDay());
      if (!timeSetDays.includes(dayOfWeek)) continue;

      const y = d.getFullYear();
      const mStr = String(d.getMonth() + 1).padStart(2, '0');
      const dayStr = String(d.getDate()).padStart(2, '0');
      const dmyDate = `${dayStr}/${mStr}/${y}`;
      const dTime = new Date(y, d.getMonth(), d.getDate()).getTime();

      if (dTime > todayTime) continue;

      if (absentSet.has(dmyDate)) {
        totalAbsent++;
        dailyLogs.push({
          sNo: dailyLogs.length + 1,
          date: dmyDate,
          day: 'Working Day',
          status: 'Absent'
        });
      } else if (!holidayMap.has(dmyDate)) {
        totalPresent++;
        dailyLogs.push({
          sNo: dailyLogs.length + 1,
          date: dmyDate,
          day: 'Working Day',
          status: 'Present'
        });
      }
    }
  }

  const totalDays = totalPresent + totalAbsent;
  const overallPercentage = totalDays > 0 ? parseFloat(((totalPresent / totalDays) * 100).toFixed(2)) : 0;

  return {
    overallPercentage,
    totalDays,
    totalPresent,
    totalAbsent,
    dailyLogs
  };
}

// ─── Data Cleaners & Mappers ──────────────────────────────────────────────────
function cleanVal(v) {
  if (v === null || v === undefined) return '[404]';
  const s = String(v).trim();
  if (!s || s === 'null' || s === 'undefined' || s === '-') return '[404]';
  return s;
}

function mapProfile(raw, fallbackLogin = null) {
  const si   = raw?.responseData?.StudentInfo?.[0] || raw?.StudentInfo?.[0];
  const li   = fallbackLogin?.responseData?.login || raw?.responseData?.login;
  const flat = raw?.responseData?.student || raw?.responseData
    || raw?.data || (Array.isArray(raw?.responseData) ? raw.responseData[0] : null) || raw;
  
  // Merge source objects: primary is si, secondary is li
  const d = Object.assign({}, li || {}, flat || {}, si || {});

  const fmtDate = iso => {
    if (!iso) return '[404]';
    try { const p = String(iso).split('T')[0].split('-'); if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`; } catch (_) {}
    return cleanVal(iso);
  };

  const currYear = d.CurrentYear || d.YearofStudy || d.Year;
  const acadYear = d.CurrentAcademicYear;
  const yearDisplay = (currYear && acadYear) ? `${currYear} (${acadYear})` : cleanVal(currYear || acadYear);

  return {
    _raw:                    d,
    name:                    cleanVal(d.StudentName || d.NAME || d.name),
    regNo:                   cleanVal(d.RegisterNumber || d.registerNumber || d.regno || d.RegNo),
    rollNumber:              cleanVal(d.RollNumber || d.RollNo),
    programme:               cleanVal(d.ProgrammeName || d.DepartmentName || d.branch || d.Branch),
    department:              cleanVal(d.DepartmentName || d.ProgrammeName || d.branch || d.Branch),
    email:                   cleanVal(d.Email || d.StudentEmail || d.email),
    dob:                     fmtDate(d.DateOfBirth || d.DOB || d.dob),
    mobile:                  cleanVal(d.MobileNumber || d.StudentMobileNo || d.mobile || d.Mobile),
    age:                     cleanVal(d.Age || d.age),
    batch:                   cleanVal(d.Batch || d.batch),
    semester:                cleanVal(d.Semester || d.CurrentSemester || d.semester),
    yearDisplay,
    section:                 cleanVal(d.SectionName || d.Section || d.section),
    school:                  cleanVal(d.SchoolName || d.schoolName || d.School),
    gender:                  d.Gender === 1 ? 'Male' : (d.Gender === 2 ? 'Female' : cleanVal(d.Gender)),
    bloodGroup:              cleanVal(d.BloodGroup),
    medicalHistory:          cleanVal(d.MedicalHistory),
    nativeState:             cleanVal(d.NativeState || d.StateName),
    height:                  cleanVal(d.Height),
    nationality:             cleanVal(d.Nationality),
    religion:                cleanVal(d.Religion),
    community:               cleanVal(d.Community),
    motherTongue:            cleanVal(d.MotherTongue),
    stayedInHostel:          (d.HostelTypeId !== undefined && d.HostelTypeId !== 0) || d.Hostel ? 'Yes' : (d.HostelTypeId === 0 ? 'No' : '[404]'),
    nativePlace:             cleanVal(d.NativePlace),
    weight:                  cleanVal(d.Weight),
    aadhaar:                 cleanVal(d.AadhaarNo || d.Aadhaar || d.aadhaarNo),
    motherName:              cleanVal(d.MotherName),
    studentMobile:           cleanVal(d.MobileNumber || d.StudentMobileNo || d.Mobile),
    studentEmail:            cleanVal(d.Email || d.StudentEmail || d.email),
    firstGraduate:           d.FirstGraduate === 1 ? 'Yes' : (d.FirstGraduate === 0 ? 'No' : cleanVal(d.FirstGraduate)),
    extraCurricular:         cleanVal(d.ExtraCurricular),
    isPwd:                   d.IsPWD === 1 ? 'Yes' : (d.IsPWD === 0 ? 'No' : cleanVal(d.IsPWD)),
    fatherName:              cleanVal(d.FatherName),
    fatherSubtitle:          cleanVal(d.FatherMobileNo || d.FatherMobile),
    fatherOccupation:        cleanVal(d.FatherOccupation && d.FatherOccupation !== '3' ? d.FatherOccupation : null),
    fatherOfficeDesignation: cleanVal(d.FatherOfficeDesignation),
    fatherAnnualIncome:      cleanVal(d.FatherAnnualIncome),
    fatherAadhaar:           cleanVal(d.FatherAadhar || d.FatherAadhaarNo),
    fatherEmail:             cleanVal(d.FatherOfficeEmail || d.FatherEmail),
    fatherMobile:            cleanVal(d.FatherMobileNo || d.FatherMobile),
    motherSubtitle:          cleanVal(d.MotherMobileNo || d.MotherMobile),
    motherOccupation:        cleanVal(d.MotherOccupation),
    motherOfficeDesignation: cleanVal(d.MotherOfficeDesignation),
    motherAnnualIncome:      cleanVal(d.MotherAnnualIncome),
    motherAadhaar:           cleanVal(d.MotherAadhar || d.MotherAadhaarNo),
    motherEmail:             cleanVal(d.MotherOfficeEmail || d.MotherEmail),
    motherMobile:            cleanVal(d.MotherMobileNo || d.MotherMobile),
    siblings: []
  };
}

// ─── Attendance Mapper ────────────────────────────────────────────────────────
function mapAttendance(raw) {
  const respData = raw?.responseData || raw?.data || raw;
  if (respData?.AttendanceDetails || respData?.ActualWorkingDays) {
    const recon = reconstructAttendance(respData);
    if (recon && recon.dailyLogs.length > 0) {
      return {
        overallPercentage: recon.overallPercentage,
        totalClasses: recon.totalDays,
        attendedClasses: recon.totalPresent,
        conductedClasses: recon.totalDays,
        totalDays: recon.totalDays,
        totalPresent: recon.totalPresent,
        totalAbsent: recon.totalAbsent,
        subjectWise: [],
        dailyLogs: recon.dailyLogs
      };
    }
  }

  return {
    overallPercentage: 0,
    totalClasses: 0,
    attendedClasses: 0,
    conductedClasses: 0,
    totalDays: 0,
    totalPresent: 0,
    totalAbsent: 0,
    subjectWise: [],
    dailyLogs: []
  };
}

// ─── CAE Mapper ───────────────────────────────────────────────────────────────
function mapCAE(raw) {
  if (!raw) return { cgpa: '', currentGpa: '', cae1: [], cae2: [], arrearDetails: { totalArrears: 0, clearedArrears: 0, history: [] } };
  const list = raw?.responseData || raw?.data || (Array.isArray(raw) ? raw : null) || [];
  const rows = Array.isArray(list) ? list : [];
  const toRow = r => ({
    code:          r.subjectCode || r.SubjectCode || r.SubCode || '',
    name:          r.subjectTitle || r.SubjectTitle || r.Subject || r.SubjectName || '',
    maxMarks:      Number(r.maxMarks || r.MaxMarks || r.Max || 50),
    marksObtained: Number(r.marksObtained || r.MarksObtained || r.Marks || r.marks || r.Obtained || 0),
    status:        r.result || r.Result || r.Status || ''
  });
  const cae1  = rows.filter(r => Number(r.cae || r.CAE || r.CaeNo || r.ExamNo || r.CAEType || 0) === 1).map(toRow);
  const cae2  = rows.filter(r => Number(r.cae || r.CAE || r.CaeNo || r.ExamNo || r.CAEType || 0) === 2).map(toRow);
  const fails = cae1.filter(r => r.status === 'FAIL').map(r => r.code);
  return { cgpa: '', currentGpa: '', cae1, cae2, arrearDetails: { totalArrears: fails.length, clearedArrears: 0, history: fails } };
}

// ─── Modular Scraper: Student Profile ─────────────────────────────────────────
async function scrapeProfile(token, studentId, regNumber, loginData = null) {
  console.log(`[ProfileScraper] Fetching profile for student ${regNumber} (ID: ${studentId})...`);
  const sid = Number(studentId) || 0;

  // Attempt 1: MasterStudent/view with { StudentId: sid } (exact ERP payload)
  let raw = await erpPostDirect('MasterStudent/view', token, { StudentId: sid });
  if (raw?.responseData?.StudentInfo?.[0]) {
    console.log('[ProfileScraper] ✅ Retrieved via MasterStudent/view');
    return mapProfile(raw, loginData);
  }

  // Attempt 2: MasterStudent/view with { StudentId: sid, RegisterNumber: regNumber }
  raw = await erpPostDirect('MasterStudent/view', token, { StudentId: sid, RegisterNumber: regNumber });
  if (raw?.responseData?.StudentInfo?.[0]) {
    console.log('[ProfileScraper] ✅ Retrieved via MasterStudent/view (with RegNo)');
    return mapProfile(raw, loginData);
  }

  // Attempt 3: MasterStudent/getstudentbystudentid with { StudentId: sid }
  raw = await erpPostDirect('MasterStudent/getstudentbystudentid', token, { StudentId: sid });
  if (raw?.responseData?.StudentInfo?.[0] || raw?.responseData?.[0]) {
    console.log('[ProfileScraper] ✅ Retrieved via MasterStudent/getstudentbystudentid');
    return mapProfile(raw, loginData);
  }

  // Attempt 4: MasterStudent/getStudentInfoForCerificateGeneration with { SearchNumber: regNumber }
  raw = await erpPostDirect('MasterStudent/getStudentInfoForCerificateGeneration', token, { SearchNumber: regNumber });
  if (raw?.responseData?.StudentInfo) {
    console.log('[ProfileScraper] ✅ Retrieved via getStudentInfoForCerificateGeneration');
    const info = Array.isArray(raw.responseData.StudentInfo) ? raw.responseData.StudentInfo[0] : raw.responseData.StudentInfo;
    return mapProfile({ responseData: { StudentInfo: [info] } }, loginData);
  }

  console.log('[ProfileScraper] ⚠️ Falling back to login data for profile fields');
  return mapProfile(loginData, loginData);
}

// ─── Modular Scraper: Attendance ──────────────────────────────────────────────
async function scrapeAttendance(token, studentId) {
  console.log(`[AttendanceScraper] Fetching attendance for StudentId: ${studentId}...`);
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const fromDate = curMonth >= 6 ? `${curYear}-06-01` : `${curYear}-01-01`;
  const toDate   = curMonth >= 6 ? `${curYear}-12-31` : `${curYear}-06-30`;

  let raw = await erpPostDirect('StudentDailyAttendance/StudentWiseAttendance', token, {
    FromDate: fromDate,
    ToDate: toDate,
    StudentId: Number(studentId)
  });

  // Fallback to standard semester term if dynamic range had no working days
  if (!raw?.responseData?.ActualWorkingDays?.length) {
    raw = await erpPostDirect('StudentDailyAttendance/StudentWiseAttendance', token, {
      FromDate: `${curYear}-07-01`,
      ToDate: `${curYear}-12-30`,
      StudentId: Number(studentId)
    }) || raw;
  }

  return mapAttendance(raw);
}

// ─── Modular Scraper: CAE Results ─────────────────────────────────────────────
async function scrapeCAEResults(token, regNumber, profile) {
  console.log(`[CAEScraper] Fetching CAE marks for ${regNumber}...`);
  const now = new Date();
  const curYear = now.getFullYear();

  const caeBody = {
    RegisterNumber: regNumber,
    AcademicMonthId: profile?._raw?.CurrentAcademicMonth || profile?._raw?.AcademicMonthId || 2,
    AcademicYear: profile?._raw?.CurrentAcademicYear || profile?._raw?.AcademicYear || `${curYear}-${curYear + 1}`,
    Semester: profile?._raw?.CurrentSemester || profile?.semester || 3
  };

  const raw = await erpPostDirect('CAEResult/studentCAEResult', token, caeBody);
  return mapCAE(raw);
}

// ─── Core Login & Data Retrieval Handler (Orchestrator) ───────────────────────
async function loginHandler(req, res) {
  const { regNumber, password } = req.body || {};
  if (!regNumber || !password) {
    return res.status(400).json({ success: false, message: 'Register Number and Password are required.' });
  }

  const startTime = Date.now();
  console.log(`[REST-Auth] Authenticating student ${regNumber}...`);

  try {
    // 1. Authenticate with ERP API
    const loginData = await erpPostDirect('MasterStudent/login', null, {
      RegisterNumber: regNumber,
      Password: password
    });

    if (!loginData || loginData.status !== true) {
      const errorMsg = loginData?.message || 'Invalid Register Number or Password.';
      console.log(`[REST-Auth] Authentication failed for ${regNumber}: ${errorMsg}`);
      return res.status(401).json({ success: false, message: errorMsg });
    }

    const loginObj = loginData?.responseData?.login || {};
    const token = loginObj.accessToken || loginData?.responseData?.accessToken || '';
    const studentId = loginObj.StudentId || loginData?.responseData?.StudentId || 0;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Login succeeded on ERP, but no access token was returned.'
      });
    }

    console.log(`[REST-Auth] Token acquired for ${regNumber} (StudentId: ${studentId}). Running modular scrapers...`);

    // 2. Fetch Profile and Attendance using dedicated scrapers concurrently
    const [profile, attendance] = await Promise.all([
      scrapeProfile(token, studentId, regNumber, loginData),
      scrapeAttendance(token, studentId)
    ]);

    // 3. Fetch CAE Results using profile details
    const cae = await scrapeCAEResults(token, regNumber, profile);

    const elapsed = Date.now() - startTime;
    console.log(`[REST-Auth] ✅ All data scraped for ${regNumber} in ${elapsed}ms. Attendance: ${attendance.totalDays} days (${attendance.overallPercentage}%).`);

    return res.json({
      success: true,
      token,
      student: {
        name: profile.name,
        regNo: profile.regNo,
        department: profile.department,
        semester: profile.semester,
        section: profile.section
      },
      data: {
        studentDetails: profile,
        attendanceSummary: attendance,
        caeResults: cae
      }
    });

  } catch (err) {
    console.error('[REST-Auth Error]', err.stack || err.message);
    return res.status(500).json({ success: false, message: `Server error: ${err.message}` });
  }
}

// ─── API Routes ───────────────────────────────────────────────────────────────
app.post('/api/login', loginHandler);
app.post('/login', loginHandler);

// Individual scrapers accessible directly if needed
app.post('/api/profile', async (req, res) => {
  const { token, studentId, regNumber } = req.body || {};
  if (!token) return res.status(401).json({ success: false, message: 'Token required' });
  const profile = await scrapeProfile(token, studentId, regNumber);
  res.json({ success: true, profile });
});

app.post('/api/attendance', async (req, res) => {
  const { token, studentId } = req.body || {};
  if (!token) return res.status(401).json({ success: false, message: 'Token required' });
  const attendance = await scrapeAttendance(token, studentId);
  res.json({ success: true, attendance });
});

app.post('/api/cae', async (req, res) => {
  const { token, regNumber, profile } = req.body || {};
  if (!token) return res.status(401).json({ success: false, message: 'Token required' });
  const cae = await scrapeCAEResults(token, regNumber, profile);
  res.json({ success: true, cae });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// Export app for Vercel Serverless Functions
module.exports = app;

// Start local server if executed directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log('====================================================');
    console.log(`🚀 Sathyabama ERP Pure REST Server running at:`);
    console.log(`👉 http://localhost:${PORT}`);
    console.log('====================================================');
  });
}
