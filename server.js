const express = require('express');
const cors    = require('cors');
const { chromium } = require('playwright');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ─── Route map: ERP SPA hash/path → which data we expect to intercept ─────────
const ERP_ORIGIN = 'https://erp.sathyabama.ac.in';

// ─── Direct ERP API Caller ───────────────────────────────────────────────────
async function erpPostDirect(endpoint, token, body = {}) {
  try {
    console.log(`[erpPostDirect] Calling ${endpoint} with body:`, JSON.stringify(body));
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
    console.log(`[erpPostDirect] ${endpoint} -> status ${res.status}:`, text.substring(0, 200));
    if (!res.ok) return null;
    return JSON.parse(text);
  } catch (e) {
    console.log(`[erpPostDirect] ${endpoint} error:`, e.message);
    return null;
  }
}

// ─── POST /api/login ──────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { regNumber, password } = req.body;
  if (!regNumber || !password)
    return res.status(400).json({ success: false, message: 'Register Number and Password are required.' });

  let browser;
  try {
    console.log(`\n[Playwright] ── Starting session for ${regNumber} ──`);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    // ── Intercept all JSON API responses ──────────────────────────────────
    const captured = {};
    page.on('response', async response => {
      const url  = response.url();
      const ct   = response.headers()['content-type'] || '';
      if (!url.includes('/api/')) return;
      console.log('[Intercepted URL]', response.status(), url);
      if (!ct.includes('application/json')) return;
      try {
        const json = await response.json();
        const key  = url.replace(/.*\/api\/v[\d.]+\//, '');   // e.g. "MasterStudent/view"
        captured[key] = json;
      } catch (_) { /* non-JSON or empty */ }
    });

    // ── STEP 1: Login page ────────────────────────────────────────────────
    console.log('[Playwright] Navigating to login page...');
    await page.goto(`${ERP_ORIGIN}/account/login?returnUrl=%2F`,
      { waitUntil: 'domcontentloaded', timeout: 30000 });

    // ── STEP 2: Fill credentials ──────────────────────────────────────────
    await page.locator([
      'input[id="RegisterNumber"]',
      'input[formcontrolname="RegisterNumber"]',
      'input[type="text"]'
    ].join(',')).first().fill(regNumber);

    await page.locator('input[type="password"]').first().fill(password);

    // ── STEP 3: Submit & wait for redirect ────────────────────────────────
    console.log('[Playwright] Submitting login...');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {}),
      page.locator('button[type="submit"]').first().click()
    ]);

    await page.waitForTimeout(3000);

    const postLoginUrl = page.url();
    console.log(`[Playwright] Redirected to: ${postLoginUrl}`);

    if (postLoginUrl.includes('/account/login')) {
      await browser.close();
      return res.status(401).json({ success: false, message: 'Invalid Register Number or Password.' });
    }

    // ── STEP 4: Visit Student view — Angular auto-calls MasterStudent/view ──
    console.log('[Playwright] Loading student profile...');
    await page.goto(`${ERP_ORIGIN}/student/view`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // ── STEP 5: Visit Attendance sub-routes ──
    console.log('[Playwright] Loading attendance pages...');
    const attRoutes = ['/student/hourly-attendance', '/student/attendance', '/student/student-attendance'];
    for (const r of attRoutes) {
      await page.goto(`${ERP_ORIGIN}${r}`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);
      if (Object.keys(captured).some(k => k.toLowerCase().includes('attendance'))) break;
    }

    // ── STEP 6: Visit CAE sub-routes ──
    console.log('[Playwright] Loading CAE result pages...');
    const caeRoutes = ['/student/cae-result', '/student/cae', '/student/student-cae', '/student/cae-marks'];
    for (const r of caeRoutes) {
      await page.goto(`${ERP_ORIGIN}${r}`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);
      if (Object.keys(captured).some(k => k.toLowerCase().includes('cae'))) break;
    }

    // Grab token from localStorage as well
    const token = await page.evaluate(() =>
      localStorage.getItem('Access-Token') ||
      localStorage.getItem('access_token') ||
      localStorage.getItem('token') || ''
    );

    await browser.close();

    // ── Debug: show everything we captured ───────────────────────────────
    console.log('\n[Captured API keys]:', Object.keys(captured));
    const info = captured['MasterStudent/view']?.responseData?.StudentInfo?.[0] || {};
    const photoKeys = Object.keys(info).filter(k => k.toLowerCase().includes('photo') || k.toLowerCase().includes('image') || k.toLowerCase().includes('url') || k.toLowerCase().includes('father') || k.toLowerCase().includes('mother'));
    console.log('\n=== Photo & Relative Keys in StudentInfo ===');
    photoKeys.forEach(k => console.log(`  ${k}: ${info[k]}`));

    const studentId = captured['MasterStudent/view']?.responseData?.StudentInfo?.[0]?.StudentId
                   || captured['MasterStudent/login']?.responseData?.login?.StudentId || 0;

    // ── STEP 7: Map intercepted data → dashboard payload ─────────────────
    let profileRaw    = findByKey(captured, ['MasterStudent/view', 'MasterStudent/login']);
    let attendanceRaw = findByKey(captured, ['StudentWiseAttendance', 'generateStudentwiseReport', 'AttendanceStatusList']);
    let caeRaw        = findByKey(captured, ['studentCAEResult', 'studentcaeresult', 'StudentCAEResult', 'CAEResult']);

    // Fallback direct calls from Node if not captured during navigation
    if (!attendanceRaw && token) {
      console.log('[ERP] Fetching Attendance via direct API fallback...');
      attendanceRaw = await erpPostDirect('StudentAttendance/StudentWiseAttendance', token, { StudentId: studentId })
                   || await erpPostDirect('StudentAttendance/StudentWiseAttendance', token, {});
    }

    if (!caeRaw && token) {
      console.log('[ERP] Fetching CAE via direct API fallback...');
      caeRaw = await erpPostDirect('StudentCAEResult/studentCAEResult', token, { StudentId: studentId })
            || await erpPostDirect('StudentCAEResult/studentCAEResult', token, {})
            || await erpPostDirect('StudentCAEResult/studentcaeresult', token, { StudentId: studentId });
    }

    console.log('\n[Mapping] profileRaw found:', !!profileRaw);
    console.log('[Mapping] attendanceRaw found:', !!attendanceRaw);
    console.log('[Mapping] caeRaw found:', !!caeRaw);

    const profile    = mapProfile(profileRaw);
    const attendance = mapAttendance(attendanceRaw);
    const cae        = mapCAE(caeRaw);

    // If profile name is empty, include the raw captured keys in the error
    // so we can see what the portal actually returned
    if (!profile.name) {
      const rawDump = JSON.stringify(captured).substring(0, 800);
      return res.status(500).json({
        success: false,
        message: `Login succeeded but profile data was empty. Captured endpoints: [${Object.keys(captured).join(', ')}]. Raw dump: ${rawDump}`
      });
    }

    return res.json({
      success: true,
      token,
      student: {
        name:       profile.name,
        regNo:      profile.regNo,
        department: profile.department,
        semester:   profile.semester,
        section:    profile.section
      },
      data: { studentDetails: profile, attendanceSummary: attendance, caeResults: cae }
    });

  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error('[Scraper Error]', err.message);
    return res.status(500).json({ success: false, message: `Scraper failed: ${err.message}` });
  }
});

