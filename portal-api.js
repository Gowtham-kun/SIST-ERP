/**
 * Sathyabama Student Portal — API Client & Auth Manager
 * No mock data. All responses come from the live Express/Playwright backend.
 */

const STORAGE_KEY = 'sathy_credentials_v2';
const TOKEN_KEY   = 'sathy_access_token';

const PortalAPI = {

  // ── Persist credentials locally ──────────────────────────────────────────
  saveCredentials(regNumber, password) {
    try {
      localStorage.setItem(STORAGE_KEY, btoa(JSON.stringify({ regNumber, password })));
    } catch (e) { /* storage blocked */ }
  },

  getStoredCredentials() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(atob(raw)) : null;
    } catch { return null; }
  },

  clearCredentials() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TOKEN_KEY);
  },

  // ── Send credentials to Express backend → Playwright scraper ────────────
  // Returns: { success, token, student, data: { studentDetails, attendanceSummary, caeResults } }
  async login(regNumber, password, remember) {
    const resp = await fetch('/api/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ regNumber, password })
    });

    const payload = await resp.json();

    if (!payload.success) {
      throw new Error(payload.message || 'Authentication failed.');
    }

    if (remember) this.saveCredentials(regNumber, password);
    localStorage.setItem(TOKEN_KEY, payload.token);

    return payload;   // caller gets: { token, student, data }
  }
};
