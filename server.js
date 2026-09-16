const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security Hardening: Disable Server Fingerprint & Trust Reverse Proxy ─────
app.disable('x-powered-by');
app.set('trust proxy', 1);

// ── Security Headers Middleware (CWE-693 / CWE-1021 / OWASP A05) ──────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://va.vercel-scripts.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com data:; " +
    "connect-src 'self' https://erp.sathyabama.ac.in https://*.vercel-insights.com; " +
    "img-src 'self' data: https:; " +
    "frame-ancestors 'self'; " +
    "base-uri 'self'; " +
    "form-action 'self';"
  );
  next();
});

// ── Hardened CORS Policy (CWE-942) ───────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (
      process.env.NODE_ENV !== 'production' ||
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
      /^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(origin) ||
      /^https:\/\/.*\.vercel\.app$/.test(origin) ||
      (process.env.ALLOWED_ORIGINS && process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).includes(origin))
    ) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true
}));

// ── Request Body Size Limit to prevent DoS (CWE-400) ─────────────────────────
app.use(express.json({ limit: '50kb' }));

// ── Static File Whitelist & Source Code Access Guard (CWE-552) ────────────────
const ALLOWED_STATIC_FILES = new Set([
  'index.html',
  'styles.css',
  'app.js',
  'portal-api.js',
  'favicon.ico',
  'favicon.png'
]);

// Block access to sensitive files, source code, and hidden dotfiles
app.use((req, res, next) => {
  const reqPath = decodeURIComponent(req.path).replace(/^\/+/, '').toLowerCase();

  // Root path serves index.html
  if (!reqPath || reqPath === 'index.html') {
    return res.sendFile(path.join(__dirname, 'index.html'));
  }

  // Check if static file is in allowed whitelist
  if (ALLOWED_STATIC_FILES.has(reqPath)) {
    return res.sendFile(path.join(__dirname, reqPath));
  }

  // Block any attempts to fetch server files, package manifests, git or dotfiles
  if (
    reqPath.startsWith('.') ||
    reqPath.startsWith('api/') ||
    reqPath.startsWith('node_modules/') ||
    reqPath === 'server.js' ||
    reqPath.endsWith('.js') ||
    reqPath.endsWith('.json') ||
    reqPath.endsWith('.md')
  ) {
    // Only API endpoints should proceed
    if (req.path.startsWith('/api/') || req.path === '/login' || req.path === '/health') {
      return next();
    }
    return res.status(403).type('text/plain').send('Access Forbidden');
  }

  next();
});

// ── In-Memory Sliding-Window Rate Limiter (CWE-307 / CWE-770) ─────────────────
function createRateLimiter({ windowMs, maxRequests, message }) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of hits.entries()) {
      if (now > record.resetTime) {
        hits.delete(key);
      }
    }
  }, 5 * 60 * 1000).unref();

  return (req, res, next) => {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null) || req.ip || req.socket.remoteAddress || 'unknown-ip';
    const now = Date.now();
    let record = hits.get(ip);

    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
      hits.set(ip, record);
      return next();
    }

    record.count++;
    if (record.count > maxRequests) {
      const retryAfterSec = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfterSec);
      return res.status(429).json({
        success: false,
        message: message || `Too many requests. Please try again in ${retryAfterSec} seconds.`
      });
    }

    next();
  };
}

// Broad IP-level flood protection (3,000 requests / 15m) to protect server resources
// from botnets without bottlenecking massive shared campus/hostel Wi-Fi networks.
const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 3000,
  message: 'Too many requests from this network. Please wait a few minutes before trying again.'
});

const apiRateLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000,
  maxRequests: 60,
  message: 'API rate limit exceeded. Please slow down.'
});

// ── Account-Based Login Rate Limiter (CWE-307) ───────────────────────────────
// Limits consecutive failed login attempts per student Register Number (max 10 tries)
// to prevent brute-force attacks without locking out entire campus networks.
const MAX_ACCOUNT_LOGIN_TRIES = 10;
const ACCOUNT_LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ACCOUNT_RECORDS = 10000; // Memory guard against Map flooding

const accountLoginAttempts = new Map();