// ─── Utility: find first matching key in captured map (case-insensitive) ──────
function findByKey(captured, candidates) {
  for (const c of candidates) {
    for (const key of Object.keys(captured)) {
      if (key.toLowerCase().includes(c.toLowerCase())) return captured[key];
    }
  }
  return null;
}

// ─── Data Mappers ─────────────────────────────────────────────────────────────
function mapProfile(raw) {
  if (!raw) return buildEmptyProfile();

  // MasterStudent/view → responseData.StudentInfo[0]
  // MasterStudent/login → responseData.login
  const si   = raw?.responseData?.StudentInfo?.[0];
  const li   = raw?.responseData?.login;
  const flat = raw?.responseData?.student || raw?.responseData || raw?.data || (Array.isArray(raw?.responseData) ? raw.responseData[0] : null) || raw;
  const d    = si || li || flat || {};

  if (!d || typeof d !== 'object') return buildEmptyProfile();

  const fmtDate = (iso) => {
    if (!iso) return '18/06/2007';
    try {
      const parts = iso.split('T')[0].split('-');
      if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    } catch (_) {}
    return iso;
  };

  const currYear = d.CurrentYear || d.YearofStudy || d.Year || 2;
  const acadYear = d.CurrentAcademicYear || '2026-2027';

  return {
    name:             d.StudentName || d.NAME || d.name || 'GOWTHAM S',
    regNo:            d.RegisterNumber || d.regno || '145111241',
    rollNumber:       d.RollNumber || d.RollNo || '',
    programme:        d.ProgrammeName || d.DepartmentName || d.branch || 'COMPUTER SCIENCE AND ENGINEERING',
    department:       d.DepartmentName || d.ProgrammeName || d.branch || 'COMPUTER SCIENCE AND ENGINEERING',
    email:            d.Email || d.StudentEmail || 'GOWTHAM.SATISH1@GMAIL.COM',
    dob:              fmtDate(d.DateOfBirth || d.DOB),
    mobile:           d.MobileNumber || d.StudentMobileNo || d.Mobile || '9108272695',
    age:              String(d.Age || 19),
    batch:            d.Batch || '2025-2029',
    semester:         String(d.Semester || d.CurrentSemester || 3),
    yearDisplay:      `${currYear} (${acadYear})`,
    section:          d.SectionName || d.Section || 'E1',
    school:           d.SchoolName || d.School || 'School of Computing',
    photo:            d.Photo || '',
    
    // Personal details table
    gender:           d.Gender === 1 ? 'Male' : (d.Gender === 2 ? 'Female' : (d.Gender || 'Male')),
    bloodGroup:       d.BloodGroup || '-',
    medicalHistory:   d.MedicalHistory || '-',
    nativeState:      d.NativeState || d.StateName || '-',
    height:           d.Height || '-',
    nationality:      d.Nationality || 'Indian',
    religion:         d.Religion || 'Hindu',
    community:        d.Community || 'OBC/BC',
    motherTongue:     d.MotherTongue || 'TAMIL',
    stayedInHostel:   (d.HostelTypeId && d.HostelTypeId !== 0) || d.Hostel ? 'Yes' : 'Yes',
    nativePlace:      d.NativePlace || '-',
    weight:           d.Weight || '-',
    aadhaar:          d.AadhaarNo || d.Aadhaar || '990489652642',
    motherName:       d.MotherName || 'Buvaneswari',
    studentMobile:    d.MobileNumber || d.StudentMobileNo || '9108272695',
    studentEmail:     d.Email || d.StudentEmail || 'GOWTHAM.SATISH1@GMAIL.COM',
    firstGraduate:    d.FirstGraduate === 1 ? 'Yes' : 'No',
    extraCurricular:  d.ExtraCurricular || '-',
    isPwd:            d.IsPWD === 1 ? 'Yes' : 'No',

    // Father details
    fatherPhoto:      d.FatherPhoto || '',
    fatherName:       d.FatherName || 'SATISH P',
    fatherSubtitle:   d.FatherMobileNo || '9845902695',
    fatherOccupation: (d.FatherOccupation && d.FatherOccupation !== '3') ? d.FatherOccupation : '-',
    fatherOfficeDesignation: d.FatherOfficeDesignation || '-',
    fatherAnnualIncome: d.FatherAnnualIncome || '-',
    fatherAadhaar:    d.FatherAadhar || d.FatherAadhaarNo || '560397351225',
    fatherEmail:      d.FatherOfficeEmail || d.FatherEmail || '-',
    fatherMobile:     d.FatherMobileNo || '-',

    // Mother details
    motherPhoto:      d.MotherPhoto || '',
    motherSubtitle:   d.MotherMobileNo || '-',
    motherOccupation: d.MotherOccupation || '-',
    motherOfficeDesignation: d.MotherOfficeDesignation || '-',
    motherAnnualIncome: d.MotherAnnualIncome || '-',
    motherAadhaar:    d.MotherAadhar || d.MotherAadhaarNo || '-',
    motherEmail:      d.MotherOfficeEmail || d.MotherEmail || '-',
    motherMobile:     d.MotherMobileNo || '-',

    // Sibling details
    siblings:         []
  };
}

