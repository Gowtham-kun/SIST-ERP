const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const ERP_ORIGIN = 'https://erp.sathyabama.ac.in';

// ─── Direct ERP API Caller ────────────────────────────────────────────────────
async function erpPostDirect(endpoint, token, body = {}) {
  try {
    console.log(`[erpPostDirect] POST ${endpoint}`, JSON.stringify(body));
    const res = await fetch(`${ERP_ORIGIN}/erp/api/v1.0/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Access-Token': token
      },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    console.log(`[erpPostDirect] ${endpoint} -> ${res.status}:`, text.substring(0, 300));
    if (!res.ok) return null;
    try { return JSON.parse(text); } catch (_) { return null; }
  } catch (e) {
    console.log(`[erpPostDirect] ${endpoint} error:`, e.message);
    return null;
  }
}

// ─── Utility: find value in captured map by keyword list ─────────────────────
function findByKeywords(captured, keywords) {
  for (const kw of keywords) {
    for (const key of Object.keys(captured)) {
      if (key.toLowerCase().includes(kw.toLowerCase())) return captured[key];
    }
  }
  return null;
}

// ─── Utility: extract StudentId from any captured payload ────────────────────
function extractStudentId(captured) {
  for (const key of Object.keys(captured)) {
    const p = captured[key];
    if (!p || typeof p !== 'object') continue;
    const id = p?.responseData?.StudentInfo?.[0]?.StudentId
      || p?.responseData?.login?.StudentId
      || p?.responseData?.StudentId
      || p?.data?.StudentId
      || p?.StudentId;
    if (id) return id;
  }
  return 0;
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

  console.log(`[reconstructAttendance] Reconstructed: present=${totalPresent}, absent=${totalAbsent}, days=${totalDays}, pct=${overallPercentage}%`);

  return {
    overallPercentage,
    totalDays,
    totalPresent,
    totalAbsent,
    dailyLogs
  };
}

// ─── POST /api/login ──────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { regNumber, password } = req.body;
  if (!regNumber || !password)
    return res.status(400).json({ success: false, message: 'Register Number and Password are required.' });

  let browser;
  try {
    console.log('\n========================================================');
    console.log(`[Playwright] Starting session for ${regNumber}`);
    console.log('========================================================');

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    // ── Pre-register network response interceptor ────────────────────────
    const captured = {};
    page.on('response', async (response) => {
      const url = response.url();
      const ct  = response.headers()['content-type'] || '';
      if (!ct.includes('application/json') && !ct.includes('text/json')) return;
      try {
        const text = await response.text();
        if (!text || text.trim() === '') return;
        const json = JSON.parse(text);
        const urlObj  = new URL(url);
        const segs    = urlObj.pathname.split('/').filter(Boolean);
        const lastSeg = (segs[segs.length - 1] || '').toLowerCase();
        const last2   = segs.slice(-2).join('/').toLowerCase();
        captured[lastSeg] = json;
        captured[last2]   = json;
        captured[url]     = json;
        console.log(`[Intercept] ${last2} (${response.status()})`);
      } catch (_) {}
    });

    // ── STEP 1: Login page ────────────────────────────────────────────────
    console.log('[Playwright] Step 1: Navigating to login page...');
    await page.goto(`${ERP_ORIGIN}/account/login?returnUrl=%2F`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // ── STEP 2: Fill credentials & Submit ─────────────────────────────────
    console.log('[Playwright] Step 2: Filling credentials...');
    await page.locator([
      'input[id="RegisterNumber"]',
      'input[formcontrolname="RegisterNumber"]',
      'input[type="text"]'
    ].join(', ')).first().waitFor({ state: 'visible', timeout: 15000 });

    await page.locator([
      'input[id="RegisterNumber"]',
      'input[formcontrolname="RegisterNumber"]',
      'input[type="text"]'
    ].join(', ')).first().fill(regNumber);

    await page.locator('input[type="password"]').first().fill(password);

    console.log('[Playwright] Submitting login...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {}),
      page.locator('button[type="submit"], input[type="submit"]').first().click()
    ]);

    await page.waitForTimeout(3000);

    const postLoginUrl = page.url();
    console.log(`[Playwright] Post-login URL: ${postLoginUrl}`);
    if (postLoginUrl.includes('/account/login')) {
      await browser.close();
      return res.status(401).json({ success: false, message: 'Invalid Register Number or Password.' });
    }

    // ── STEP 3: Extract JWT Token & StudentId ─────────────────────────────
    const token = await page.evaluate(() => {
      const keys = ['Access-Token', 'access_token', 'token', 'authToken', 'jwt', 'bearer'];
      for (const k of keys) {
        const v = localStorage.getItem(k) || sessionStorage.getItem(k);
        if (v) return v;
      }
      const m = document.cookie.match(/(?:Access-Token|access_token|token)=([^;]+)/);
      return m ? decodeURIComponent(m[1]) : '';
    });
    console.log(`[Playwright] Token: ${token ? token.substring(0, 30) + '...' : 'NONE'}`);

    await page.waitForTimeout(2000);
    const studentId = extractStudentId(captured);
    console.log('[Playwright] Extracted StudentId:', studentId);

    // ── STEP 4: Switch to Attendance Tab on /student/view ──────────────────
    console.log('[Playwright] Step 4: Activating Attendance tab on /student/view...');
    try {
      const attTab = page.locator('#Student-Attendance-Details, #attendance-tab, a[href="#Student-Attendance-Details"], a[href="#attendance-tab"]').first();
      if (await attTab.isVisible({ timeout: 4000 }).catch(() => false)) {
        await attTab.click({ force: true });
        console.log('[Playwright] Clicked Attendance tab!');
        await page.waitForTimeout(1500);
      }
    } catch (e) {
      console.log('[Playwright] Tab click note:', e.message);
    }

    // ── STEP 5: Automatically Click the Search Button ─────────────────────
    console.log('[Playwright] Step 5: Locating & clicking Search button...');
    const searchBtn = page.locator('button:has-text("Search"), input[value="Search"], button.btn-info').first();
    try {
      if (await searchBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        console.log('[Playwright] Search button visible. Clicking...');
        const searchPromise = page.waitForResponse(
          r => r.url().toLowerCase().includes('studentdailyattendance') && r.status() === 200,
          { timeout: 10000 }
        ).catch(() => null);

        await searchBtn.click({ force: true });
        const resp = await searchPromise;
        if (resp) {
          try {
            captured['search_attendance_api'] = await resp.json();
            console.log('[Playwright] Intercepted Search response!');
          } catch (_) {}
        }
        await page.waitForTimeout(2000);
      }
    } catch (e) {
      console.log('[Playwright] Search button click note:', e.message);
    }

    // ── STEP 6: Scrape DOM Table if rendered ──────────────────────────────
    const domDailyLogs = await page.evaluate(() => {
      const logs = [];
      const seen = new Set();
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td')).map(c => (c.innerText || '').trim());
        if (cells.length >= 4) {
          const dateVal = cells[1];
          const dayVal = cells[2];
          const statusVal = cells[3];
          if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateVal) && !seen.has(dateVal)) {
            seen.add(dateVal);
            logs.push({
              sNo: parseInt(cells[0], 10) || (logs.length + 1),
              date: dateVal,
              day: dayVal || 'Working Day',
              status: /absent/i.test(statusVal) ? 'Absent' : 'Present'
            });
          }
        }
      }
      return logs;
    }).catch(() => []);

    if (domDailyLogs.length > 0) {
      console.log(`[Playwright] ✅ Scraped ${domDailyLogs.length} logs from DOM table!`);
      captured['dom_daily_logs'] = domDailyLogs;
    }

    await browser.close();

    // ── STEP 7: Direct API Fallbacks (using exact verified endpoints) ──────
    let profileRaw = findByKeywords(captured, ['masterstudent/view', 'masterstudent/login', 'view', 'login']);
    let attendanceRaw = findByKeywords(captured, ['search_attendance_api', 'studentdailyattendance', 'attendance']);
    let caeRaw = findByKeywords(captured, ['studentcaeresult', 'caeresult', 'cae']);

    if (!profileRaw && token) {
      profileRaw = await erpPostDirect('MasterStudent/view', token, {})
        || await erpPostDirect('MasterStudent/login', token, {});
    }

    // Always ensure attendance is fetched via verified API endpoint
    if (!attendanceRaw && token) {
      console.log('[ERP] Fetching Attendance via direct API (StudentDailyAttendance/StudentWiseAttendance)...');
      const sid = studentId || extractStudentId(captured);
      const attBody = {
        FromDate: '2026-07-01',
        ToDate: '2026-12-30',
        StudentId: sid
      };
      attendanceRaw = await erpPostDirect('StudentDailyAttendance/StudentWiseAttendance', token, attBody)
        || await erpPostDirect('StudentDailyAttendance/StudentWiseAttendance', token, { StudentId: sid });
    }

    // Direct API fallback for CAE Results
    if (!caeRaw && token) {
      console.log('[ERP] Fetching CAE via direct API fallback...');
      const prof = profileRaw?.responseData?.StudentInfo?.[0] || {};
      const caeBody = {
        RegisterNumber: regNumber,
        AcademicMonthId: prof.CurrentAcademicMonth || prof.AcademicMonthId || 0,
        AcademicYear: prof.CurrentAcademicYear || prof.AcademicYear || '2026-2027',
        Semester: prof.CurrentSemester || prof.Semester || 3
      };
      caeRaw = await erpPostDirect('CAEResult/studentCAEResult', token, caeBody)
        || await erpPostDirect('CAEResult/studentCAEResult', token, { StudentId: studentId })
        || await erpPostDirect('CAEResult/studentCAEResult', token, {});
    }

    const profile    = mapProfile(profileRaw);
    const attendance = mapAttendance(attendanceRaw, captured);
    const cae        = mapCAE(caeRaw);

    if (!profile.name || profile.name === '[404]') {
      return res.status(500).json({
        success: false,
        message: `Login succeeded but profile was empty. Keys: [${Object.keys(captured).join(', ')}].`
      });
    }

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
    if (browser) await browser.close().catch(() => {});
    console.error('[Scraper Error]', err.stack || err.message);
    return res.status(500).json({ success: false, message: `Scraper failed: ${err.message}` });
  }
});

// ─── Data Mappers ─────────────────────────────────────────────────────────────
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

// ─── Attendance mapper ────────────────────────────────────────────────────────
function mapAttendance(raw, captured) {
  // Priority 1: DOM-scraped rows if available and populated
  if (captured && Array.isArray(captured['dom_daily_logs']) && captured['dom_daily_logs'].length > 0) {
    const dailyLogs = captured['dom_daily_logs'];
    const totalPresent = dailyLogs.filter(d => d.status === 'Present').length;
    const totalAbsent  = dailyLogs.filter(d => d.status === 'Absent').length;
    const totalDays    = totalPresent + totalAbsent;
    const overallPercentage = totalDays > 0 ? parseFloat(((totalPresent / totalDays) * 100).toFixed(2)) : 0;
    const subjectWise  = captured['dom_subject_wise'] || [];
    console.log(`[mapAttendance] Using DOM logs: present=${totalPresent}, absent=${totalAbsent}, totalDays=${totalDays}`);
    return {
      overallPercentage,
      totalClasses: totalDays,
      attendedClasses: totalPresent,
      conductedClasses: totalDays,
      totalDays,
      totalPresent,
      totalAbsent,
      subjectWise,
      dailyLogs
    };
  }

  // Priority 2: Reconstruct from StudentDailyAttendance/StudentWiseAttendance response
  const respData = raw?.responseData || raw?.data || raw;
  if (respData?.AttendanceDetails || respData?.ActualWorkingDays) {
    const recon = reconstructAttendance(respData);
    if (recon && recon.dailyLogs.length > 0) {
      console.log(`[mapAttendance] Successfully reconstructed from API payload: ${recon.dailyLogs.length} days`);
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

  // Priority 3: Search any other captured attendance payloads
  if (captured && typeof captured === 'object') {
    for (const k of Object.keys(captured)) {
      if (k.toLowerCase().includes('attendance') || k.toLowerCase().includes('report')) {
        const payload = captured[k];
        const rData = payload?.responseData || payload?.data || payload;
        if (rData?.AttendanceDetails || rData?.ActualWorkingDays) {
          const recon = reconstructAttendance(rData);
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
      }
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

// ─── CAE mapper ───────────────────────────────────────────────────────────────
function mapCAE(raw) {
  if (!raw) return { cgpa: '', currentGpa: '', cae1: [], cae2: [], arrearDetails: { totalArrears: 0, clearedArrears: 0, history: [] } };
  const list = raw?.responseData || raw?.data || (Array.isArray(raw) ? raw : null) || [];
  const rows = Array.isArray(list) ? list : [];
  const toRow = r => ({
    code:          r.subjectCode || r.SubjectCode || r.SubCode || '',
    name:          r.subjectTitle || r.SubjectTitle || r.Subject || '',
    maxMarks:      Number(r.maxMarks || r.MaxMarks || r.Max || 50),
    marksObtained: Number(r.marksObtained || r.MarksObtained || r.Obtained || 0),
    status:        r.result || r.Result || r.Status || ''
  });
  const cae1  = rows.filter(r => Number(r.cae || r.CAE || r.CaeNo || r.ExamNo || 0) === 1).map(toRow);
  const cae2  = rows.filter(r => Number(r.cae || r.CAE || r.CaeNo || r.ExamNo || 0) === 2).map(toRow);
  const fails = cae1.filter(r => r.status === 'FAIL').map(r => r.code);
  return { cgpa: '', currentGpa: '', cae1, cae2, arrearDetails: { totalArrears: fails.length, clearedArrears: 0, history: fails } };
}

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('====================================================');
  console.log('🚀 Sathyabama ERP Playwright Scraper running at:');
  console.log(`👉 http://localhost:${PORT}`);
  console.log('====================================================');
});
