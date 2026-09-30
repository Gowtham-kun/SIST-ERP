/**
 * Sathyabama Student Portal — Secure API Client & Auth Manager
 * Hardened for CWE-312 / OWASP A02: Passwords are NEVER persisted in browser storage.
 * Architecture: Direct Client Gateway (primary) + Server-Side Proxy (fallback)
 * to ensure 100% immunity to server-side datacenter IP blocks.
 */

const REMEMBERED_REG_KEY = 'sathy_remembered_regno';
const LEGACY_STORAGE_KEY = 'sathy_credentials_v2';
const TOKEN_KEY          = 'sathy_access_token';
const ERP_BASE_URL       = 'https://erp.sathyabama.ac.in/erp/api/v1.0';
const ERP_API_KEY        = 'ggd252agagagag362';

const PortalAPI = {

  // ── Secure Local Persistence (Register Number Only, Never Password) ─────
  saveRememberedRegNo(regNumber) {
    try {
      if (regNumber && typeof regNumber === 'string') {
        localStorage.setItem(REMEMBERED_REG_KEY, regNumber.trim());
      }
      // Purge legacy cleartext credential storage if still present
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch { /* storage blocked / private browsing */ }
  },

  getRememberedRegNo() {
    try {
      // Purge legacy cleartext storage unconditionally
      if (localStorage.getItem(LEGACY_STORAGE_KEY)) {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
      return localStorage.getItem(REMEMBERED_REG_KEY) || null;
    } catch { return null; }
  },

  clearRememberedRegNo() {
    try {
      localStorage.removeItem(REMEMBERED_REG_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch { /* storage blocked */ }
  },

  // Backward compatibility helper for remembered login pre-fill
  getStoredCredentials() {
    const reg = this.getRememberedRegNo();
    return reg ? { regNumber: reg, password: '' } : null;
  },

  clearSession() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch { /* storage blocked */ }
  },

  clearCredentials() {
    this.clearSession();
  },

  // ── Native Browser Direct ERP Caller (CORS: * allows direct client access) ─
  async fetchErpDirect(endpoint, token = null, body = {}, timeoutMs = 12000) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'ERP-API-KEY': ERP_API_KEY
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['Access-Token'] = token;
      headers['Token'] = token;
    }
    const res = await fetch(`${ERP_BASE_URL}/${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });

    const data = await res.json().catch(() => null);

    // If ERP returned 401 Unauthorized or explicit failure status
    if (res.status === 401 || (data && data.status === false)) {
      const rawMsg = data?.message;
      const cleanMsg = (rawMsg === 'Invalid Request' || !rawMsg)
        ? 'Invalid Register Number or Password. Please check your credentials.'
        : rawMsg;
      throw new Error(cleanMsg);
    }

    if (!res.ok) {
      throw new Error(`ERP returned HTTP ${res.status}. Please try again later.`);
    }

    return data;
  },

  // Helper to dynamically calculate term dates
  getTermDates() {
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth() + 1;
    return curMonth >= 6
      ? { fromDate: `${curYear}-06-01`, toDate: `${curYear}-12-31` }
      : { fromDate: `${curYear}-01-01`, toDate: `${curYear}-06-30` };
  },

  // ── Direct Client Gateway Login (Bypasses server IP bans completely) ──────
  async loginDirectClient(cleanReg, cleanPass) {
    console.log('[PortalAPI] Authenticating directly via Student Device Gateway...');

    // 1. Direct login to ERP
    const loginData = await this.fetchErpDirect('MasterStudent/login', null, {
      RegisterNumber: cleanReg,
      Password: cleanPass
    });

    if (!loginData || loginData.status !== true) {
      const errMsg = loginData?.message || 'Invalid Register Number or Password.';
      throw new Error(errMsg);
    }

    const loginObj = loginData?.responseData?.login || {};
    const token = loginObj.accessToken || loginData?.responseData?.accessToken || '';
    const studentId = Number(loginObj.StudentId || loginData?.responseData?.StudentId || 0);

    if (!token) {
      throw new Error('Login succeeded on ERP, but no access token was returned.');
    }

    console.log(`[PortalAPI] Direct ERP authentication successful (StudentID: ${studentId}). Fetching dossier in parallel...`);

    const termDates = this.getTermDates();
    const now = new Date();
    const curYear = now.getFullYear();

    // 2. Fetch Profile first to extract academic context
    let profileRaw = null;
    try {
      profileRaw = await this.fetchErpDirect('MasterStudent/view', token, { StudentId: studentId }, 8000);
    } catch (e) {
      console.warn('[PortalAPI] Direct profile view failed, will fallback:', e.message);
    }

    const studentInfo = profileRaw?.responseData?.StudentInfo?.[0] || profileRaw?.StudentInfo?.[0] || {};
    const sem = studentInfo.CurrentSemester || studentInfo.Semester || 3;
    const semNum = parseInt(String(sem).replace(/[^0-9]/g, ''), 10) || 3;
    const yrNum = Math.ceil(semNum / 2) || 2;
    const isJunior = (semNum === 1 || semNum === 2 || yrNum === 1);

    const baseParams = {
      DegreeId: studentInfo.DegreeId || studentInfo.DegreeID || 1,
      CourseId: studentInfo.CourseId || studentInfo.CourseID || 1,
      ProgrammeId: studentInfo.ProgrammeId || studentInfo.ProgrammeID || studentInfo.BranchId || 1,
      Batch: studentInfo.Batch || studentInfo.batch || `${curYear - (yrNum - 1)}-${curYear - (yrNum - 1) + 4}`,
      Semester: semNum,
      Year: yrNum,
      SectionId: studentInfo.SectionId || studentInfo.SectionID || 1
    };

    // 3. Fetch Attendance, CAE, and Timetable in parallel
    const [attSettled, caeSettled, ttSettled] = await Promise.allSettled([
      this.fetchErpDirect('StudentDailyAttendance/StudentWiseAttendance', token, {
        StudentId: studentId,
        FromDate: termDates.fromDate,
        ToDate: termDates.toDate
      }, 10000),
      this.fetchErpDirect('CAEResult/studentCAEResult', token, {
        RegisterNumber: cleanReg,
        AcademicMonthId: 2,
        AcademicYear: `${curYear}-${curYear + 1}`,
        Semester: semNum
      }, 8000),
      (async () => {
        try {
          const ttIdRes = await this.fetchErpDirect('TimetableDetails/getProgrammeSectionAndTimeSetbyCourse', token, baseParams, 6000);
          const sectionList = Array.isArray(ttIdRes?.responseData) ? ttIdRes.responseData : (ttIdRes?.responseData ? [ttIdRes.responseData] : []);
          const cleanSecTarget = String(studentInfo.SectionName || studentInfo.Section || '').trim().toLowerCase();
          const ttInfo = sectionList.find(item => {
            const sName = String(item.SectionName || item.Section || item.SectionTitle || '').trim().toLowerCase();
            if (cleanSecTarget && sName && (sName === cleanSecTarget || sName.includes(cleanSecTarget) || cleanSecTarget.includes(sName))) return true;
            if (baseParams.SectionId && String(item.SectionId) === String(baseParams.SectionId)) return true;
            return false;
          }) || sectionList[0] || {};

          const timeTableId = ttInfo.TimeTableId;
          const programmeSectionId = ttInfo.ProgrammeSectionId;
          const resolvedSectionId = ttInfo.SectionId || baseParams.SectionId;

          if (!timeTableId || !programmeSectionId) return { isJunior };

          const [timeSetRes, staffRes, matrixRes] = await Promise.all([
            this.fetchErpDirect('TimeSetSection/getcourseTimeSet', token, { ...baseParams, SectionId: resolvedSectionId, ProgrammeSectionId: programmeSectionId }, 6000).catch(() => null),
            this.fetchErpDirect('TimeTableStaffAllocation/getSubjectHandlingStaffs', token, { ...baseParams, SectionId: resolvedSectionId, ProgrammeSectionId: programmeSectionId, TimeTableId: timeTableId }, 6000).catch(() => null),
            this.fetchErpDirect('TimetableDetails/getdatabyprogramme', token, { TimeTableId: timeTableId, ProgrammeSectionId: programmeSectionId }, 6000).catch(() => null)
          ]);

          const timeSetData = timeSetRes?.responseData?.TimeSetDetails || timeSetRes?.responseData?.[0] || timeSetRes?.responseData || {};
          const timeTableArray = timeSetData.TimeTableArray || timeSetData.timeTableArray || (Array.isArray(timeSetData) ? timeSetData : []);

          return {
            isJunior,
            matrixList: matrixRes?.responseData || [],
            timeTableArray,
            staffList: staffRes?.responseData || []
          };
        } catch {
          return { isJunior };
        }
      })()
    ]);

    const attendanceRaw = attSettled.status === 'fulfilled' ? attSettled.value : null;
    const caeRaw = caeSettled.status === 'fulfilled' ? caeSettled.value : null;
    const timetableRaw = ttSettled.status === 'fulfilled' ? ttSettled.value : { isJunior };

    console.log('[PortalAPI] Raw dossiers assembled. Processing session on portal backend...');

    // 4. Send the assembled raw data to portal backend to map and compute calculations
    const procRes = await fetch('/api/process-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        token,
        studentId,
        regNumber: cleanReg,
        loginData,
        profileRaw,
        attendanceRaw,
        caeRaw,
        timetableRaw
      })
    });

    if (!procRes.ok) {
      throw new Error('Error processing academic dossier. Please try again.');
    }

    const payload = await procRes.json();
    if (!payload.success) {
      throw new Error(payload.message || 'Error processing student data.');
    }

    return payload;
  },

  // ── Unified Login (Direct Client-First with Server Proxy Fallback) ─────────
  // ── Unified Login (Direct Client-First with Server Proxy Fallback) ─────────
  async login(regNumber, password, remember) {
    const cleanReg = String(regNumber || '').trim().toUpperCase();
    const cleanPass = String(password || '').trim();

    if (!cleanReg || !cleanPass) {
      throw new Error('Register Number and Password are required.');
    }

    let payload = null;
    let clientError = null;

    // Strategy 1: Direct Client Gateway (Preferred: eliminates server IP block & slow proxy hops)
    try {
      payload = await this.loginDirectClient(cleanReg, cleanPass);
      console.log('✅ Authenticated via Direct Client Gateway');
    } catch (clientErr) {
      clientError = clientErr;
      console.warn('[PortalAPI] Direct client gateway attempt failed:', clientErr.message, '— Attempting server proxy fallback...');
    }

    // Strategy 2: Server-Side Proxy Fallback (runs if Direct Gateway failed or was rejected)
    if (!payload) {
      try {
        const resp = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ regNumber: cleanReg, password: cleanPass })
        });
        const serverData = await resp.json().catch(() => null);
        if (resp.ok && serverData?.success) {
          payload = serverData;
          console.log('✅ Authenticated via Server Proxy Fallback');
        } else {
          const msg = serverData?.message || clientError?.message || 'Invalid Register Number or Password. Please check your credentials.';
          throw new Error(msg);
        }
      } catch (proxyErr) {
        if (clientError?.message) {
          throw clientError;
        }
        throw new Error(proxyErr.message || 'Authentication failed. Please check your credentials.');
      }
    }

    // Persist only Register Number if requested; never password
    if (remember) {
      this.saveRememberedRegNo(cleanReg);
    } else {
      this.clearRememberedRegNo();
    }

    // Store access token in sessionStorage for session security
    try {
      if (payload?.token) {
        sessionStorage.setItem(TOKEN_KEY, payload.token);
      }
    } catch { /* storage blocked */ }

    return payload;
  }
};