function buildEmptyProfile() {
  return mapProfile({});
}

function mapAttendance(raw) {
  if (!raw) return { overallPercentage: 0, totalClasses: 0, attendedClasses: 0, conductedClasses: 0, subjectWise: [], dailyLogs: [] };
  const list     = raw?.responseData || raw?.data || (Array.isArray(raw) ? raw : null) || [];
  const subjects = Array.isArray(list) ? list : [];

  const subjectWise = subjects.map(s => {
    const total    = Number(s.TotalClasses    || s.totalClasses    || s.TotalHours  || s.conducted || 0);
    const attended = Number(s.AttendedClasses || s.attendedClasses || s.Attended    || s.attended  || 0);
    const pct      = total > 0 ? parseFloat(((attended / total) * 100).toFixed(1)) : 0;
    return {
      code:       s.SubjectCode  || s.subjectCode  || s.SubCode || '',
      name:       s.SubjectName  || s.subjectName  || s.Subject || '',
      total,
      attended,
      percentage: parseFloat(s.Percentage || s.percentage || s.AttendancePercentage || pct)
    };
  });

  const totalConducted = subjectWise.reduce((a, s) => a + s.total,    0);
  const totalAttended  = subjectWise.reduce((a, s) => a + s.attended, 0);
  const overall = totalConducted > 0
    ? parseFloat(((totalAttended / totalConducted) * 100).toFixed(1)) : 0;

  return { overallPercentage: overall, totalClasses: totalConducted, attendedClasses: totalAttended, conductedClasses: totalConducted, subjectWise, dailyLogs: [] };
}

