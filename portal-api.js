/**
 * Sathyabama Student Portal — Secure API Client & Auth Manager
 * Hardened for CWE-312 / OWASP A02: Passwords are NEVER persisted in browser storage.
 */

const REMEMBERED_REG_KEY = 'sathy_remembered_regno';
const LEGACY_STORAGE_KEY = 'sathy_credentials_v2';
const TOKEN_KEY          = 'sathy_access_token';

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

  // ── Send credentials to Express backend → Direct ERP REST gateway ────────
  async login(regNumber, password, remember) {
    const cleanReg = String(regNumber || '').trim();
    const cleanPass = String(password || '');

    if (!cleanReg || !cleanPass) {
      throw new Error('Register Number and Password are required.');
    }

    let resp;
    try {
      resp = await fetch('/api/login', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ regNumber: cleanReg, password: cleanPass })
      });
    } catch {
      throw new Error('Cannot connect to portal server. Please ensure the local server is running on http://localhost:3000.');
    }

    let payload;
    try {
      payload = await resp.json();
    } catch {
      throw new Error('Unexpected server response format. Please try again.');
    }

    if (!resp.ok || !payload.success) {
      throw new Error(payload.message || 'Authentication failed. Please check your credentials.');
    }

    // Persist only the Register Number if requested; never the password
    if (remember) {
      this.saveRememberedRegNo(cleanReg);
    } else {
      this.clearRememberedRegNo();
    }

    // Store access token in sessionStorage for tab-scoped session security
    try {
      if (payload.token) {
        sessionStorage.setItem(TOKEN_KEY, payload.token);
      }
    } catch { /* storage blocked */ }

    return payload;   // caller gets: { token, student, data }
  }
};

