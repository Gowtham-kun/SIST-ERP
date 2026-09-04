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
      'Accept': 'application/json, text/plain, */*'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['Access-Token'] = token;
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

function mapProfile(raw) {
  if (!raw) return buildEmptyProfile();
  const si   = raw?.responseData?.StudentInfo?.[0];
  const li   = raw?.responseData?.login;
  const flat = raw?.responseData?.student || raw?.responseData
    || raw?.data || (Array.isArray(raw?.responseData) ? raw.responseData[0] : null) || raw;
  const d = si || li || flat || {};
  if (!d || typeof d !== 'object') return buildEmptyProfile();

  const fmtDate = iso => {
    if (!iso) return '[404]';
    try { const p = String(iso).split('T')[0].split('-'); if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`; } catch (_) {}
    return cleanVal(iso);
  };

  const currYear = d.CurrentYear || d.YearofStudy || d.Year;
  const acadYear = d.CurrentAcademicYear;
  const yearDisplay = (currYear && acadYear) ? `${currYear} (${acadYear})` : cleanVal(currYear || acadYear);

  return {
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

function buildEmptyProfile() {
  const E = '[404]';
  return {
    name: E, regNo: E, rollNumber: E, programme: E, department: E,
    email: E, dob: E, mobile: E, age: E, batch: E, semester: E,
    yearDisplay: E, section: E, school: E, gender: E, bloodGroup: E,
    medicalHistory: E, nativeState: E, height: E, nationality: E,
    religion: E, community: E, motherTongue: E, stayedInHostel: E, nativePlace: E,
    weight: E, aadhaar: E, motherName: E, studentMobile: E, studentEmail: E,
    firstGraduate: E, extraCurricular: E, isPwd: E, fatherName: E, fatherSubtitle: E,
    fatherOccupation: E, fatherOfficeDesignation: E, fatherAnnualIncome: E, fatherAadhaar: E,
    fatherEmail: E, fatherMobile: E, motherSubtitle: E, motherOccupation: E,
    motherOfficeDesignation: E, motherAnnualIncome: E, motherAadhaar: E, motherEmail: E,
    motherMobile: E, siblings: []
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

// ─── Core Login & Data Retrieval Handler (Pure REST API) ──────────────────────
async function loginHandler(req, res) {
  const { regNumber, password } = req.body || {};
  if (!regNumber || !password) {
    return res.status(400).json({ success: false, message: 'Register Number and Password are required.' });
  }

  const startTime = Date.now();
  console.log(`[REST-Auth] Authenticating student ${regNumber}...`);

  try {
    // 1. Direct login to Sathyabama ERP API
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

    console.log(`[REST-Auth] Token acquired. StudentId: ${studentId}. Fetching profile and attendance in parallel...`);

    // 2. Fetch Profile and Attendance concurrently
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth() + 1;
    // Current academic term date range
    const fromDate = curMonth >= 6 ? `${curYear}-06-01` : `${curYear}-01-01`;
    const toDate   = curMonth >= 6 ? `${curYear}-12-31` : `${curYear}-06-30`;

    const [profileRaw, attendanceRaw] = await Promise.all([
      erpPostDirect('MasterStudent/view', token, {}),
      erpPostDirect('StudentDailyAttendance/StudentWiseAttendance', token, {
        FromDate: fromDate,
        ToDate: toDate,
        StudentId: studentId
      })
    ]);

    // 3. Fetch CAE Results using profile details
    const studentInfo = profileRaw?.responseData?.StudentInfo?.[0] || {};
    const caeBody = {
      RegisterNumber: regNumber,
      AcademicMonthId: studentInfo.CurrentAcademicMonth || studentInfo.AcademicMonthId || 2,
      AcademicYear: studentInfo.CurrentAcademicYear || studentInfo.AcademicYear || `${curYear}-${curYear + 1}`,
      Semester: studentInfo.CurrentSemester || studentInfo.Semester || 3
    };

    const caeRaw = await erpPostDirect('CAEResult/studentCAEResult', token, caeBody);

    // 4. Map data with full fidelity to existing frontend contract
    const profile    = mapProfile(profileRaw || loginData);
    const attendance = mapAttendance(attendanceRaw);
    const cae        = mapCAE(caeRaw);

    const elapsed = Date.now() - startTime;
    console.log(`[REST-Auth] ✅ Completed for ${regNumber} in ${elapsed}ms. Attendance: ${attendance.totalDays} days (${attendance.overallPercentage}%).`);

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

// ─── API Routes (Compatible with both local Express and Vercel Serverless) ─────
app.post('/api/login', loginHandler);
app.post('/login', loginHandler);

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