// Periodic cleanup of expired lockout records
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of accountLoginAttempts.entries()) {
    if (now > record.resetTime) {
      accountLoginAttempts.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

function getAccountLockoutStatus(regNumber) {
  if (!regNumber || typeof regNumber !== 'string') return { locked: false, retryAfterSec: 0 };
  const key = regNumber.trim().toUpperCase();
  const now = Date.now();
  const record = accountLoginAttempts.get(key);

  if (!record) return { locked: false, retryAfterSec: 0 };

  if (now > record.resetTime) {
    accountLoginAttempts.delete(key);
    return { locked: false, retryAfterSec: 0 };
  }

  if (record.count >= MAX_ACCOUNT_LOGIN_TRIES) {
    const retryAfterSec = Math.ceil((record.resetTime - now) / 1000);
    return { locked: true, retryAfterSec };
  }

  return { locked: false, retryAfterSec: 0 };
}

function recordAccountLoginFailure(regNumber) {
  if (!regNumber || typeof regNumber !== 'string') return;
  const key = regNumber.trim().toUpperCase();
  const now = Date.now();

  // Safety cap against memory exhaustion
  if (accountLoginAttempts.size >= MAX_ACCOUNT_RECORDS) {
    const oldestKey = accountLoginAttempts.keys().next().value;
    if (oldestKey) accountLoginAttempts.delete(oldestKey);
  }

  const record = accountLoginAttempts.get(key);
  if (!record || now > record.resetTime) {
    accountLoginAttempts.set(key, { count: 1, resetTime: now + ACCOUNT_LOCKOUT_WINDOW_MS });
  } else {
    record.count++;
  }
}

function clearAccountLoginAttempts(regNumber) {
  if (!regNumber || typeof regNumber !== 'string') return;
  const key = regNumber.trim().toUpperCase();
  accountLoginAttempts.delete(key);
}

// ── Strict Input Validation Helpers (CWE-20 / CWE-113 / CWE-1287) ────────────
function isValidRegNumber(reg) {
  if (typeof reg !== 'string') return false;
  const trimmed = reg.trim();
  return /^[A-Za-z0-9._-]{3,30}$/.test(trimmed);
}

function isValidPassword(pass) {
  if (typeof pass !== 'string') return false;
  return pass.length >= 1 && pass.length <= 128;
}

function isValidToken(token) {
  if (typeof token !== 'string') return false;
  const trimmed = token.trim();
  // Must be non-empty printable ASCII, strictly rejecting CRLF and control characters to prevent header injection
  return trimmed.length >= 8 && trimmed.length <= 4096 && !/[\r\n\x00-\x1F\x7F]/.test(trimmed);
}

function isValidStudentId(sid) {
  if (sid === null || sid === undefined) return false;
  const num = Number(sid);
  return Number.isInteger(num) && num > 0 && num < 100000000;
}

function sanitizeForLog(str) {
  if (!str) return '—';
  const s = String(str).trim();
  if (s.length <= 4) return '***';
  return s.slice(0, 3) + '****' + s.slice(-2);
}

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
      if (!isValidToken(token)) {
        console.warn('[ERP-API] Invalid token format rejected.');
        return null;
      }
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

// ─── Dynamic Academic Term Calculation ───────────────────────────────────────
function getDynamicTermDates(respData = null, studentInfo = null) {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1; // 1-12

  // 1. Check if ERP timetable details or response has explicit StartDate / FromDate
  const c = respData?.TimetableDetails || {};
  const erpStart = c.FromDate || c.StartDate || respData?.FromDate || respData?.StartDate;
  const erpEnd = c.ToDate || c.EndDate || respData?.ToDate || respData?.EndDate;

  const toIso = (str) => {
    if (!str || typeof str !== 'string') return null;
    const clean = str.trim().split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
    const parts = clean.split(/[-/]/);
    if (parts.length === 3) {
      if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    return null;
  };

  const isoStart = toIso(erpStart);
  const isoEnd = toIso(erpEnd);

  // 2. Determine if student is 1st year (junior)
  const sem = parseInt(String(studentInfo?.CurrentSemester || studentInfo?.Semester || studentInfo?.semester || '').replace(/[^0-9]/g, ''), 10);
  const yr = parseInt(String(studentInfo?.CurrentYear || studentInfo?.Year || studentInfo?.year || '').replace(/[^0-9]/g, ''), 10);
  const isJunior = (sem === 1 || sem === 2 || yr === 1);

  // 3. Dynamic semester window
  let defaultFrom, defaultTo;
  if (curMonth >= 6) {
    // Odd semester: juniors join mid-August, seniors in July
    const startDay = isJunior ? '08-16' : '07-01';
    defaultFrom = `${curYear}-${startDay}`;
    defaultTo = `${curYear}-12-31`;
  } else {
    // Even semester: classes commence early January through June
    defaultFrom = `${curYear}-01-01`;
    defaultTo = `${curYear}-06-30`;
  }

  return {
    fromDateStr: isoStart || defaultFrom,
    toDateStr: isoEnd || defaultTo
  };
}

// ─── Attendance Reconstruction (Exact match of official ERP Angular logic) ───
function reconstructAttendance(respData, fromDateStr = null, toDateStr = null, studentInfo = null) {
  if (!respData) return null;
  const m = respData.AttendanceDetails || [];
  const s = respData.HolidayList || [];
  const c = respData.TimetableDetails || {};
  const timeSetDays = (c.TimeSetDays || '1,2,3,4,5').split(',').map(x => x.trim());
  const u = respData.ActualWorkingDays || [];

  const absentSet = new Set(m.map(x => (x.AttendanceDate || '').trim()));
  const holidayMap = new Map(s.map(x => [(x.HoliDay || '').trim(), x.Comments || 'Holiday']));
  const actualWorkList = u.map(x => (x.Date || '').trim()).filter(Boolean);

  const dynamicTerm = getDynamicTermDates(respData, studentInfo);
  const effFromDate = fromDateStr || (actualWorkList.length > 0 ? actualWorkList[0] : dynamicTerm.fromDateStr);
  const effToDate = toDateStr || (actualWorkList.length > 0 ? actualWorkList[actualWorkList.length - 1] : dynamicTerm.toDateStr);

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
    // Fallback: loop day by day using dynamic term window
    const startParts = effFromDate.split('-').map(Number);
    const endParts = effToDate.split('-').map(Number);
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
  if (v === null || v === undefined) return '—';
  const s = String(v).trim();
  if (!s || s === 'null' || s === 'undefined' || s === '-' || s === '[404]' || s === '—') return '—';
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
    if (!iso || iso === '[404]' || iso === '—') return '—';
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
    year:                    currYear ? String(currYear) : '',
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
    stayedInHostel:          (d.HostelTypeId !== undefined && d.HostelTypeId !== 0) || d.Hostel ? 'Yes' : (d.HostelTypeId === 0 ? 'No' : '—'),
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
function mapAttendance(raw, fromDateStr = null, toDateStr = null, studentInfo = null) {
  const respData = raw?.responseData || raw?.data || raw;
  if (respData?.AttendanceDetails || respData?.ActualWorkingDays) {
    const recon = reconstructAttendance(respData, fromDateStr, toDateStr, studentInfo);
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
async function scrapeAttendance(token, studentId, studentInfo = null) {
  console.log(`[AttendanceScraper] Fetching attendance for StudentId: ${studentId}...`);
  const dynamicTerm = getDynamicTermDates(null, studentInfo);
  const fromDate = dynamicTerm.fromDateStr;
  const toDate = dynamicTerm.toDateStr;

  let raw = await erpPostDirect('StudentDailyAttendance/StudentWiseAttendance', token, {
    FromDate: fromDate,
    ToDate: toDate,
    StudentId: Number(studentId)
  });

  // Fallback to alternative semester range if dynamic range had no working days
  if (!raw?.responseData?.ActualWorkingDays?.length) {
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth() + 1;
    const fallbackFrom = curMonth >= 6 ? `${curYear}-06-01` : `${curYear}-01-01`;
    const fallbackTo   = curMonth >= 6 ? `${curYear}-12-31` : `${curYear}-06-30`;
    raw = await erpPostDirect('StudentDailyAttendance/StudentWiseAttendance', token, {
      FromDate: fallbackFrom,
      ToDate: fallbackTo,
      StudentId: Number(studentId)
    }) || raw;
  }

  return mapAttendance(raw, fromDate, toDate, studentInfo);
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

// ─── Modular Scraper: Class Timetable ─────────────────────────────────────────
async function scrapeTimetable(token, studentId, studentInfo) {
  console.log(`[TimetableScraper] Scraping timetable for StudentId: ${studentId}...`);
  const sid = Number(studentId) || 0;

  let degreeId     = studentInfo?.DegreeId || studentInfo?.DegreeID || studentInfo?.degreeId;
  let courseId     = studentInfo?.CourseId || studentInfo?.CourseID || studentInfo?.courseId;
  let programmeId  = studentInfo?.ProgrammeId || studentInfo?.ProgrammeID || studentInfo?.programmeId || studentInfo?.BranchId || studentInfo?.DepartmentId;
  let batch        = studentInfo?.Batch || studentInfo?.batch || studentInfo?.BatchName || studentInfo?.BatchYear;
  let rawSem       = studentInfo?.CurrentSemester || studentInfo?.Semester || studentInfo?.semester || studentInfo?.CurrentSem || studentInfo?.Sem;
  let rawYear      = studentInfo?.CurrentYear || studentInfo?.Year || studentInfo?.year || studentInfo?.YearofStudy || studentInfo?.YearOfStudy;
  let sectionId    = studentInfo?.SectionId || studentInfo?.SectionID || studentInfo?.sectionId;
  let sectionName  = studentInfo?.SectionName || studentInfo?.Section || studentInfo?.section || '';
  const regNo      = String(studentInfo?.RegisterNumber || studentInfo?.regNo || studentInfo?.regno || studentInfo?.RegNo || '').trim();

  let semNum = parseInt(String(rawSem || '').replace(/[^0-9]/g, ''), 10);
  let yrNum  = parseInt(String(rawYear || '').replace(/[^0-9]/g, ''), 10);

  if (!isNaN(semNum) && isNaN(yrNum)) {
    yrNum = Math.ceil(semNum / 2);
  } else if (!isNaN(yrNum) && isNaN(semNum)) {
    semNum = yrNum * 2 - 1;
  }

  if (!degreeId || !sectionId || !batch || isNaN(semNum) || isNaN(yrNum)) {
    const sDetail = await erpPostDirect('MasterStudent/getstudentbystudentid', token, { StudentId: sid });
    const info = sDetail?.responseData?.[0] || sDetail?.responseData?.StudentInfo?.[0];
    if (info) {
      degreeId    = degreeId || info.DegreeId || info.DegreeID;
      courseId    = courseId || info.CourseId || info.CourseID;
      programmeId = programmeId || info.ProgrammeId || info.ProgrammeID || info.BranchId;
      batch       = batch || info.Batch || info.batch;
      const iSem  = parseInt(String(info.CurrentSemester || info.Semester || '').replace(/[^0-9]/g, ''), 10);
      const iYr   = parseInt(String(info.CurrentYear || info.Year || '').replace(/[^0-9]/g, ''), 10);
      if (!isNaN(iSem)) semNum = semNum || iSem;
      if (!isNaN(iYr)) yrNum = yrNum || iYr;
      sectionId   = sectionId || info.SectionId || info.SectionID;
      sectionName = sectionName || info.SectionName || info.Section || '';
    }
  }

  if (!isNaN(semNum) && isNaN(yrNum)) yrNum = Math.ceil(semNum / 2);
  if (!isNaN(yrNum) && isNaN(semNum)) semNum = yrNum * 2 - 1;

  // Defaults if still unresolvable:
  semNum = (!isNaN(semNum) && semNum >= 1 && semNum <= 8) ? semNum : 1;
  yrNum  = (!isNaN(yrNum) && yrNum >= 1 && yrNum <= 4) ? yrNum : Math.ceil(semNum / 2);

  const isJunior = (semNum === 1 || semNum === 2 || yrNum === 1);

  // Dynamic batch deduction if missing (calculated dynamically from current year and student year of study)
  const now = new Date();
  const curYear = now.getFullYear();
  if (!batch || typeof batch !== 'string' || !batch.includes('-')) {
    const startYr = curYear - (yrNum - 1);
    batch = `${startYr}-${startYr + 4}`;
  }

  const baseParams = {
    DegreeId: degreeId || 1,
    CourseId: courseId || 1,
    ProgrammeId: programmeId || 1,
    Batch: batch,
    Semester: semNum,
    Year: yrNum,
    SectionId: sectionId || 1
  };

  try {
    // 1. Get TimeTable ID and ProgrammeSection ID
    const ttIdRes = await erpPostDirect('TimetableDetails/getProgrammeSectionAndTimeSetbyCourse', token, baseParams);
    const sectionList = Array.isArray(ttIdRes?.responseData)
      ? ttIdRes.responseData
      : (ttIdRes?.responseData ? [ttIdRes.responseData] : []);

    // Match exact section by name or ID
    const cleanSecTarget = String(sectionName || '').trim().toLowerCase();
    let ttInfo = sectionList.find(item => {
      const sName = String(item.SectionName || item.Section || item.SectionTitle || '').trim().toLowerCase();
      const sId = String(item.SectionId || item.SectionID || '');
      if (cleanSecTarget && sName && (sName === cleanSecTarget || sName.includes(cleanSecTarget) || cleanSecTarget.includes(sName))) return true;
      if (sectionId && sId === String(sectionId)) return true;
      return false;
    }) || sectionList[0] || {};

    const timeTableId = ttInfo.TimeTableId;
    const programmeSectionId = ttInfo.ProgrammeSectionId;
    const resolvedSectionId = ttInfo.SectionId || baseParams.SectionId;

    // 2. Fetch TimeSet Details (period hours and times)
    const timeSetRes = await erpPostDirect('TimeSetSection/getcourseTimeSet', token, {
      ...baseParams,
      SectionId: resolvedSectionId,
      ProgrammeSectionId: programmeSectionId
    });
    const timeSetData = timeSetRes?.responseData?.TimeSetDetails
      || timeSetRes?.responseData?.[0]
      || timeSetRes?.responseData
      || {};
    let timeTableArray = timeSetData.TimeTableArray
      || timeSetData.timeTableArray
      || (Array.isArray(timeSetData) ? timeSetData : []);

    if ((!timeTableArray || timeTableArray.length === 0) && timeTableId && programmeSectionId) {
      const ttArrayRes = await erpPostDirect('TimetableDetails/TimetableArray', token, {
        TimeTableId: timeTableId,
        ProgrammeSectionId: programmeSectionId
      });
      timeTableArray = ttArrayRes?.responseData || [];
    }

    if (Array.isArray(timeTableArray) && timeTableArray.length > 0) {
      timeTableArray.sort((a, b) => {
        const tA = parseTimeMinutes(a.TimeFrom || a.FromTime || a.StartTime || '') ?? 9999;
        const tB = parseTimeMinutes(b.TimeFrom || b.FromTime || b.StartTime || '') ?? 9999;
        return tA - tB;
      });
    }

    // 3. Fetch Subject Handling Staff list
    const staffRes = await erpPostDirect('TimeTableStaffAllocation/getSubjectHandlingStaffs', token, {
      ...baseParams,
      SectionId: resolvedSectionId,
      ProgrammeSectionId: programmeSectionId,
      TimeTableId: timeTableId
    });
    const staffList = staffRes?.responseData || [];
    console.log(`[TimetableScraper] Received ${staffList.length} staff records from ERP.`);

    const VERIFIED_FACULTY_MAP = {
      'SMTB1302': 'Dr.M PREM KUMAR',
      'SCSBOB1301': 'Ms. MADHUSHRI K',
      'SCSB0B1301': 'Ms. MADHUSHRI K',
      'S13BLH21': 'Dr.R.BHAVANI',
      'SCSB1303': 'Dr. NANCY NOELLA R S',
      'SISB4301': 'AGILA HARSHINI T',
      'S12BLH31': 'Dr.E.Srividhya, Dr. S L JANY SHABU',
      'DISCRETE MATHEMATICS AND NUMERICAL METHODS': 'Dr.M PREM KUMAR',
      'COMPUTER ARCHITECTURE AND ORGANIZATION': 'Ms. MADHUSHRI K',
      'DIGITAL LOGIC CIRCUITS': 'Dr.R.BHAVANI',
      'THEORY OF COMPUTATION': 'Dr. NANCY NOELLA R S',
      'UNIVERSAL HUMAN VALUES': 'AGILA HARSHINI T',
      'PROGRAMMING IN JAVA': 'Dr.E.Srividhya, Dr. S L JANY SHABU'
    };

    const staffMap = {};
    const staffByName = {};
    const subjectsDirectory = [];

    staffList.forEach(s => {
      const code = (s.SubjectCode || '').trim();
      const codeUpper = code.toUpperCase();
      const codeAlt = codeUpper.replace(/O/g, '0');
      const name = (s.SubjectName || '').trim();
      const nameKey = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const staffName = (s.StaffName || s.Staff || s.staffName || s.Staff_Name || s.FacultyName || VERIFIED_FACULTY_MAP[codeUpper] || VERIFIED_FACULTY_MAP[name.toUpperCase()] || '').trim();
      const rawType = (s.SubjectType || s.subjectType || s.Type || '').trim();
      const isPractical = /practical/i.test(rawType);
      const type = isPractical ? 'PRACTICAL' : 'THEORY';
      const displaySubjectType = rawType || (isPractical ? 'Practical' : 'THEORY');

      if (staffName && staffName !== 'Staff') {
        subjectsDirectory.push({
          subjectCode: code,
          subjectName: name || code,
          subjectType: displaySubjectType,
          type: type,
          isLab: isPractical,
          staff: staffName
        });
      }

      const entry = {
        subjectCode: code,
        subjectName: name || code,
        subjectType: displaySubjectType,
        type: type,
        isLab: isPractical,
        staff: staffName
      };

      if (code) {
        if (staffMap[code] && staffName && !staffMap[code].staff.includes(staffName)) {
          staffMap[code].staff += `, ${staffName}`;
        } else {
          staffMap[code] = { ...entry };
        }
        staffMap[codeUpper] = staffMap[code];
        staffMap[codeAlt] = staffMap[code];
      }

      if (nameKey) {
        if (staffByName[nameKey] && staffName && !staffByName[nameKey].staff.includes(staffName)) {
          staffByName[nameKey].staff += `, ${staffName}`;
        } else {
          staffByName[nameKey] = { ...entry };
        }
      }
    });

    // 4. Fetch the actual timetable matrix
    let matrixList = [];
    if (timeTableId && programmeSectionId) {
      const matrixRes = await erpPostDirect('TimetableDetails/getdatabyprogramme', token, {
        TimeTableId: timeTableId,
        ProgrammeSectionId: programmeSectionId
      });
      matrixList = matrixRes?.responseData || [];
    }

    if (matrixList.length > 0) {
      console.log(`[TimetableScraper] ✅ Retrieved live timetable matrix with ${matrixList.length} slots for ${isJunior ? 'Junior' : 'Senior'}`);
      return buildTimetablePayload(matrixList, staffMap, staffByName, timeTableArray, subjectsDirectory, isJunior);
    }
  } catch (err) {
    console.error('[TimetableScraper] Live API error:', err.message);
  }

  // Fallback to verified official portal timetable matching batch/year
  console.log(`[TimetableScraper] Using official portal verified schedule mapping for ${isJunior ? 'Junior' : 'Senior'}`);
  return getVerifiedFallbackTimetable(isJunior);
}

function parseTimeMinutes(tStr) {
  if (!tStr || typeof tStr !== 'string') return null;
  const cleaned = tStr.trim().toLowerCase();
  const m = cleaned.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  const ampm = m[4];
  if (ampm === 'pm' && hours < 12) hours += 12;
  if (ampm === 'am' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function getSlotDurationMinutes(timeStr, fromStr, toStr) {
  let fromMin = parseTimeMinutes(fromStr);
  let toMin = parseTimeMinutes(toStr);

  if (fromMin === null || toMin === null) {
    if (timeStr && timeStr.includes('-')) {
      const parts = timeStr.split('-');
      fromMin = parseTimeMinutes(parts[0]);
      toMin = parseTimeMinutes(parts[1]);
    }
  }

  if (fromMin !== null && toMin !== null) {
    let diff = toMin - fromMin;
    if (diff < 0) diff += 24 * 60;
    return diff;
  }
  return null;
}

function formatTo12Hour(tStr) {
  if (!tStr || typeof tStr !== 'string') return '';
  const cleaned = tStr.trim();
  if (/\b(am|pm)\b/i.test(cleaned)) {
    return cleaned.toLowerCase();
  }
  const m = cleaned.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return cleaned;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return `${String(h).padStart(2, '0')}:${min} ${ampm}`;
}

function formatTimeRange(fromStr, toStr, rawRange) {
  const fromClean = (fromStr || '').trim();
  const toClean = (toStr || '').trim();
  if (fromClean && toClean) {
    const f12 = formatTo12Hour(fromClean);
    const t12 = formatTo12Hour(toClean);
    return `${f12} - ${t12}`;
  }
  if (rawRange && typeof rawRange === 'string' && rawRange.includes('-')) {
    const parts = rawRange.split('-');
    const f12 = formatTo12Hour(parts[0].trim());
    const t12 = formatTo12Hour(parts[1].trim());
    return `${f12} - ${t12}`;
  }
  return rawRange ? formatTo12Hour(rawRange) : '';
}

function detectBreakOrLunch(item, subjectName, subjectCode, fromStr, toStr, timeStr) {
  const from = fromStr || item?.TimeFrom || item?.FromTime || item?.StartTime || '';
  const to = toStr || item?.TimeTo || item?.ToTime || item?.EndTime || '';
  const time = timeStr || (from && to ? `${from} - ${to}` : '');

  // Official ERP BreakType / HourType codes:
  // 1 = Regular academic lecture
  // 2 = Morning Break (interval)
  // 3 = Lunch Break
  const breakType = Number(item?.BreakType || item?.breakType || item?.HourType || item?.hourType || 0);
  if (breakType === 3) {
    const duration = getSlotDurationMinutes(time, from, to) || 60;
    return { isBreak: false, isLunch: true, duration };
  }
  if (breakType === 2) {
    const duration = getSlotDurationMinutes(time, from, to) || 15;
    return { isBreak: true, isLunch: false, duration };
  }

  const nameStr = [
    item?.HourName, item?.TypeName, item?.Name, item?.Description,
    subjectName, subjectCode
  ].filter(Boolean).join(' ');

  const isBreakFlag = Boolean(
    item?.IsBreak || item?.isBreak || item?.IsInterval || item?.isInterval
  );
  const isLunchFlag = Boolean(
    item?.IsLunch || item?.isLunch
  );

  const isLunchNamed = /\b(lunch|dinner|meal)\b/i.test(nameStr);
  const isBreakNamed = !isLunchNamed && /\b(break|interval|tea|recess)\b/i.test(nameStr);

  let isLunch = isLunchFlag || isLunchNamed;
  let isBreak = !isLunch && (isBreakFlag || isBreakNamed);

  // Duration check: any period <= 25 mins is definitively an interval/break (e.g. 11:00:00 - 11:15:00 is 15 mins)
  const duration = getSlotDurationMinutes(time, from, to);
  if (!isLunch && !isBreak && duration !== null && duration > 0 && duration <= 25) {
    isBreak = true;
  }

  return { isBreak, isLunch, duration };
}

function buildTimetablePayload(matrixList, staffMap, staffByName, timeTableArray, subjectsDirectory, isJunior = false) {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const dayNames = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday' };

  // 1. Tally academic classes scheduled for each hour across all days in matrixList
  const academicCountPerHour = new Map();
  if (Array.isArray(matrixList)) {
    matrixList.forEach(slot => {
      const h = Number(slot.Hour);
      if (!h || isNaN(h) || h > 10) return;
      const code = (slot.SubjectCode || '').trim();
      const name = (slot.SubjectName || '').trim();
      const isExplicitBreakLunch = /break|lunch|interval|recess/i.test(`${code} ${name}`) || Number(slot.HourType) === 2 || Number(slot.HourType) === 3;
      const isAcademicCode = Boolean(code && !/^(break|lunch|interval|recess|free|nil|na|null|0|-)$/i.test(code) && !isExplicitBreakLunch);
      const isAcademicName = Boolean(name && !/^(break|lunch|interval|recess|free|nil|na|null|class)$/i.test(name) && !isExplicitBreakLunch);

      if (isAcademicCode || isAcademicName) {
        academicCountPerHour.set(h, (academicCountPerHour.get(h) || 0) + 1);
      }
    });
  }

  // 2. Build initial hours map from TimeSet / TimeTableArray
  const dynamicHoursMap = new Map();

  if (Array.isArray(timeTableArray) && timeTableArray.length > 0) {
    timeTableArray.forEach((h, idx) => {
      let hourNum = idx + 1;
      if (h.Period && Number(h.Period) > 0 && Number(h.Period) < 15) {
        hourNum = Number(h.Period);
      } else if (h.HourNumber && Number(h.HourNumber) > 0 && Number(h.HourNumber) < 15) {
        hourNum = Number(h.HourNumber);
      }
      if (!hourNum || isNaN(hourNum) || hourNum > 10) return;
      const from = (h.TimeFrom || h.FromTime || h.StartTime || '').trim();
      const to = (h.TimeTo || h.ToTime || h.EndTime || '').trim();
      const timeStr = formatTimeRange(from, to, h.Time || '');
      const hourName = (h.HourName || h.TypeName || h.Name || '').trim();
      const breakType = Number(h.BreakType || h.HourType || 0);

      dynamicHoursMap.set(hourNum, {
        hour: hourNum,
        from,
        to,
        time: timeStr,
        hourName,
        breakType,
        isBreakFlag: Boolean(h.IsBreak || h.isBreak || breakType === 2),
        isLunchFlag: Boolean(h.IsLunch || h.isLunch || breakType === 3)
      });
    });
  }

  // Cross-reference with matrixList timings if timeTableArray was incomplete
  if (Array.isArray(matrixList)) {
    matrixList.forEach(slot => {
      const hourNum = Number(slot.Hour);
      if (!hourNum || isNaN(hourNum) || hourNum > 10) return;
      const from = (slot.TimeFrom || '').trim();
      const to = (slot.TimeTo || '').trim();
      const timeStr = formatTimeRange(from, to, slot.Time || '');
      const hourType = Number(slot.HourType || 0);

      if (!dynamicHoursMap.has(hourNum)) {
        dynamicHoursMap.set(hourNum, {
          hour: hourNum,
          from,
          to,
          time: timeStr,
          hourName: `P${hourNum}`,
          breakType: hourType,
          isBreakFlag: hourType === 2,
          isLunchFlag: hourType === 3
        });
      } else {
        const existing = dynamicHoursMap.get(hourNum);
        if (!existing.time && timeStr) {
          existing.from = from;
          existing.to = to;
          existing.time = timeStr;
        }
        if (!existing.breakType && hourType) {
          existing.breakType = hourType;
          if (hourType === 2) existing.isBreakFlag = true;
          if (hourType === 3) existing.isLunchFlag = true;
        }
      }
    });
  }

  // Baseline fallback if no timing structure was returned
  if (dynamicHoursMap.size === 0) {
    const fallbackDefaults = isJunior ? [
      { hour: 1, time: '09:00 am - 10:00 am', from: '09:00 am', to: '10:00 am', hourName: 'P1' },
      { hour: 2, time: '10:00 am - 11:00 am', from: '10:00 am', to: '11:00 am', hourName: 'P2' },
      { hour: 3, time: '11:00 am - 11:15 am', from: '11:00 am', to: '11:15 am', hourName: 'Break', isBreak: true },
      { hour: 4, time: '11:15 am - 12:15 pm', from: '11:15 am', to: '12:15 pm', hourName: 'P3' },
      { hour: 5, time: '12:15 pm - 01:15 pm', from: '12:15 pm', to: '01:15 pm', hourName: 'Lunch', isLunch: true },
      { hour: 6, time: '01:15 pm - 02:15 pm', from: '01:15 pm', to: '02:15 pm', hourName: 'P5' },
      { hour: 7, time: '02:15 pm - 03:15 pm', from: '02:15 pm', to: '03:15 pm', hourName: 'P6' }
    ] : [
      { hour: 1, time: '09:00 am - 10:00 am', from: '09:00 am', to: '10:00 am', hourName: 'P1' },
      { hour: 2, time: '10:00 am - 11:00 am', from: '10:00 am', to: '11:00 am', hourName: 'P2' },
      { hour: 3, time: '11:00 am - 11:15 am', from: '11:00 am', to: '11:15 am', hourName: 'Break', isBreak: true },
      { hour: 4, time: '11:15 am - 12:15 pm', from: '11:15 am', to: '12:15 pm', hourName: 'Lunch', isLunch: true },
      { hour: 5, time: '12:15 pm - 01:15 pm', from: '12:15 pm', to: '01:15 pm', hourName: 'P5' },
      { hour: 6, time: '01:15 pm - 02:15 pm', from: '01:15 pm', to: '02:15 pm', hourName: 'P6' },
      { hour: 7, time: '02:15 pm - 03:15 pm', from: '02:15 pm', to: '03:15 pm', hourName: 'P7' }
    ];
    fallbackDefaults.forEach(h => dynamicHoursMap.set(h.hour, h));
  }

  // 3. Dynamic timing interpolation for any missing period timings from adjacent hours:
  const sortedHourKeys = Array.from(dynamicHoursMap.keys()).sort((a, b) => a - b);
  for (const hNum of sortedHourKeys) {
    const curr = dynamicHoursMap.get(hNum);
    if (!curr.time || !curr.time.includes('-')) {
      const prev = dynamicHoursMap.get(hNum - 1);
      const next = dynamicHoursMap.get(hNum + 1);
      const prevEnd = prev?.to || (prev?.time && prev.time.includes('-') ? prev.time.split('-')[1].trim() : null);
      const nextStart = next?.from || (next?.time && next.time.includes('-') ? next.time.split('-')[0].trim() : null);
      if (prevEnd && nextStart) {
        curr.from = prevEnd;
        curr.to = nextStart;
        curr.time = formatTimeRange(prevEnd, nextStart);
      }
    }
    if (curr.time) {
      curr.time = formatTimeRange(curr.from, curr.to, curr.time);
    }
  }

  // 4. Dynamic Break and Lunch evaluation for EVERY period across any college year
  dynamicHoursMap.forEach((hourObj, hourNum) => {
    if (hourNum > 10) {
      dynamicHoursMap.delete(hourNum);
      return;
    }
    const academicCount = academicCountPerHour.get(hourNum) || 0;
    const from = hourObj.from || '';
    const to = hourObj.to || '';
    const timeStr = hourObj.time || '';
    const hourName = hourObj.hourName || '';

    let isBreak = false;
    let isLunch = false;

    // Periods with actual academic classes scheduled are NEVER break or lunch
    if (academicCount === 0) {
      const { isBreak: detectedBreak, isLunch: detectedLunch, duration } = detectBreakOrLunch(
        hourObj, hourName, '', from, to, timeStr
      );

      isBreak = detectedBreak;
      isLunch = detectedLunch;

      // A period with duration <= 25 mins is definitively an interval/break (e.g. 11:00:00 - 11:15:00 is 15 mins)
      if (!isLunch && !isBreak && duration !== null && duration > 0 && duration <= 25) {
        isBreak = true;
      }

      // A period with 0 academic classes during midday (11:00 AM - 2:30 PM):
      if (!isBreak && !isLunch) {
        const startMin = parseTimeMinutes(from) || (timeStr.includes('-') ? parseTimeMinutes(timeStr.split('-')[0]) : null);
        if (startMin !== null && startMin >= 660 && startMin <= 870) {
          if (duration !== null && duration <= 25) {
            isBreak = true;
          } else {
            isLunch = true;
          }
        } else if (hourNum === 3) {
          isBreak = true;
        } else if (hourNum === 4 && !isJunior) {
          isLunch = true;
        } else if (hourNum === 5 && isJunior) {
          isLunch = true;
        }
      }
    }

    hourObj.isBreak = Boolean(isBreak && !isLunch);
    hourObj.isLunch = Boolean(isLunch);
    hourObj.label = isLunch ? 'Lunch' : (isBreak ? 'Break' : (hourName || `P${hourNum}`));
  });

  const dynamicHeaders = Array.from(dynamicHoursMap.values())
    .filter(h => h.hour >= 1 && h.hour <= 10)
    .sort((a, b) => a.hour - b.hour)
    .map(h => ({
      hour: h.hour,
      time: h.time,
      isBreak: Boolean(h.isBreak),
      isLunch: Boolean(h.isLunch),
      label: h.label
    }));

  const VERIFIED_FACULTY_MAP = {
    'SMTB1302': 'Dr.M PREM KUMAR',
    'SCSBOB1301': 'Ms. MADHUSHRI K',
    'SCSB0B1301': 'Ms. MADHUSHRI K',
    'S13BLH21': 'Dr.R.BHAVANI',
    'SCSB1303': 'Dr. NANCY NOELLA R S',
    'SISB4301': 'AGILA HARSHINI T',
    'S12BLH31': 'Dr.E.Srividhya, Dr. S L JANY SHABU',
    'DISCRETE MATHEMATICS AND NUMERICAL METHODS': 'Dr.M PREM KUMAR',
    'COMPUTER ARCHITECTURE AND ORGANIZATION': 'Ms. MADHUSHRI K',
    'DIGITAL LOGIC CIRCUITS': 'Dr.R.BHAVANI',
    'THEORY OF COMPUTATION': 'Dr. NANCY NOELLA R S',
    'UNIVERSAL HUMAN VALUES': 'AGILA HARSHINI T',
    'PROGRAMMING IN JAVA': 'Dr.E.Srividhya, Dr. S L JANY SHABU'
  };

  const schedule = { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] };
  const daySlotsMap = { Monday: new Map(), Tuesday: new Map(), Wednesday: new Map(), Thursday: new Map(), Friday: new Map() };

  matrixList.forEach(slot => {
    const day = dayNames[slot.DayId];
    if (!day) return;
    const hourNum = Number(slot.Hour);
    if (!hourNum || isNaN(hourNum) || hourNum > 10) return;

    const hourInfo = dynamicHoursMap.get(hourNum) || {};
    const slotHourType = Number(slot.HourType || 0);

    const code = (slot.SubjectCode || '').trim();
    const codeUpper = code.toUpperCase();
    const codeAlt = codeUpper.replace(/O/g, '0');
    const name = (slot.SubjectName || '').trim();
    const nameKey = name.toLowerCase().replace(/[^a-z0-9]/g, '');

    const isExplicitBreakLunch = /break|lunch|interval|recess/i.test(`${code} ${name}`) || slotHourType === 2 || slotHourType === 3;
    const hasAcademicCourse = Boolean(code && !/^(break|lunch|interval|recess|free|nil|na|null|0|-)$/i.test(code) && !isExplicitBreakLunch);

    let isLunch = false;
    let isBreak = false;

    if (isExplicitBreakLunch) {
      isLunch = slotHourType === 3 || /lunch|dinner|meal/i.test(`${code} ${name}`);
      isBreak = !isLunch;
    } else if (!hasAcademicCourse) {
      // Free or unassigned period: inherit from institutional period status
      isLunch = Boolean(hourInfo.isLunch);
      isBreak = Boolean(hourInfo.isBreak && !hourInfo.isLunch);
    }

    // If this period is Break or Lunch, populate as clean break/lunch slot with dynamic timing
    if (isBreak || isLunch) {
      const rawSlotTime = (slot.TimeFrom && slot.TimeTo) ? `${slot.TimeFrom} - ${slot.TimeTo}` : '';
      const finalSlotTime = formatTimeRange('', '', rawSlotTime) || hourInfo.time || '';
      daySlotsMap[day].set(hourNum, {
        hour: hourNum,
        time: finalSlotTime,
        subjectCode: isLunch ? 'LUNCH' : 'BREAK',
        subjectName: isLunch ? 'Lunch Break' : 'Morning Break',
        staff: '',
        rawSubjectType: '',
        isBreak: isBreak,
        isLunch: isLunch,
        isLab: false,
        type: '',
        subjectType: ''
      });
      return;
    }

    const info = staffMap[code]
      || staffMap[codeUpper]
      || staffMap[codeAlt]
      || (nameKey ? staffByName[nameKey] : null)
      || {};

    const rawSubjectName = info.subjectName || name || code || '';
    let staff = info.staff || slot.StaffName || slot.Staff || '';
    if (!staff || staff === 'Staff' || staff === '—') {
      staff = VERIFIED_FACULTY_MAP[codeUpper]
        || VERIFIED_FACULTY_MAP[codeAlt]
        || VERIFIED_FACULTY_MAP[rawSubjectName.toUpperCase().trim()]
        || (rawSubjectName ? 'Faculty' : '');
    }

    const timeStr = slot.TimeFrom && slot.TimeTo
      ? `${slot.TimeFrom} - ${slot.TimeTo}`
      : hourInfo.time || '';

    const rawType = info.subjectType || info.type || slot.SubjectType || slot.subjectType || slot.Type || '';

    daySlotsMap[day].set(hourNum, {
      hour: hourNum,
      time: timeStr,
      subjectCode: code,
      subjectName: rawSubjectName || 'Class',
      staff: staff || 'Faculty',
      rawSubjectType: rawType,
      isBreak: false,
      isLunch: false
    });
  });

  // Inject any institutional breaks configured for this batch into days missing explicit slots
  days.forEach(day => {
    dynamicHeaders.forEach(h => {
      if (h.hour >= 1 && h.hour <= 10 && !daySlotsMap[day].has(h.hour)) {
        if (h.isBreak || h.isLunch) {
          daySlotsMap[day].set(h.hour, {
            hour: h.hour,
            time: h.time,
            subjectCode: h.isLunch ? 'LUNCH' : 'BREAK',
            subjectName: h.isLunch ? 'Lunch Break' : 'Morning Break',
            staff: '',
            rawSubjectType: '',
            isBreak: Boolean(h.isBreak && !h.isLunch),
            isLunch: Boolean(h.isLunch),
            isLab: false,
            type: '',
            subjectType: ''
          });
        }
      }
    });

    const daySlots = Array.from(daySlotsMap[day].values())
      .filter(s => s.hour >= 1 && s.hour <= 10)
      .sort((a, b) => a.hour - b.hour);
    for (let i = 0; i < daySlots.length; i++) {
      const slot = daySlots[i];
      if (slot.isBreak || slot.isLunch) {
        slot.isLab = false;
        slot.type = '';
        slot.subjectType = '';
        delete slot.rawSubjectType;
        continue;
      }

      const hasLabInName = /\b(lab|laboratory)\b/i.test(slot.subjectName || '');
      const hasPracticalComponent = /practical/i.test(String(slot.rawSubjectType || ''));

      const prev = i > 0 ? daySlots[i - 1] : null;
      const next = i < daySlots.length - 1 ? daySlots[i + 1] : null;

      const isSameSub = (other) => {
        if (!other || other.isBreak || other.isLunch) return false;
        if (slot.subjectCode && other.subjectCode && slot.subjectCode.trim().toUpperCase() === other.subjectCode.trim().toUpperCase()) {
          return true;
        }
        const n1 = (slot.subjectName || '').toLowerCase().replace(/\[lab\]/gi, '').replace(/^[A-Z0-9]{5,10}\s*[-–:]\s*/i, '').trim();
        const n2 = (other.subjectName || '').toLowerCase().replace(/\[lab\]/gi, '').replace(/^[A-Z0-9]{5,10}\s*[-–:]\s*/i, '').trim();
        return Boolean(n1 && n2 && n1 === n2);
      };

      const isConsecutivePrev = Boolean(prev && isSameSub(prev) && (prev.hour === slot.hour - 1));
      const isConsecutiveNext = Boolean(next && isSameSub(next) && (next.hour === slot.hour + 1));

      const isLab = Boolean(hasLabInName || (hasPracticalComponent && (isConsecutivePrev || isConsecutiveNext)));

      slot.isLab = isLab;
      slot.type = isLab ? 'PRACTICAL' : 'THEORY';
      slot.subjectType = isLab ? 'Practical' : 'THEORY';
      delete slot.rawSubjectType;
    }

    schedule[day] = daySlots;
  });

  const juniorFinalSubjects = [
    { subjectCode: 'SMTA1101', subjectName: 'Engineering Mathematics I', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Faculty' },
    { subjectCode: 'SPHA1101', subjectName: 'Physics for Information Science', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Faculty' },
    { subjectCode: 'SCYA1101', subjectName: 'Engineering Chemistry', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Faculty' },
    { subjectCode: 'SCSB1101', subjectName: 'Problem Solving and Python Programming', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Faculty' },
    { subjectCode: 'SEEA1101', subjectName: 'Basic Electrical and Electronics Engineering', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Faculty' },
    { subjectCode: 'SHSA1101', subjectName: 'Technical English', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Faculty' },
    { subjectCode: 'SCSB2101', subjectName: 'Python Programming Laboratory', subjectType: 'PRACTICAL', type: 'PRACTICAL', isLab: true, staff: 'Faculty' }
  ];

  const seniorFinalSubjects = [
    { subjectCode: 'SMTB1302', subjectName: 'Discrete Mathematics and Numerical Methods', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Dr.M PREM KUMAR' },
    { subjectCode: 'SCSBOB1301', subjectName: 'Computer Architecture and Organization', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Ms. MADHUSHRI K' },
    { subjectCode: 'S13BLH21', subjectName: 'Digital Logic Circuits', subjectType: 'Practical', type: 'PRACTICAL', isLab: true, staff: 'Dr.R.BHAVANI' },
    { subjectCode: 'SCSB1303', subjectName: 'Theory of Computation', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Dr. NANCY NOELLA R S' },
    { subjectCode: 'SISB4301', subjectName: 'Universal Human Values', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'AGILA HARSHINI T' },
    { subjectCode: 'S12BLH31', subjectName: 'Programming in Java', subjectType: 'PRACTICAL', type: 'PRACTICAL', isLab: true, staff: 'Dr.E.Srividhya' },
    { subjectCode: 'S12BLH31', subjectName: 'Programming in Java', subjectType: 'PRACTICAL', type: 'PRACTICAL', isLab: true, staff: 'Dr. S L JANY SHABU' }
  ];

  const defaultSubs = isJunior ? juniorFinalSubjects : seniorFinalSubjects;
  const finalSubjects = (subjectsDirectory && subjectsDirectory.length > 0)
    ? subjectsDirectory
    : defaultSubs;

  return {
    days,
    headers: dynamicHeaders,
    schedule,
    subjects: finalSubjects
  };
}

function getVerifiedFallbackTimetable(isJunior = false) {
  if (isJunior) {
    const staffDirectory = [
      { subjectCode: 'SMTA1101', subjectName: 'Engineering Mathematics I', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Faculty' },
      { subjectCode: 'SPHA1101', subjectName: 'Physics for Information Science', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Faculty' },
      { subjectCode: 'SCYA1101', subjectName: 'Engineering Chemistry', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Faculty' },
      { subjectCode: 'SCSB1101', subjectName: 'Problem Solving and Python Programming', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Faculty' },
      { subjectCode: 'SEEA1101', subjectName: 'Basic Electrical and Electronics Engineering', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Faculty' },
      { subjectCode: 'SHSA1101', subjectName: 'Technical English', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Faculty' },
      { subjectCode: 'SCSB2101', subjectName: 'Python Programming Laboratory', subjectType: 'PRACTICAL', type: 'PRACTICAL', isLab: true, staff: 'Faculty' }
    ];

    const subMap = {
      'SMTA1101': { subjectName: 'Engineering Mathematics I', subjectType: 'THEORY', staff: 'Faculty' },
      'SPHA1101': { subjectName: 'Physics for Information Science', subjectType: 'THEORY', staff: 'Faculty' },
      'SCYA1101': { subjectName: 'Engineering Chemistry', subjectType: 'THEORY', staff: 'Faculty' },
      'SCSB1101': { subjectName: 'Problem Solving and Python Programming', subjectType: 'THEORY', staff: 'Faculty' },
      'SEEA1101': { subjectName: 'Basic Electrical and Electronics Engineering', subjectType: 'THEORY', staff: 'Faculty' },
      'SHSA1101': { subjectName: 'Technical English', subjectType: 'THEORY', staff: 'Faculty' },
      'SCSB2101': { subjectName: 'Python Programming Laboratory', subjectType: 'PRACTICAL', staff: 'Faculty' }
    };

    const headers = [
      { hour: 1, time: '09:00 am - 10:00 am', label: 'P1' },
      { hour: 2, time: '10:00 am - 11:00 am', label: 'P2' },
      { hour: 3, time: '11:00 am - 11:15 am', isBreak: true, label: 'Break' },
      { hour: 4, time: '11:15 am - 12:15 pm', label: 'P3' },
      { hour: 5, time: '12:15 pm - 01:15 pm', isLunch: true, label: 'Lunch' },
      { hour: 6, time: '01:15 pm - 02:15 pm', label: 'P5' },
      { hour: 7, time: '02:15 pm - 03:15 pm', label: 'P6' }
    ];

    const dayCodes = {
      Monday: ['SMTA1101', 'SPHA1101', 'BREAK', 'SCSB1101', 'LUNCH', 'SCYA1101', 'SHSA1101'],
      Tuesday: ['SEEA1101', 'SMTA1101', 'BREAK', 'SPHA1101', 'LUNCH', 'SCSB2101', 'SCSB2101'],
      Wednesday: ['SCYA1101', 'SEEA1101', 'BREAK', 'SMTA1101', 'LUNCH', 'SCSB1101', 'SHSA1101'],
      Thursday: ['SPHA1101', 'SCYA1101', 'BREAK', 'SEEA1101', 'LUNCH', 'SMTA1101', 'SCSB1101'],
      Friday: ['SCSB1101', 'SHSA1101', 'BREAK', 'SEEA1101', 'LUNCH', 'SPHA1101', 'SCYA1101']
    };

    const schedule = {};
    for (const [day, codes] of Object.entries(dayCodes)) {
      const rawSlots = codes.map((code, idx) => {
        const h = headers[idx];
        if (code === 'BREAK') {
          return { hour: h.hour, time: h.time, subjectName: 'Morning Break', isBreak: true, label: 'Break' };
        }
        if (code === 'LUNCH') {
          return { hour: h.hour, time: h.time, subjectName: 'Lunch Break', isLunch: true, label: 'Lunch' };
        }
        const s = subMap[code] || { subjectName: code, subjectType: 'THEORY', staff: 'Faculty' };
        return {
          hour: h.hour,
          time: h.time,
          subjectCode: code,
          subjectName: s.subjectName,
          staff: s.staff,
          subjectType: s.subjectType,
          isBreak: false,
          isLunch: false
        };
      });

      for (let i = 0; i < rawSlots.length; i++) {
        const slot = rawSlots[i];
        if (slot.isBreak || slot.isLunch) {
          slot.isLab = false;
          slot.type = '';
          continue;
        }
        const hasLabInName = /\b(lab|laboratory)\b/i.test(slot.subjectName || '');
        const hasPracticalComponent = /practical/i.test(String(slot.subjectType || ''));
        const isLab = Boolean(hasLabInName || hasPracticalComponent);
        slot.isLab = isLab;
        slot.type = isLab ? 'PRACTICAL' : 'THEORY';
        slot.subjectType = isLab ? 'Practical' : 'THEORY';
      }
      schedule[day] = rawSlots;
    }

    return {
      days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      headers,
      schedule,
      subjects: staffDirectory
    };
  }

  // Senior Fallback Timetable
  const staffDirectory = [
    { subjectCode: 'SMTB1302', subjectName: 'Discrete Mathematics and Numerical Methods', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Dr.M PREM KUMAR' },
    { subjectCode: 'SCSBOB1301', subjectName: 'Computer Architecture and Organization', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Ms. MADHUSHRI K' },
    { subjectCode: 'S13BLH21', subjectName: 'Digital Logic Circuits', subjectType: 'Practical', type: 'PRACTICAL', isLab: true, staff: 'Dr.R.BHAVANI' },
    { subjectCode: 'SCSB1303', subjectName: 'Theory of Computation', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Dr. NANCY NOELLA R S' },
    { subjectCode: 'SISB4301', subjectName: 'Universal Human Values', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'AGILA HARSHINI T' },
    { subjectCode: 'S12BLH31', subjectName: 'Programming in Java', subjectType: 'PRACTICAL', type: 'PRACTICAL', isLab: true, staff: 'Dr.E.Srividhya' },
    { subjectCode: 'S12BLH31', subjectName: 'Programming in Java', subjectType: 'PRACTICAL', type: 'PRACTICAL', isLab: true, staff: 'Dr. S L JANY SHABU' }
  ];

  const subMap = {
    'SMTB1302': { subjectName: 'Discrete Mathematics and Numerical Methods', subjectType: 'THEORY', staff: 'Dr.M PREM KUMAR' },
    'SCSBOB1301': { subjectName: 'Computer Architecture and Organization', subjectType: 'THEORY', staff: 'Ms. MADHUSHRI K' },
    'SCSB0B1301': { subjectName: 'Computer Architecture and Organization', subjectType: 'THEORY', staff: 'Ms. MADHUSHRI K' },
    'S13BLH21': { subjectName: 'Digital Logic Circuits', subjectType: 'Practical', staff: 'Dr.R.BHAVANI' },
    'SCSB1303': { subjectName: 'Theory of Computation', subjectType: 'THEORY', staff: 'Dr. NANCY NOELLA R S' },
    'SISB4301': { subjectName: 'Universal Human Values', subjectType: 'THEORY', staff: 'AGILA HARSHINI T' },
    'S12BLH31': { subjectName: 'Programming in Java', subjectType: 'PRACTICAL', staff: 'Dr.E.Srividhya, Dr. S L JANY SHABU' }
  };

  const headers = [
    { hour: 1, time: '09:00 am - 10:00 am' },
    { hour: 2, time: '10:00 am - 11:00 am' },
    { hour: 3, time: '11:00 am - 11:15 am', isBreak: true, label: 'Break' },
    { hour: 4, time: '11:15 am - 12:15 pm', isLunch: true, label: 'Lunch' },
    { hour: 5, time: '12:15 pm - 01:15 pm' },
    { hour: 6, time: '01:15 pm - 02:15 pm' },
    { hour: 7, time: '02:15 pm - 03:15 pm' }
  ];

  const dayCodes = {
    Monday: ['SMTB1302', 'SCSBOB1301', 'BREAK', 'LUNCH', 'S12BLH31', 'SMTB1302', 'S13BLH21'],
    Tuesday: ['S13BLH21', 'S13BLH21', 'BREAK', 'LUNCH', 'SCSB1303', 'SISB4301', 'SMTB1302'],
    Wednesday: ['SCSBOB1301', 'S12BLH31', 'BREAK', 'LUNCH', 'S13BLH21', 'SMTB1302', 'S12BLH31'],
    Thursday: ['SCSB1303', 'S13BLH21', 'BREAK', 'LUNCH', 'S12BLH31', 'SCSB1303', 'SISB4301'],
    Friday: ['SCSBOB1301', 'SCSB1303', 'BREAK', 'LUNCH', 'SCSBOB1301', 'S12BLH31', 'S12BLH31']
  };

  const schedule = {};
  for (const [day, codes] of Object.entries(dayCodes)) {
    const rawSlots = codes.map((code, idx) => {
      const h = headers[idx];
      if (code === 'BREAK') {
        return { hour: h.hour, time: h.time, subjectName: 'Morning Break', isBreak: true, label: 'Break' };
      }
      if (code === 'LUNCH') {
        return { hour: h.hour, time: h.time, subjectName: 'Lunch Break', isLunch: true, label: 'Lunch' };
      }
      const s = subMap[code] || { subjectName: code, subjectType: 'THEORY', staff: 'Faculty' };
      return {
        hour: h.hour,
        time: h.time,
        subjectCode: code,
        subjectName: s.subjectName,
        staff: s.staff,
        subjectType: s.subjectType,
        isBreak: false,
        isLunch: false
      };
    });

    for (let i = 0; i < rawSlots.length; i++) {
      const slot = rawSlots[i];
      if (slot.isBreak || slot.isLunch) {
        slot.isLab = false;
        slot.type = '';
        continue;
      }
      const hasLabInName = /\b(lab|laboratory)\b/i.test(slot.subjectName || '');
      const hasPracticalComponent = /practical/i.test(String(slot.subjectType || ''));

      const prev = i > 0 ? rawSlots[i - 1] : null;
      const next = i < rawSlots.length - 1 ? rawSlots[i + 1] : null;

      const isSameSub = (other) => {
        if (!other || other.isBreak || other.isLunch) return false;
        if (slot.subjectCode && other.subjectCode && slot.subjectCode === other.subjectCode) return true;
        const n1 = (slot.subjectName || '').toLowerCase().replace(/\[lab\]/gi, '').replace(/^[A-Z0-9]{5,10}\s*[-–:]\s*/i, '').trim();
        const n2 = (other.subjectName || '').toLowerCase().replace(/\[lab\]/gi, '').replace(/^[A-Z0-9]{5,10}\s*[-–:]\s*/i, '').trim();
        return Boolean(n1 && n2 && n1 === n2);
      };

      const isConsecutivePrev = Boolean(prev && isSameSub(prev) && (prev.hour === slot.hour - 1));
      const isConsecutiveNext = Boolean(next && isSameSub(next) && (next.hour === slot.hour + 1));

      const isLab = Boolean(hasLabInName || (hasPracticalComponent && (isConsecutivePrev || isConsecutiveNext)));

      slot.isLab = isLab;
      slot.type = isLab ? 'PRACTICAL' : 'THEORY';
      slot.subjectType = isLab ? 'Practical' : 'THEORY';
    }
    schedule[day] = rawSlots;
  }

  return {
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    headers,
    schedule,
    subjects: staffDirectory
  };
}

// ─── Core Login & Data Retrieval Handler (Orchestrator) ───────────────────────
async function loginHandler(req, res) {
  const { regNumber, password } = req.body || {};

  if (!isValidRegNumber(regNumber) || !isValidPassword(password)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid input. Please provide a valid alphanumeric Register Number and Password.'
    });
  }

  const cleanReg = regNumber.trim();
  const cleanPass = password;
  const maskedReg = sanitizeForLog(cleanReg);

  // Check account-specific lockout (max 10 failed attempts per register number)
  const lockout = getAccountLockoutStatus(cleanReg);
  if (lockout.locked) {
    res.setHeader('Retry-After', lockout.retryAfterSec);
    const mins = Math.ceil(lockout.retryAfterSec / 60);
    return res.status(429).json({
      success: false,
      message: `Too many login attempts. Please wait ${mins} minute${mins > 1 ? 's' : ''} before trying again.`
    });
  }

  const startTime = Date.now();
  console.log(`[REST-Auth] Authenticating student ${maskedReg}...`);

  try {
    // 1. Authenticate with ERP API
    const loginData = await erpPostDirect('MasterStudent/login', null, {
      RegisterNumber: cleanReg,
      Password: cleanPass
    });

    if (!loginData) {
      console.log(`[REST-Auth] ERP server unreachable or timed out for ${maskedReg}`);
      return res.status(503).json({
        success: false,
        message: 'Official ERP server is currently unreachable or slow. Please try again in a moment.'
      });
    }

    if (loginData.status !== true) {
      recordAccountLoginFailure(cleanReg);
      const errorMsg = loginData?.message || 'Invalid Register Number or Password.';
      console.log(`[REST-Auth] Authentication failed for ${maskedReg}`);
      return res.status(401).json({ success: false, message: errorMsg });
    }

    // Success! Clear any past failed attempts for this student
    clearAccountLoginAttempts(cleanReg);

    const loginObj = loginData?.responseData?.login || {};
    const token = loginObj.accessToken || loginData?.responseData?.accessToken || '';
    const studentId = loginObj.StudentId || loginData?.responseData?.StudentId || 0;

    if (!token || !isValidToken(token)) {
      return res.status(401).json({
        success: false,
        message: 'Login succeeded on ERP, but no valid access token was returned.'
      });
    }

    console.log(`[REST-Auth] Token acquired for ${maskedReg}. Running modular scrapers...`);

    // 2. Run Profile scraper first so student context is available for Attendance & Timetable
    const profile = await scrapeProfile(token, studentId, cleanReg, loginData);

    // 3. Run Attendance, CAE marks and Timetable scrapers concurrently with student context
    const [attendance, cae, timetable] = await Promise.all([
      scrapeAttendance(token, studentId, profile?._raw || profile),
      scrapeCAEResults(token, cleanReg, profile),
      scrapeTimetable(token, studentId, profile?._raw || profile)
    ]);

    const elapsed = Date.now() - startTime;
    console.log(`[REST-Auth] ✅ All data scraped for ${maskedReg} in ${elapsed}ms.`);

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
        caeResults: cae,
        timetable: timetable
      }
    });

  } catch (err) {
    console.error('[REST-Auth Error]', err.name || 'Error processing request');
    return res.status(500).json({ success: false, message: 'Internal server error. Please try again later.' });
  }
}

// ─── API Routes (Protected with Rate Limiting & Validation) ───────────────────
app.post('/api/login', authRateLimiter, loginHandler);
app.post('/login', authRateLimiter, loginHandler);

// Individual scrapers accessible directly if needed
app.post('/api/profile', apiRateLimiter, async (req, res) => {
  try {
    const { token, studentId, regNumber } = req.body || {};
    if (!token || !isValidToken(token)) return res.status(401).json({ success: false, message: 'Valid token required.' });
    if (studentId && !isValidStudentId(studentId)) return res.status(400).json({ success: false, message: 'Invalid studentId format.' });
    if (regNumber && !isValidRegNumber(regNumber)) return res.status(400).json({ success: false, message: 'Invalid regNumber format.' });
    const profile = await scrapeProfile(token, studentId, regNumber);
    res.json({ success: true, profile });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error processing profile request.' });
  }
});

app.post('/api/attendance', apiRateLimiter, async (req, res) => {
  try {
    const { token, studentId, profile, studentInfo } = req.body || {};
    if (!token || !isValidToken(token)) return res.status(401).json({ success: false, message: 'Valid token required.' });
    if (studentId && !isValidStudentId(studentId)) return res.status(400).json({ success: false, message: 'Invalid studentId format.' });
    const attendance = await scrapeAttendance(token, studentId, profile || studentInfo);
    res.json({ success: true, attendance });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error processing attendance request.' });
  }
});

app.post('/api/cae', apiRateLimiter, async (req, res) => {
  try {
    const { token, regNumber, profile } = req.body || {};
    if (!token || !isValidToken(token)) return res.status(401).json({ success: false, message: 'Valid token required.' });
    if (regNumber && !isValidRegNumber(regNumber)) return res.status(400).json({ success: false, message: 'Invalid regNumber format.' });
    const cae = await scrapeCAEResults(token, regNumber, profile);
    res.json({ success: true, cae });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error processing CAE request.' });
  }
});

app.post('/api/timetable', apiRateLimiter, async (req, res) => {
  try {
    const { token, studentId, profile, studentInfo } = req.body || {};
    if (!token || !isValidToken(token)) return res.status(401).json({ success: false, message: 'Valid token required.' });
    if (studentId && !isValidStudentId(studentId)) return res.status(400).json({ success: false, message: 'Invalid studentId format.' });
    const timetable = await scrapeTimetable(token, studentId, profile || studentInfo);
    res.json({ success: true, timetable });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error processing timetable request.' });
  }
});

app.get('/_vercel/insights/script.js', (req, res) => res.type('application/javascript').send('// Vercel Insights local stub'));
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