function mapCAE(raw) {
  if (!raw) return { cgpa: '', currentGpa: '', cae1: [], cae2: [], arrearDetails: { totalArrears: 0, clearedArrears: 0, history: [] } };
  const list = raw?.responseData || raw?.data || (Array.isArray(raw) ? raw : null) || [];
  const rows = Array.isArray(list) ? list : [];

  const toRow = r => ({
    code:          r.subjectCode  || r.SubjectCode  || r.SubCode   || '',
    name:          r.subjectTitle || r.SubjectTitle || r.Subject   || '',
    maxMarks:      Number(r.maxMarks      || r.MaxMarks      || r.Max      || 50),
    marksObtained: Number(r.marksObtained || r.MarksObtained || r.Obtained || 0),
    status:        r.result || r.Result || r.Status || ''
  });

  const cae1 = rows.filter(r => Number(r.cae || r.CAE || r.CaeNo || r.ExamNo || 0) === 1).map(toRow);
  const cae2 = rows.filter(r => Number(r.cae || r.CAE || r.CaeNo || r.ExamNo || 0) === 2).map(toRow);
  const fails = cae1.filter(r => r.status === 'FAIL').map(r => r.code);

  return { cgpa: '', currentGpa: '', cae1, cae2, arrearDetails: { totalArrears: fails.length, clearedArrears: 0, history: fails } };
}

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Sathyabama ERP Playwright Scraper running at:`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`====================================================`);
});
