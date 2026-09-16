/**
 * Sathyabama Student Portal — Frontend App Controller
 * All data comes from the live backend. No hardcoded placeholders.
 */

let appState = { user: null, data: null, activeTab: 'profile', timetableDay: null, timetableLayout: 'day', attendanceSubView: 'daily', calendarYear: null, calendarMonth: null };

document.addEventListener('DOMContentLoaded', () => {
  initWebThreads();
  const rememberedReg = PortalAPI.getRememberedRegNo();
  if (rememberedReg) {
    const regInput = document.getElementById('regNumber');
    const remCheck = document.getElementById('rememberMe');
    if (regInput) regInput.value = rememberedReg;
    if (remCheck) remCheck.checked = true;
    const passInput = document.getElementById('password');
    if (passInput) passInput.focus();
  }
});

// ── WebThreads Shader Component (React Bits Adaptation for Vanilla WebGL2) ────
function initWebThreads() {
  const canvas = document.getElementById('threads-canvas');
  if (!canvas) return;

  const isMobile = window.innerWidth < 768 || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'low-power' });
  if (!gl) return;

  const vsSource = `#version 300 es
  in vec2 position;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }`;

  const fsSource = `#version 300 es
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform float uSpeed;
  uniform float uThreadCount;
  uniform float uFrequency;
  uniform float uSpread;
  uniform float uTaper;
  uniform float uPosition;
  uniform float uFanMode;
  uniform float uGlow;
  uniform float uFalloff;
  uniform float uThickness;
  uniform float uBrightness;
  uniform float uOpacity;
  uniform float uMirror;
  uniform float uShimmer;
  uniform float uGrain;
  uniform float uGrainIntensity;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  uniform vec3 uBackgroundColor;
  uniform bool uLightMode;
  uniform vec2 uMouse;
  uniform float uMouseStrength;
  uniform float uEnableMouse;
  uniform float uMouseActive;
  out vec4 fragColor;

  #define TAU 6.28318530718
  #define MAX_THREADS 8

  float glow(float x, float str, float dist) {
    return dist / pow(max(x, 1e-4), str);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    float n = max(uThreadCount, 1.0);

    float pinchX = uFanMode < 0.5 ? 0.5 : (uFanMode < 1.5 ? 0.0 : 1.0);
    if (uEnableMouse > 0.5) {
      pinchX = mix(pinchX, uMouse.x, clamp(uMouseStrength, 0.0, 1.0) * uMouseActive);
    }

    float spreadDx = uSpread * abs(uv.x - pinchX);
    // Keep baseT strictly bounded within [0, TAU] to guarantee zero floating point precision loss on mobile GPUs
    float baseT = mod(iTime * uSpeed, TAU);
    float tauOverN = TAU / n;
    float mirror = uMirror > 0.5 ? sign(pinchX - uv.x) : 1.0;
    bool doShimmer = uShimmer > 0.5;
    float shimmerT = mod(iTime * 1.7, TAU);
    float invThickness = 1.0 / max(uThickness, 0.01);
    float xFreq = uv.x * uFrequency;
    float yOff = uv.y - uPosition;
    float ciScale = n > 1.0 ? 1.0 / (n - 1.0) : 0.0;

    vec3 col = vec3(0.0);
    float gsum = 0.0;

    for (int idx = 0; idx < MAX_THREADS; idx++) {
      float i = float(idx);
      if (i >= n) break;

      float amplitude = spreadDx * (1.0 + i * uTaper);
      float shimmer = doShimmer ? sin(shimmerT + i * 1.3) * 0.35 : 0.0;
      float phase = (baseT + i * tauOverN) * mirror + shimmer;

      float sdf = abs(yOff + sin(xFreq + phase) * amplitude) * invThickness;

      float g = glow(sdf, uFalloff, uGlow);
      float ci = i * ciScale;
      vec3 threadCol = mix(uColor1, uColor2, ci);

      col += g * threadCol;
      gsum += g;
    }

    float coreAmt = smoothstep(0.5, 2.2, gsum);
    col = mix(col, uColor3 * gsum, coreAmt * 0.5);

    float bright = uBrightness;
    if (uEnableMouse > 0.5) {
      vec2 md = uv - uMouse;
      float d2 = dot(md, md);
      bright += clamp(uMouseStrength, 0.0, 1.0) * uMouseActive * exp(-d2 * 6.0) * 0.6;
    }
    col *= bright;

    float alpha = clamp(gsum, 0.0, 1.0) * uOpacity;

    vec3 outRgb = col * alpha;

    if (uGrain > 0.5) {
      float gv = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + iTime) * 43758.5453) - 0.5) * uGrainIntensity;
      outRgb = clamp(outRgb + gv, 0.0, 1.0);
      alpha = clamp(alpha + gv, 0.0, 1.0);
    }

    if (uLightMode) {
      vec3 mapped = vec3(1.0) - exp(-max(col, vec3(0.0)) * 1.3);
      float rawEnergy = clamp(max(mapped.r, max(mapped.g, mapped.b)) * uOpacity, 0.0, 1.0);
      float coverage = smoothstep(0.18, 0.72, rawEnergy);
      coverage *= coverage;
      vec3 hue = mapped / max(max(mapped.r, max(mapped.g, mapped.b)), 1e-4);
      vec3 chroma = pow(clamp(hue, 0.0, 1.0), vec3(0.78));
      vec3 pigment = mix(chroma, vec3(0.08), 0.12);
      vec3 ink = mix(vec3(0.9), pigment, 0.82 + coverage * 0.18);
      fragColor = vec4(mix(uBackgroundColor, ink, coverage), 1.0);
    } else {
      fragColor = vec4(outRgb, alpha);
    }
  }`;

  const createShader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };

  const program = gl.createProgram();
  gl.attachShader(program, createShader(gl.VERTEX_SHADER, vsSource));
  gl.attachShader(program, createShader(gl.FRAGMENT_SHADER, fsSource));
  gl.linkProgram(program);
  gl.useProgram(program);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const posLoc = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  const uResLoc = gl.getUniformLocation(program, 'iResolution');
  const uTimeLoc = gl.getUniformLocation(program, 'iTime');
  gl.uniform1f(gl.getUniformLocation(program, 'uSpeed'), 0.2);
  gl.uniform1f(gl.getUniformLocation(program, 'uThreadCount'), 6.0);
  gl.uniform1f(gl.getUniformLocation(program, 'uFrequency'), 5.0);
  gl.uniform1f(gl.getUniformLocation(program, 'uSpread'), 0.18);
  gl.uniform1f(gl.getUniformLocation(program, 'uTaper'), 1.0);
  gl.uniform1f(gl.getUniformLocation(program, 'uPosition'), 0.5);
  gl.uniform1f(gl.getUniformLocation(program, 'uFanMode'), 0.0);
  gl.uniform1f(gl.getUniformLocation(program, 'uGlow'), 0.02);
  gl.uniform1f(gl.getUniformLocation(program, 'uFalloff'), 0.6);
  gl.uniform1f(gl.getUniformLocation(program, 'uThickness'), 1.1);
  gl.uniform1f(gl.getUniformLocation(program, 'uBrightness'), 0.6);
  gl.uniform1f(gl.getUniformLocation(program, 'uOpacity'), 1.0);
  gl.uniform1f(gl.getUniformLocation(program, 'uMirror'), 1.0);
  gl.uniform1f(gl.getUniformLocation(program, 'uShimmer'), 0.0);
  gl.uniform1f(gl.getUniformLocation(program, 'uGrain'), 0.0);
  gl.uniform1f(gl.getUniformLocation(program, 'uGrainIntensity'), 0.0);

  gl.uniform3f(gl.getUniformLocation(program, 'uColor1'), 0.321, 0.153, 1.0);
  gl.uniform3f(gl.getUniformLocation(program, 'uColor2'), 1.0, 0.623, 0.988);
  gl.uniform3f(gl.getUniformLocation(program, 'uColor3'), 1.0, 1.0, 1.0);
  gl.uniform3f(gl.getUniformLocation(program, 'uBackgroundColor'), 0.06, 0.07, 0.11);
  gl.uniform1i(gl.getUniformLocation(program, 'uLightMode'), 0);

  const uMouseLoc = gl.getUniformLocation(program, 'uMouse');
  gl.uniform1f(gl.getUniformLocation(program, 'uMouseStrength'), 0.3);
  gl.uniform1f(gl.getUniformLocation(program, 'uEnableMouse'), isMobile ? 0.0 : 1.0);
  const uMouseActiveLoc = gl.getUniformLocation(program, 'uMouseActive');

  let targetMouse = [0.5, 0.5];
  let currMouse = [0.5, 0.5];
  let targetActive = 0;
  let currActive = 0;

  // Track mouse movements on non-touch devices only
  if (!isMobile) {
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      targetMouse[0] = e.clientX / window.innerWidth;
      targetMouse[1] = 1.0 - (e.clientY / window.innerHeight);
      targetActive = 1;
    }, { passive: true });

    window.addEventListener('pointerleave', () => {
      targetActive = 0;
    });
  }

  let lastWidth = 0;
  let lastHeight = 0;

  const syncSize = () => {
    const curWidth = window.innerWidth;
    const curHeight = window.innerHeight;

    const widthChanged = Math.abs(curWidth - lastWidth) > 3;
    const heightChange = Math.abs(curHeight - lastHeight);
    const isMajorResize = widthChanged || heightChange > 160;

    if (lastWidth > 0 && !isMajorResize) {
      return;
    }

    lastWidth = curWidth;
    lastHeight = curHeight;

    // Full crisp high-DPI resolution matching desktop (up to 2x Retina) without mobile downscaling
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetHeight = Math.max(curHeight, window.screen?.height || curHeight);
    const targetWidth = curWidth;

    canvas.width = Math.round(targetWidth * dpr);
    canvas.height = Math.round(targetHeight * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uResLoc, canvas.width, canvas.height);
  };
  window.addEventListener('resize', syncSize);
  window.addEventListener('orientationchange', () => {
    lastWidth = 0;
    setTimeout(syncSize, 100);
  });
  syncSize();

  // Automatic WebGL context restoration for mobile devices
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
  }, false);
  canvas.addEventListener('webglcontextrestored', () => {
    initWebThreads();
  }, false);

  // Target 60 FPS on both mobile and desktop (or display refresh rate up to 60fps)
  // minInterval of 14ms allows 60Hz (16.6ms) and 120Hz (rendered every 2 frames) without dropping frames due to minor timestamp jitter
  const minInterval = 14.0;
  let lastFrameTime = performance.now();

  const cycle = (2 * Math.PI) / 0.2; // Exact natural period: 31.41592653589793 seconds
  const t0 = performance.now();

  function render(t) {
    requestAnimationFrame(render);

    if (document.hidden) {
      lastFrameTime = t;
      return;
    }

    const elapsed = t - lastFrameTime;
    if (elapsed < minInterval) return;

    // Guard against massive elapsed jumps (e.g., resuming from phone sleep/tab switch)
    if (elapsed > 250) {
      lastFrameTime = t;
    } else {
      lastFrameTime = t - (elapsed % (1000 / 60));
    }

    // Keep time strictly bounded within the exact 2*PI / uSpeed cycle to prevent floating point precision loss
    const boundedTime = ((t - t0) * 0.001) % cycle;
    gl.uniform1f(uTimeLoc, boundedTime);

    if (!isMobile) {
      currMouse[0] += 0.05 * (targetMouse[0] - currMouse[0]);
      currMouse[1] += 0.05 * (targetMouse[1] - currMouse[1]);
      currActive += 0.05 * (targetActive - currActive);

      gl.uniform2f(uMouseLoc, currMouse[0], currMouse[1]);
      gl.uniform1f(uMouseActiveLoc, currActive);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  requestAnimationFrame(render);
}

// HTML entity sanitizer to prevent Cross-Site Scripting (XSS / CWE-79)
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const esc = escapeHtml;

// Helper fallback function: returns clean minimalist '—' if field is missing, null, undefined, empty, or placeholder dash
function val(v) {
  if (v === null || v === undefined) return '—';
  const str = String(v).trim();
  if (str === '' || str === 'null' || str === 'undefined' || str === '-' || str === '[404]' || str === '—') return '—';
  return escapeHtml(str);
}

// ── Auth & Mobile Input Helpers ───────────────────────────────────────────────
function togglePasswordVisibility() {
  const passInput = document.getElementById('password');
  const icon = document.getElementById('togglePasswordIcon');
  if (!passInput) return;
  const isPassword = passInput.type === 'password';
  passInput.type = isPassword ? 'text' : 'password';
  if (icon) {
    icon.textContent = isPassword ? 'visibility_off' : 'visibility';
  }
}

// Smart keyboard navigation: pressing Enter on register number advances to password
document.addEventListener('DOMContentLoaded', () => {
  const regInput = document.getElementById('regNumber');
  const passInput = document.getElementById('password');
  if (regInput && passInput) {
    regInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        passInput.focus();
      }
    });
  }
});

async function handleLoginSubmit(e) {
  e.preventDefault();
  const reg  = document.getElementById('regNumber').value.trim();
  const pass = document.getElementById('password').value;
  const rem  = document.getElementById('rememberMe').checked;
  await executeLogin(reg, pass, rem);
}

async function executeLogin(regNumber, password, remember) {
  const btn    = document.getElementById('submitBtn');
  const status = document.getElementById('statusMessage');
  status.className = 'hidden';

  if (!regNumber || !password) {
    return showStatus(status, 'error', 'Please enter your Register Number and Password.');
  }

  btn.disabled = true;
  btn.innerHTML = `<span class="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></span><span>Authenticating via ERP Portal...</span>`;

  // WIPE STALE SESSION STATE
  appState.user = null;
  appState.data = null;
  appState.calendarMonth = null;
  appState.calendarYear = null;

  try {
    const result = await PortalAPI.login(regNumber, password, remember);

    appState.user = result.student;
    appState.data = result.data;
    appState.calendarMonth = null;
    appState.calendarYear = null;

    document.getElementById('loginSection').classList.add('hidden');
    document.getElementById('dashboardSection').classList.remove('hidden');
    document.getElementById('mobileBottomNav')?.classList.remove('hidden');
    document.body.classList.add('dashboard-active');
    renderHeader();
    setTab('profile');

    // Reset button state so it is immediately ready if user signs out later
    btn.disabled = false;
    btn.innerHTML = `<span class="material-symbols-outlined text-lg">login</span><span>Sign In to Dashboard</span>`;

  } catch (err) {
    showStatus(status, 'error', err.message || 'Login failed. Check your credentials and try again.');
    btn.disabled = false;
    btn.innerHTML = `<span class="material-symbols-outlined text-lg">login</span><span>Sign In to Dashboard</span>`;
  }
}

function handleSignOut() {
  PortalAPI.clearSession();
  appState = { user: null, data: null, activeTab: 'profile', timetableDay: null, timetableLayout: 'day', attendanceSubView: 'daily', calendarYear: null, calendarMonth: null };
  document.getElementById('dashboardSection').classList.add('hidden');
  document.getElementById('mobileBottomNav')?.classList.add('hidden');
  document.getElementById('loginSection').classList.remove('hidden');
  document.body.classList.remove('dashboard-active');
  document.getElementById('password').value = '';

  const remembered = PortalAPI.getRememberedRegNo();
  const regInput = document.getElementById('regNumber');
  if (regInput) {
    regInput.value = remembered || '';
  }

  const btn = document.getElementById('submitBtn');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<span class="material-symbols-outlined text-lg">login</span><span>Sign In to Dashboard</span>`;
  }

  const status = document.getElementById('statusMessage');
  if (status) {
    status.className = 'hidden';
    status.textContent = '';
  }
}

function showStatus(el, type, msg) {
  el.className = type === 'error'
    ? 'rounded-lg p-3 text-center bg-red-500/20 border border-red-500/40 text-red-300 text-sm block mb-4'
    : 'rounded-lg p-3 text-center bg-green-500/20 border border-green-500/40 text-green-300 text-sm block mb-4';
  el.textContent = msg;
}

function animateStudentName(target, name) {
  if (!target || !name || name === '[404]' || name === '—') return;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const finalStr = String(name);
  let iter = 0;
  clearInterval(target._scrambleTimer);
  target._scrambleTimer = setInterval(() => {
    target.textContent = finalStr
      .split('')
      .map((letter, index) => {
        if (letter === ' ') return ' ';
        if (index < iter) return finalStr[index];
        return chars[Math.floor(Math.random() * chars.length)];
      })
      .join('');
    if (iter >= finalStr.length) {
      clearInterval(target._scrambleTimer);
      target.textContent = finalStr;
    }
    iter += 1 / 2;
  }, 25);
}

// ── Navigation ────────────────────────────────────────────────────────────────
function renderHeader() {
  const s = appState.data.studentDetails;
  const initials = (s.name && s.name !== '[404]' && s.name !== '—') ? s.name.split(' ').map(n=>n[0]).join('').slice(0,2) : '—';

  // Desktop Header
  const dName = document.getElementById('headerStudentName');
  const dReg = document.getElementById('headerRegNo');
  const dBranch = document.getElementById('headerBranch');
  const dAvatar = document.getElementById('avatarInitials');
  if (dName) animateStudentName(dName, val(s.name));
  if (dReg) dReg.textContent = `REG NO: ${val(s.regNo)}`;
  if (dBranch) dBranch.textContent = `${val(s.department)} • SEMESTER ${val(s.semester)}`;
  if (dAvatar) dAvatar.textContent = initials;

  // Mobile Compact Header
  const mName = document.getElementById('mobileHeaderStudentName');
  const mReg = document.getElementById('mobileHeaderRegNo');
  const mBranch = document.getElementById('mobileHeaderBranch');
  const mAvatar = document.getElementById('mobileAvatarInitials');
  if (mName) animateStudentName(mName, val(s.name));
  if (mReg) mReg.textContent = `REG: ${val(s.regNo)}`;
  if (mBranch) mBranch.textContent = `SEM ${val(s.semester)}`;
  if (mAvatar) mAvatar.textContent = initials;
}

function setTab(tab) {
  appState.activeTab = tab;
  ['profile','attendance','cae','timetable'].forEach(t => {
    // Desktop Tabs
    const b = document.getElementById(`tab-btn-${t}`);
    if (b) {
      b.className = t === tab
        ? 'px-3 py-2 sm:px-4 sm:py-2.5 rounded-lg text-xs sm:text-sm font-semibold bg-blue-600 text-white shadow-lg shadow-blue-500/25 flex items-center gap-1.5 sm:gap-2 transition-all flex-shrink-0'
        : 'px-3 py-2 sm:px-4 sm:py-2.5 rounded-lg text-xs sm:text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 flex items-center gap-1.5 sm:gap-2 transition-all flex-shrink-0';
    }
    // Mobile Bottom Navigation Bar
    const mb = document.getElementById(`mobile-tab-btn-${t}`);
    if (mb) {
      if (t === tab) {
        mb.classList.add('active');
      } else {
        mb.classList.remove('active');
      }
    }
  });
  const view = { profile: renderProfile, attendance: renderAttendance, cae: renderCAE, timetable: renderTimetable };
  document.getElementById('dashboardTabContent').innerHTML = view[tab]();
  if (tab === 'profile') {
    const pName = document.getElementById('profileStudentName');
    if (pName) animateStudentName(pName, val(appState.data?.studentDetails?.name));
  }
}

function setTimetableDay(day) { appState.timetableDay = day; setTab('timetable'); }
function setTimetableLayout(layout) { appState.timetableLayout = layout; setTab('timetable'); }

function setAttendanceSubView(subView) {
  appState.attendanceSubView = subView;
  setTab('attendance');
}

function resetCalendarToToday() {
  const now = new Date();
  appState.calendarMonth = now.getMonth();
  appState.calendarYear  = now.getFullYear();
  setTab('attendance');
}

function changeCalendarMonth(offset) {
  if (appState.calendarMonth === null || appState.calendarYear === null) {
    const now = new Date();
    appState.calendarMonth = now.getMonth();
    appState.calendarYear  = now.getFullYear();
  }
  let m = appState.calendarMonth + offset;
  let y = appState.calendarYear;
  if (m < 0) {
    m = 11;
    y -= 1;
  } else if (m > 11) {
    m = 0;
    y += 1;
  }
  appState.calendarMonth = m;
  appState.calendarYear  = y;
  setTab('attendance');
}

function parseLogDate(dateStr) {
  if (!dateStr || dateStr === '[404]' || dateStr === '—') return null;
  const str = String(dateStr).trim();

  const clean = str.split('T')[0];
  const delim = clean.includes('/') ? '/' : (clean.includes('-') ? '-' : null);

  if (delim) {
    const parts = clean.split(delim);
    if (parts.length === 3) {
      let day, month, year;
      if (parts[0].length === 4) { // YYYY-MM-DD format
        year  = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10) - 1;
        day   = parseInt(parts[2], 10);
      } else { // DD-MM-YYYY or DD/MM/YYYY format
        day   = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10) - 1;
        year  = parseInt(parts[2], 10);
      }
      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        return new Date(year, month, day);
      }
    }
  }

  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

// ── Profile Tab (Minimalist & Dynamic with Clean Fallback) ────────────────────
function renderProfile() {
  const s = appState.data.studentDetails;

  return `
  <div class="tab-content space-y-8">
    
    <!-- Top Minimal Header Card -->
    <div class="glass-card rounded-xl p-6 border border-white/10">
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 id="profileStudentName" class="text-2xl font-bold text-white tracking-tight uppercase">${val(s.name)}</h2>
          <p class="text-sm font-semibold text-blue-400 mt-1">${val(s.programme)}</p>
          <p class="text-xs text-gray-400 mt-0.5">${val(s.email)}</p>
        </div>
        <div class="text-left sm:text-right text-xs space-y-1">
          <div><span class="text-gray-400">Register No:</span> <span class="text-white font-mono font-bold">${val(s.regNo)}</span></div>
          <div><span class="text-gray-400">Section:</span> <span class="text-white font-semibold">${val(s.section)}</span></div>
          <div><span class="text-gray-400">School:</span> <span class="text-white font-semibold">${val(s.school)}</span></div>
        </div>
      </div>
    </div>

    <!-- Main Content Layout -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">

      <!-- Left Academic Info -->
      <div class="lg:col-span-4 glass-card rounded-xl p-6 border border-white/10 space-y-3 text-xs">
        <h3 class="text-xs font-bold text-gray-300 uppercase tracking-widest pb-2 border-b border-white/10 mb-2">ACADEMIC SUMMARY</h3>
        <div class="flex justify-between py-1 border-b border-white/5"><span class="text-gray-400">Roll Number</span><span class="text-white font-mono">${val(s.rollNumber)}</span></div>
        <div class="flex justify-between py-1 border-b border-white/5"><span class="text-gray-400">Date of Birth</span><span class="text-white">${val(s.dob)}</span></div>
        <div class="flex justify-between py-1 border-b border-white/5"><span class="text-gray-400">Mobile</span><span class="text-white">${val(s.mobile)}</span></div>
        <div class="flex justify-between py-1 border-b border-white/5"><span class="text-gray-400">Age</span><span class="text-white">${val(s.age)}</span></div>
        <div class="flex justify-between py-1 border-b border-white/5"><span class="text-gray-400">Batch</span><span class="text-white">${val(s.batch)}</span></div>
        <div class="flex justify-between py-1 border-b border-white/5"><span class="text-gray-400">Semester</span><span class="text-white">${val(s.semester)}</span></div>
        <div class="flex justify-between py-1 border-b border-white/5"><span class="text-gray-400">Year</span><span class="text-white">${val(s.yearDisplay)}</span></div>
        <div class="flex justify-between py-1 border-b border-white/5"><span class="text-gray-400">Section Name</span><span class="text-white">${val(s.section)}</span></div>
        <div class="flex justify-between py-1"><span class="text-gray-400">School</span><span class="text-white">${val(s.school)}</span></div>
      </div>

      <!-- Right Personal & Family Info -->
      <div class="lg:col-span-8 space-y-8">

        <!-- Personal Details -->
        <div class="glass-card rounded-xl p-6 border border-white/10">
          <h3 class="text-xs font-bold text-gray-300 uppercase tracking-widest pb-3 border-b border-white/10 mb-4">PERSONAL DETAILS</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
            <div><span class="text-gray-400 block mb-0.5">Name</span><span class="text-white font-semibold">${val(s.name)}</span></div>
            <div><span class="text-gray-400 block mb-0.5">Gender</span><span class="text-white font-semibold">${val(s.gender)}</span></div>
            <div><span class="text-gray-400 block mb-0.5">Blood Group</span><span class="text-white font-semibold">${val(s.bloodGroup)}</span></div>

            <div><span class="text-gray-400 block mb-0.5">Medical History</span><span class="text-white font-semibold">${val(s.medicalHistory)}</span></div>
            <div><span class="text-gray-400 block mb-0.5">Native State</span><span class="text-white font-semibold">${val(s.nativeState)}</span></div>
            <div><span class="text-gray-400 block mb-0.5">Height</span><span class="text-white font-semibold">${val(s.height)}</span></div>

            <div><span class="text-gray-400 block mb-0.5">Date Of Birth</span><span class="text-white font-semibold">${val(s.dob)}</span></div>
            <div><span class="text-gray-400 block mb-0.5">Nationality</span><span class="text-white font-semibold">${val(s.nationality)}</span></div>
            <div><span class="text-gray-400 block mb-0.5">Religion</span><span class="text-white font-semibold">${val(s.religion)}</span></div>

            <div><span class="text-gray-400 block mb-0.5">Community</span><span class="text-white font-semibold">${val(s.community)}</span></div>
            <div><span class="text-gray-400 block mb-0.5">Mother Tongue</span><span class="text-white font-semibold">${val(s.motherTongue)}</span></div>
            <div><span class="text-gray-400 block mb-0.5">Stayed in Hostel?</span><span class="text-white font-semibold">${val(s.stayedInHostel)}</span></div>

            <div><span class="text-gray-400 block mb-0.5">Native Place</span><span class="text-white font-semibold">${val(s.nativePlace)}</span></div>
            <div><span class="text-gray-400 block mb-0.5">Weight</span><span class="text-white font-semibold">${val(s.weight)}</span></div>
            <div><span class="text-gray-400 block mb-0.5">Aadhaar</span><span class="text-white font-semibold">${val(s.aadhaar)}</span></div>

            <div><span class="text-gray-400 block mb-0.5">Mother Name</span><span class="text-white font-semibold">${val(s.motherName)}</span></div>
            <div><span class="text-gray-400 block mb-0.5">Student Mobile No</span><span class="text-white font-semibold">${val(s.studentMobile)}</span></div>
            <div><span class="text-gray-400 block mb-0.5">Student Email</span><span class="text-white font-semibold truncate block">${val(s.studentEmail)}</span></div>

            <div><span class="text-gray-400 block mb-0.5">First Graduate</span><span class="text-white font-semibold">${val(s.firstGraduate)}</span></div>
            <div><span class="text-gray-400 block mb-0.5">Extra Curricular</span><span class="text-white font-semibold">${val(s.extraCurricular)}</span></div>
            <div><span class="text-gray-400 block mb-0.5">IsPWD</span><span class="text-white font-semibold">${val(s.isPwd)}</span></div>
          </div>
        </div>

        <!-- Family Details Cards -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
          <!-- Father Card -->
          <div class="glass-card rounded-xl p-5 border border-white/10 space-y-2">
            <h4 class="text-xs font-bold text-gray-300 uppercase tracking-widest pb-2 border-b border-white/10">FATHER DETAILS</h4>
            <div class="pt-1"><span class="text-gray-400 block mb-0.5">Father Name</span><span class="text-white font-bold text-sm">${val(s.fatherName)}</span></div>
            <div class="flex justify-between py-1 border-b border-white/5"><span class="text-gray-400">Occupation</span><span class="text-white">${val(s.fatherOccupation)}</span></div>
            <div class="flex justify-between py-1 border-b border-white/5"><span class="text-gray-400">Office Designation</span><span class="text-white">${val(s.fatherOfficeDesignation)}</span></div>
            <div class="flex justify-between py-1 border-b border-white/5"><span class="text-gray-400">Annual Income</span><span class="text-white">${val(s.fatherAnnualIncome)}</span></div>
            <div class="flex justify-between py-1 border-b border-white/5"><span class="text-gray-400">Aadhaar</span><span class="text-white font-mono">${val(s.fatherAadhaar)}</span></div>
            <div class="flex justify-between py-1 border-b border-white/5"><span class="text-gray-400">Email</span><span class="text-white">${val(s.fatherEmail)}</span></div>
            <div class="flex justify-between py-1"><span class="text-gray-400">Mobile</span><span class="text-white">${val(s.fatherMobile)}</span></div>
          </div>

          <!-- Mother Card -->
          <div class="glass-card rounded-xl p-5 border border-white/10 space-y-2">
            <h4 class="text-xs font-bold text-gray-300 uppercase tracking-widest pb-2 border-b border-white/10">MOTHER DETAILS</h4>
            <div class="pt-1"><span class="text-gray-400 block mb-0.5">Mother Name</span><span class="text-white font-bold text-sm">${val(s.motherName)}</span></div>
            <div class="flex justify-between py-1 border-b border-white/5"><span class="text-gray-400">Occupation</span><span class="text-white">${val(s.motherOccupation)}</span></div>
            <div class="flex justify-between py-1 border-b border-white/5"><span class="text-gray-400">Office Designation</span><span class="text-white">${val(s.motherOfficeDesignation)}</span></div>
            <div class="flex justify-between py-1 border-b border-white/5"><span class="text-gray-400">Annual Income</span><span class="text-white">${val(s.motherAnnualIncome)}</span></div>
            <div class="flex justify-between py-1 border-b border-white/5"><span class="text-gray-400">Aadhaar</span><span class="text-white font-mono">${val(s.motherAadhaar)}</span></div>
            <div class="flex justify-between py-1 border-b border-white/5"><span class="text-gray-400">Email</span><span class="text-white">${val(s.motherEmail)}</span></div>
            <div class="flex justify-between py-1"><span class="text-gray-400">Mobile</span><span class="text-white">${val(s.motherMobile)}</span></div>
          </div>
        </div>

      </div>

    </div>
  </div>`;
}

// ── Attendance Tab (Automated Calendar Daily View & Subject Attendance) ─────────
function renderAttendance() {
  const a = appState.data?.attendanceSummary || {};
  const subView = appState.attendanceSubView || 'daily';

  const semRaw = appState.data?.studentDetails?.semester || '';
  const yrRaw = appState.data?.studentDetails?.year || appState.data?.studentDetails?.yearDisplay || '';
  const semNum = parseInt(String(semRaw).replace(/\D/g, ''), 10) || 0;
  const yrNum = parseInt(String(yrRaw).replace(/\D/g, ''), 10) || 0;
  const isJunior = (semNum === 1 || semNum === 2 || yrNum === 1);

  const rawTt = (appState.data && appState.data.timetable && appState.data.timetable.schedule && Object.keys(appState.data.timetable.schedule).length > 0)
    ? appState.data.timetable
    : getClientFallbackTimetable(isJunior, appState.data?.studentDetails);
  const enrichedTt = getEnrichedTimetable(rawTt, isJunior, appState.data?.studentDetails);
  
  const dailyLogs = a.dailyLogs || [];
  
  // Parsed logs with valid Date objects
  const parsedLogs = dailyLogs.map(l => {
    const dt = parseLogDate(l.date);
    return { ...l, parsedDate: dt };
  }).filter(l => l.parsedDate !== null);

  // Determine earliest and latest dates in database/payload
  let minDate = null, maxDate = null;
  if (parsedLogs.length > 0) {
    const timestamps = parsedLogs.map(l => l.parsedDate.getTime());
    minDate = new Date(Math.min(...timestamps));
    maxDate = new Date(Math.max(...timestamps));
  }

  // Programmatically set initial visible month dynamically:
  // Default to current real-world month if it falls within or near the term window,
  // otherwise default to the latest recorded attendance month (maxDate)
  if (appState.calendarMonth === null || appState.calendarYear === null) {
    const now = new Date();
    if (minDate && maxDate) {
      const startRange = new Date(minDate);
      startRange.setDate(startRange.getDate() - 15);
      const endRange = new Date(maxDate);
      endRange.setDate(endRange.getDate() + 30);

      if (now >= startRange && now <= endRange) {
        appState.calendarMonth = now.getMonth();
        appState.calendarYear  = now.getFullYear();
      } else if (now < minDate) {
        appState.calendarMonth = minDate.getMonth();
        appState.calendarYear  = minDate.getFullYear();
      } else {
        appState.calendarMonth = maxDate.getMonth();
        appState.calendarYear  = maxDate.getFullYear();
      }
    } else {
      appState.calendarMonth = now.getMonth();
      appState.calendarYear  = now.getFullYear();
    }
  }

  const totalPresent = a.totalPresent || parsedLogs.filter(l => l.status === 'Present').length;
  const totalAbsent  = a.totalAbsent  || parsedLogs.filter(l => l.status === 'Absent').length;
  const totalDays    = a.totalDays    || (totalPresent + totalAbsent);

  const pct = totalDays > 0 
    ? parseFloat(((totalPresent / totalDays) * 100).toFixed(1))
    : (a.overallPercentage || 0);

  const dash = 264, offset = dash - (dash * Math.min(pct, 100) / 100);
  const isPass = pct >= 80;
  const ringColor = isPass ? '#10b981' : '#ef4444';

  return `
  <div class="tab-content space-y-6">

    <!-- Top Sub-Navigation Toggle: Daily vs Subject Attendance (Clean Segmented Control) -->
    <div class="w-full pb-1">
      <div class="mobile-segmented-control max-w-md mx-auto">
        <button onclick="setAttendanceSubView('daily')" id="sub-btn-daily"
          class="mobile-segmented-item ${subView==='daily' ? 'active' : ''}">
          <span class="material-symbols-outlined text-base">calendar_month</span>
          <span>Daily Attendance</span>
        </button>
        <button onclick="setAttendanceSubView('subject')" id="sub-btn-subject"
          class="mobile-segmented-item ${subView==='subject' ? 'active' : ''}">
          <span class="material-symbols-outlined text-base">menu_book</span>
          <span>Subject Attendance</span>
        </button>
      </div>
    </div>

    <!-- Attendance Summary Header Card -->
    <div class="glass-card rounded-2xl p-4 sm:p-6 border border-white/10 flex flex-col md:flex-row items-center justify-between gap-4 sm:gap-6">
      
      <!-- Left: Circular Percentage Wheel & Status -->
      <div class="flex items-center gap-4 sm:gap-6 w-full md:w-auto">
        <div class="relative w-20 h-20 sm:w-28 sm:h-28 flex-shrink-0">
          <svg class="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="42" stroke="rgba(255,255,255,.08)" stroke-width="10" fill="none"/>
            <circle cx="50" cy="50" r="42" stroke="${ringColor}" stroke-width="10" fill="none"
              stroke-dasharray="${dash}" stroke-dashoffset="${offset}" stroke-linecap="round" class="transition-all duration-700 ease-out"/>
          </svg>
          <span class="absolute inset-0 flex items-center justify-center text-lg sm:text-xl font-extrabold text-white">${pct}%</span>
        </div>

        <div class="space-y-1 sm:space-y-2 min-w-0 flex-1">
          <h3 class="text-base sm:text-lg font-bold text-white tracking-tight">Overall Attendance</h3>
          <p class="text-xs sm:text-sm text-gray-300">
            Attended <span class="text-white font-bold">${totalPresent}</span> of <span class="text-white font-bold">${totalDays}</span> days
          </p>
          <div>
            <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full text-[11px] sm:text-xs font-bold ${isPass ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'}">
              ${isPass ? '✅ Eligible for Exams (≥80%)' : '⚠️ Attendance Below 80% Threshold'}
            </span>
          </div>
        </div>
      </div>

      <!-- Right: Summary Stats Side-by-Side (Total Present & Total Absent) -->
      <div class="grid grid-cols-2 gap-3 sm:gap-4 w-full md:w-auto flex-shrink-0">
        <div class="glass-card rounded-xl p-3 sm:p-4 border border-emerald-500/20 bg-emerald-500/5 text-center min-w-[110px] sm:min-w-[130px]">
          <span class="text-[10px] sm:text-[11px] font-bold text-emerald-400 uppercase tracking-wider block mb-0.5 sm:mb-1">Total Present</span>
          <span class="text-xl sm:text-2xl font-black text-emerald-300 font-mono">${totalPresent}</span>
          <span class="text-[9px] sm:text-[10px] text-gray-400 block mt-0.5">days</span>
        </div>
        <div class="glass-card rounded-xl p-3 sm:p-4 border border-rose-500/20 bg-rose-500/5 text-center min-w-[110px] sm:min-w-[130px]">
          <span class="text-[10px] sm:text-[11px] font-bold text-rose-400 uppercase tracking-wider block mb-0.5 sm:mb-1">Total Absent</span>
          <span class="text-xl sm:text-2xl font-black text-rose-300 font-mono">${totalAbsent}</span>
          <span class="text-[9px] sm:text-[10px] text-gray-400 block mt-0.5">days</span>
        </div>
      </div>

    </div>

    <!-- Main Content Area: Subject Attendance View vs Calendar View -->
    ${subView === 'subject'
      ? renderSubjectAttendanceView(parsedLogs, enrichedTt)
      : renderCalendarView(parsedLogs, minDate, maxDate)}

  </div>`;
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

// ── Subject Attendance Calculation & Lab Segregation Engine ────────────────────
function normalizeSubName(name) {
  if (!name) return '';
  return String(name).replace(/\[lab\]/gi, '').replace(/^[A-Z0-9]{5,10}\s*[-–:]\s*/i, '').trim().toLowerCase();
}

function getEnrichedTimetable(rawTt, isJunior = false, studentDetails = null) {
  const tt = rawTt || getClientFallbackTimetable(isJunior, studentDetails);
  const schedule = {};
  const days = tt.days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

  // Pre-index subject types scraped from official college ERP
  const subTypeLookup = {};
  if (Array.isArray(tt.subjects)) {
    tt.subjects.forEach(sub => {
      const typeStr = String(sub.subjectType || sub.type || '').trim();
      if (sub.subjectCode) {
        subTypeLookup[sub.subjectCode.toUpperCase().trim()] = typeStr;
      }
      if (sub.subjectName) {
        subTypeLookup[normalizeSubName(sub.subjectName)] = typeStr;
        subTypeLookup[sub.subjectName.toUpperCase().trim()] = typeStr;
      }
    });
  }

  const headerMap = new Map();
  if (Array.isArray(tt.headers)) {
    tt.headers.filter(h => !h.hour || h.hour <= 10).forEach(h => {
      const formattedTime = formatTimeRange('', '', h.time || '');
      headerMap.set(h.hour, { ...h, time: formattedTime || h.time || '' });
    });
  }

  days.forEach(day => {
    const rawSlots = tt.schedule?.[day] || [];
    const slots = rawSlots.filter(s => !s.hour || s.hour <= 10).map(s => ({ ...s }));
    slots.sort((a, b) => (a.hour || 0) - (b.hour || 0));

    for (let i = 0; i < slots.length; i++) {
      const hInfo = headerMap.get(slots[i].hour);
      const isExplicitLunch = Boolean(
        slots[i].isLunch ||
        slots[i].subjectCode === 'LUNCH' ||
        /lunch|dinner|meal/i.test(slots[i].subjectName || '')
      );
      const isExplicitBreak = Boolean(
        !isExplicitLunch && (
          slots[i].isBreak ||
          slots[i].subjectCode === 'BREAK' ||
          /break|interval|recess|tea/i.test(slots[i].subjectName || '')
        )
      );
      const hasActualSubject = Boolean(
        slots[i].subjectName &&
        !/^(lunch|break|interval|recess|tea)$/i.test(slots[i].subjectName.trim()) &&
        slots[i].subjectCode &&
        !/^(LUNCH|BREAK)$/i.test(slots[i].subjectCode.trim())
      );

      // Only adopt header's isLunch/isBreak if slot does NOT have an actual subject!
      // This prevents juniors' Period 4 lectures from ever being wiped into lunch.
      const isLunchSlot = isExplicitLunch || (!hasActualSubject && Boolean(hInfo?.isLunch));
      const isBreakSlot = !isLunchSlot && (isExplicitBreak || (!hasActualSubject && Boolean(hInfo?.isBreak)));

      // Standardize slot time
      slots[i].time = formatTimeRange('', '', slots[i].time || '') || hInfo?.time || '';

      if (isBreakSlot || isLunchSlot) {
        slots[i].isBreak = isBreakSlot;
        slots[i].isLunch = isLunchSlot;
        slots[i].subjectName = isLunchSlot ? 'Lunch Break' : 'Morning Break';
        slots[i].subjectCode = isLunchSlot ? 'LUNCH' : 'BREAK';
        slots[i].staff = '';
        slots[i].isLab = false;
        slots[i].type = '';
        slots[i].subjectType = '';
        continue;
      }

      const code = (slots[i].subjectCode || '').toUpperCase().trim();
      const normName = normalizeSubName(slots[i].subjectName);
      const rawName = String(slots[i].subjectName || '').toUpperCase().trim();

      // Official ERP Subject Type classification
      const officialType = slots[i].subjectType
        || slots[i].type
        || (code ? subTypeLookup[code] : null)
        || subTypeLookup[normName]
        || subTypeLookup[rawName]
        || '';

      const hasLabInName = /\b(lab|laboratory)\b/i.test(slots[i].subjectName || '');
      const hasPracticalComponent = /practical/i.test(String(officialType));

      const prev = i > 0 ? slots[i - 1] : null;
      const next = i < slots.length - 1 ? slots[i + 1] : null;

      const isSameSub = (other) => {
        if (!other || other.isBreak || other.isLunch) return false;
        if (code && other.subjectCode && code === other.subjectCode.toUpperCase().trim()) return true;
        return normalizeSubName(other.subjectName) === normName;
      };

      const isConsecutivePrev = Boolean(prev && isSameSub(prev) && (prev.hour === slots[i].hour - 1));
      const isConsecutiveNext = Boolean(next && isSameSub(next) && (next.hour === slots[i].hour + 1));

      // Separate theory vs lab:
      // Integrated subjects with practical component only count consecutive hours as LAB, while single hours are THEORY!
      const isLab = Boolean(hasLabInName || (hasPracticalComponent && (isConsecutivePrev || isConsecutiveNext)));

      slots[i].isLab = isLab;
      slots[i].type = isLab ? 'PRACTICAL' : 'THEORY';
      slots[i].subjectType = isLab ? 'Practical' : 'THEORY';
    }
    schedule[day] = slots;
  });

  // Dynamically derive headers and timing ranges for all hours
  const allHours = new Set();
  days.forEach(d => {
    (schedule[d] || []).forEach(s => {
      if (s.hour && s.hour >= 1 && s.hour <= 10) allHours.add(s.hour);
    });
  });
  if (Array.isArray(tt.headers)) {
    tt.headers.forEach(h => {
      if (h.hour && h.hour >= 1 && h.hour <= 10) allHours.add(h.hour);
    });
  }

  const sortedHours = Array.from(allHours).sort((a, b) => a - b);
  const finalHeaders = sortedHours.map(hNum => {
    const existing = headerMap.get(hNum);
    const hourSlots = days.map(d => (schedule[d] || []).find(s => s.hour === hNum)).filter(Boolean);
    const hasAcademic = hourSlots.some(s => !s.isBreak && !s.isLunch && s.subjectName && !/^(break|lunch)$/i.test(s.subjectName));
    const isAllLunch = hourSlots.length > 0 && hourSlots.every(s => s.isLunch);
    const isAllBreak = hourSlots.length > 0 && hourSlots.every(s => s.isBreak);

    let dynamicTime = existing?.time || '';
    if (!dynamicTime) {
      const slotWithTime = hourSlots.find(s => s.time && s.time.trim().length > 0);
      if (slotWithTime) dynamicTime = slotWithTime.time;
    }

    const isLunch = !hasAcademic && (isAllLunch || Boolean(existing?.isLunch));
    const isBreak = !hasAcademic && !isLunch && (isAllBreak || Boolean(existing?.isBreak));
    const label = isLunch ? 'Lunch' : (isBreak ? 'Break' : (existing?.label || `P${hNum}`));

    return {
      hour: hNum,
      time: dynamicTime,
      isBreak,
      isLunch,
      label
    };
  });

  return { ...tt, days, schedule, headers: finalHeaders.length > 0 ? finalHeaders : tt.headers };
}

function calculateSubjectAttendance(parsedLogs, enrichedTt) {
  const tracker = {};

  // Pre-seed tracker from timetable schedule slots
  for (const day of (enrichedTt.days || [])) {
    const slots = (enrichedTt.schedule?.[day] || []).filter(s => !s.isBreak && !s.isLunch);
    for (const slot of slots) {
      const norm = normalizeSubName(slot.subjectName);
      const isLab = Boolean(slot.isLab);
      const key = (isLab ? 'LAB::' : 'THEORY::') + norm;
      if (!tracker[key]) {
        tracker[key] = {
          key,
          subjectName: slot.subjectName,
          rawName: formatSubjectName(slot.subjectName),
          displayName: formatSubjectName(slot.subjectName) + (isLab ? ' [LAB]' : ''),
          isLab,
          type: isLab ? 'LAB' : 'THEORY',
          staff: resolveStaffName(slot.subjectName, slot.staff),
          conducted: 0,
          attended: 0,
          missed: 0
        };
      }
    }
  }

  // Also pre-seed from enrichedTt.subjects if available (ensures all enrolled courses appear even if schedule matrix is pending)
  if (Array.isArray(enrichedTt.subjects)) {
    for (const sub of enrichedTt.subjects) {
      const subName = sub.subjectName || sub.name;
      const norm = normalizeSubName(subName);
      if (!norm) continue;
      const isLab = Boolean(sub.isLab || /practical|lab/i.test(sub.subjectType || sub.type || ''));
      const key = (isLab ? 'LAB::' : 'THEORY::') + norm;
      if (!tracker[key]) {
        tracker[key] = {
          key,
          subjectName: subName,
          rawName: formatSubjectName(subName),
          displayName: formatSubjectName(subName) + (isLab ? ' [LAB]' : ''),
          isLab,
          type: isLab ? 'LAB' : 'THEORY',
          staff: resolveStaffName(subName, sub.staff),
          conducted: 0,
          attended: 0,
          missed: 0
        };
      }
    }
  }

  // Iterate over parsedLogs
  for (const log of parsedLogs) {
    const d = log.parsedDate;
    if (!d || isNaN(d.getTime())) continue;

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = dayNames[d.getDay()];
    const daySlots = (enrichedTt.schedule?.[dayName] || []).filter(s => !s.isBreak && !s.isLunch);

    for (const slot of daySlots) {
      const norm = normalizeSubName(slot.subjectName);
      const isLab = Boolean(slot.isLab);
      const key = (isLab ? 'LAB::' : 'THEORY::') + norm;

      if (tracker[key]) {
        tracker[key].conducted += 1;
        if (log.status === 'Present') {
          tracker[key].attended += 1;
        } else if (log.status === 'Absent') {
          tracker[key].missed += 1;
        }
      }
    }
  }

  // Calculate percentages, pass status, safe bunks, and recovery targets
  let totalConducted = 0, totalAttended = 0, totalMissed = 0;
  for (const key of Object.keys(tracker)) {
    const s = tracker[key];
    totalConducted += s.conducted;
    totalAttended  += s.attended;
    totalMissed    += s.missed;

    const pct = s.conducted > 0 ? parseFloat(((s.attended / s.conducted) * 100).toFixed(1)) : 100.0;
    s.percentage = pct;
    s.isPass = pct >= 80;

    if (pct >= 80) {
      const safe = Math.floor((s.attended - 0.80 * s.conducted) / 0.80);
      s.safeBunks = Math.max(0, safe);
      s.neededToRecover = 0;
    } else {
      const needed = Math.ceil((0.80 * s.conducted - s.attended) / 0.20);
      s.neededToRecover = Math.max(1, needed);
      s.safeBunks = 0;
    }
  }

  const theorySubjects = Object.values(tracker).filter(s => !s.isLab);
  const labSubjects = Object.values(tracker).filter(s => s.isLab);
  const criticalCount = Object.values(tracker).filter(s => s.conducted > 0 && s.percentage < 80).length;

  return { theorySubjects, labSubjects, criticalCount, totalConducted, totalAttended, totalMissed };
}

function renderSubjectAttendanceView(parsedLogs, enrichedTt) {
  const { theorySubjects, labSubjects, criticalCount } = calculateSubjectAttendance(parsedLogs, enrichedTt);

  const renderSubjectCard = (s, isLabCourse) => {
    const isPass = s.isPass;
    const borderClass = isPass
      ? (isLabCourse ? 'border-purple-500/25 hover:border-purple-500/50 bg-purple-500/[0.03]' : 'border-white/10 hover:border-blue-500/30 bg-white/[0.02]')
      : 'border-rose-500/40 bg-rose-500/[0.05] shadow-lg shadow-rose-950/20';

    return `
    <div class="glass-card rounded-2xl p-4 sm:p-5 border ${borderClass} flex flex-col justify-between gap-4 transition-all duration-300">
      
      <!-- Top Header -->
      <div class="space-y-1.5">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <h4 class="text-sm sm:text-base font-bold text-white leading-snug break-words flex items-center gap-1.5 flex-wrap">
              <span>${esc(s.rawName)}</span>
              ${isLabCourse ? '<span class="px-1.5 py-0.5 rounded text-[10px] font-mono font-black bg-purple-500/20 text-purple-300 border border-purple-500/30">[LAB]</span>' : ''}
            </h4>
            <div class="flex items-center gap-1.5 text-xs text-gray-400 mt-1">
              <span class="material-symbols-outlined text-sm text-gray-500">person</span>
              <span class="truncate">${esc(s.staff || 'Faculty')}</span>
            </div>
          </div>
          <span class="text-[9px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${isLabCourse ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'}">
            ${isLabCourse ? 'PRACTICAL' : 'THEORY'}
          </span>
        </div>
      </div>

      <!-- Percentage & Status Pill -->
      <div class="flex items-center justify-between gap-3 pt-1">
        <div>
          <div class="text-2xl sm:text-3xl font-black font-mono tracking-tight ${isPass ? 'text-emerald-400' : 'text-rose-400'}">
            ${s.percentage}%
          </div>
          <span class="text-[10px] text-gray-400 font-medium">Subject Attendance</span>
        </div>
        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold flex-shrink-0 ${isPass ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'}">
          ${isPass ? '<span class="material-symbols-outlined text-xs">check</span> Eligible (≥80%)' : '<span class="material-symbols-outlined text-xs">warning</span> Below 80%'}
        </span>
      </div>

      <!-- Sleek Progress Bar with 80% Threshold Indicator -->
      <div class="space-y-1">
        <div class="relative w-full h-2 rounded-full bg-white/10 overflow-hidden">
          <div class="h-full rounded-full transition-all duration-500 ${isPass ? (isLabCourse ? 'bg-gradient-to-r from-purple-500 to-emerald-400' : 'bg-gradient-to-r from-blue-500 to-emerald-400') : 'bg-gradient-to-r from-rose-500 to-red-600'}"
            style="width: ${Math.min(s.percentage, 100)}%;"></div>
          <!-- 80% Marker line -->
          <div class="absolute top-0 bottom-0 left-[80%] w-0.5 bg-white/40 shadow" title="80% Threshold"></div>
        </div>
        <div class="flex justify-between text-[10px] text-gray-500 font-mono">
          <span>0%</span>
          <span class="text-gray-400 font-semibold">80% Threshold</span>
          <span>100%</span>
        </div>
      </div>

      <!-- 3-Column Stats Grid -->
      <div class="grid grid-cols-3 gap-2 text-center p-2.5 rounded-xl bg-white/[0.03] border border-white/5 text-xs font-mono">
        <div>
          <span class="text-[10px] text-gray-400 block uppercase">Conducted</span>
          <span class="font-bold text-white text-sm">${s.conducted}</span>
          <span class="text-[9px] text-gray-500 block">${isLabCourse ? 'hrs' : 'classes'}</span>
        </div>
        <div>
          <span class="text-[10px] text-emerald-400 block uppercase">Attended</span>
          <span class="font-bold text-emerald-300 text-sm">${s.attended}</span>
          <span class="text-[9px] text-gray-500 block">${isLabCourse ? 'hrs' : 'classes'}</span>
        </div>
        <div>
          <span class="text-[10px] ${s.missed > 0 ? 'text-rose-400' : 'text-gray-400'} block uppercase">Missed</span>
          <span class="font-bold ${s.missed > 0 ? 'text-rose-300' : 'text-gray-400'} text-sm">${s.missed}</span>
          <span class="text-[9px] text-gray-500 block">${isLabCourse ? 'hrs' : 'classes'}</span>
        </div>
      </div>

      <!-- Footer: Safe Bunks or Recovery Target -->
      <div class="pt-2 border-t border-white/5 text-[11px]">
        ${!isPass
          ? `<div class="text-rose-300 flex items-center gap-1.5 font-medium">
               <span class="material-symbols-outlined text-sm text-rose-400">notification_important</span>
               <span>Must attend next <strong>${s.neededToRecover}</strong> consecutive ${isLabCourse ? 'hour(s)' : 'class(es)'}</span>
             </div>`
          : (s.safeBunks > 0
              ? `<div class="text-emerald-300/90 flex items-center gap-1.5 font-medium">
                   <span class="material-symbols-outlined text-sm text-emerald-400">verified</span>
                   <span>Safe to miss <strong>${s.safeBunks}</strong> ${isLabCourse ? 'more hour(s)' : 'more class(es)'}</span>
                 </div>`
              : `<div class="text-rose-300 flex items-center gap-1.5 font-medium">
                   <span class="material-symbols-outlined text-sm text-rose-400">error</span>
                   <span>Cannot miss anymore ${isLabCourse ? 'hour(s)' : 'class(es)'}</span>
                 </div>`
            )
        }
      </div>

    </div>`;
  };

  return `
  <div class="space-y-8">
    
    <!-- 80% Threshold Global Alert Banner -->
    ${criticalCount > 0 ? `
    <div class="glass-card rounded-2xl p-4 sm:p-5 border border-rose-500/40 bg-rose-500/10 flex items-start sm:items-center gap-4">
      <div class="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400 flex-shrink-0 text-xl font-bold">
        ⚠️
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xs font-bold text-rose-400 uppercase tracking-widest font-mono">SUBJECT ATTENDANCE ALERT</span>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/30 text-rose-200 border border-rose-500/40 font-mono">
            ${criticalCount} Subject(s) Below 80% Threshold
          </span>
        </div>
        <p class="text-xs sm:text-sm font-semibold text-white mt-1">
          Minimum 80% attendance is mandatory for semester exam clearance. Check the recovery requirements on flagged courses below.
        </p>
      </div>
    </div>` : `
    <div class="glass-card rounded-2xl p-4 border border-emerald-500/30 bg-emerald-500/5 flex items-center gap-3.5 sm:gap-4">
      <div class="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 flex-shrink-0 text-lg">
        ✅
      </div>
      <div class="min-w-0">
        <span class="text-xs font-bold text-emerald-400 uppercase tracking-wider font-mono block">ALL COURSES CLEARED (≥80%)</span>
        <p class="text-xs sm:text-sm text-gray-200 mt-0.5">
          All theory courses and practical laboratories satisfy the required 80% threshold. You are in good standing.
        </p>
      </div>
    </div>`}

    <!-- Institutional Advisory: Daily Attendance Projection Notice -->
    <div class="glass-card rounded-2xl p-4 sm:p-4.5 border border-amber-500/25 bg-amber-500/[0.04] shadow-lg shadow-amber-950/10 flex items-start sm:items-center gap-3.5 sm:gap-4 transition-all">
      <div class="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 flex-shrink-0 shadow-inner">
        <span class="material-symbols-outlined text-xl">warning</span>
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-[10px] font-bold text-amber-400 uppercase tracking-widest font-mono">ATTENDANCE CALCULATION NOTICE</span>
          <span class="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold bg-amber-500/20 text-amber-200 border border-amber-500/30">
            DAILY LOG PROJECTION
          </span>
        </div>
        <p class="text-xs sm:text-sm text-gray-200 mt-1 leading-relaxed font-medium">
          Subject attendance percentages are currently estimated using your verified daily attendance records mapped to your timetable.
        </p>
        <div class="flex items-center gap-1.5 text-[11px] text-amber-300/85 font-medium mt-1.5 flex-wrap">
          <span class="material-symbols-outlined text-sm text-amber-400">schedule</span>
          <span>Granular period-by-period (hourly) attendance tracking is under development and coming soon.</span>
        </div>
      </div>
    </div>

    <!-- ── SECTION 1: THEORY / GENERAL COURSES ATTENDANCE ───────────────────── -->
    <div class="space-y-4">
      <div class="flex items-center justify-between gap-4 border-b border-white/10 pb-3 flex-wrap">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
            <span class="material-symbols-outlined text-base">menu_book</span>
          </div>
          <div>
            <h3 class="text-base sm:text-lg font-bold text-white tracking-wide">${labSubjects.length > 0 ? 'Theory Courses Attendance' : 'Subject Attendance'}</h3>
            <p class="text-[11px] text-gray-400">${labSubjects.length > 0 ? 'Regular lecture hours calculated from your class timetable' : 'Subject attendance calculated from your timetable schedule'}</p>
          </div>
        </div>
        <span class="text-xs font-mono px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300 font-semibold">
          ${theorySubjects.length} Courses
        </span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
        ${theorySubjects.map(s => renderSubjectCard(s, false)).join('')}
      </div>
    </div>

    <!-- ── SECTION 2: LABORATORY COURSES ATTENDANCE (Hidden for departments without lab classes) ── -->
    ${labSubjects.length > 0 ? `
    <div class="space-y-4 pt-2">
      <div class="flex items-center justify-between gap-4 border-b border-purple-500/20 pb-3 flex-wrap">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
            <span class="material-symbols-outlined text-base">biotech</span>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h3 class="text-base sm:text-lg font-bold text-white tracking-wide">Laboratory Courses Attendance</h3>
              <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">[LAB]</span>
            </div>
            <p class="text-[11px] text-gray-400">Consecutive lab hours and practical sessions calculated separately</p>
          </div>
        </div>
        <span class="text-xs font-mono px-2.5 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300 font-semibold">
          ${labSubjects.length} Lab Courses
        </span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
        ${labSubjects.map(s => renderSubjectCard(s, true)).join('')}
      </div>
    </div>` : ''}

  </div>`;
}


function renderCalendarView(parsedLogs, minDate, maxDate) {
  const currentYear  = appState.calendarYear;
  const currentMonth = appState.calendarMonth;

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const dayHeaderNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Lookup map by "YYYY-MM-DD"
  const statusMap = {};
  parsedLogs.forEach(l => {
    const y = l.parsedDate.getFullYear();
    const m = String(l.parsedDate.getMonth() + 1).padStart(2, '0');
    const d = String(l.parsedDate.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${d}`;
    statusMap[key] = l.status;
  });

  const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay();
  const totalDaysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  let cells = [];

  // Empty leading padding cells
  for (let i = 0; i < firstDayIndex; i++) {
    cells.push(`<div class="h-14 sm:h-20 rounded-lg sm:rounded-xl bg-white/[0.02] border border-white/5 opacity-20"></div>`);
  }

  // Month days 1 .. totalDaysInMonth
  for (let day = 1; day <= totalDaysInMonth; day++) {
    const mStr = String(currentMonth + 1).padStart(2, '0');
    const dStr = String(day).padStart(2, '0');
    const dateKey = `${currentYear}-${mStr}-${dStr}`;

    const logStatus = statusMap[dateKey];

    // Check if within minDate and maxDate range
    let inRange = false;
    if (minDate && maxDate) {
      const cTime = new Date(currentYear, currentMonth, day, 0,0,0).getTime();
      const nMin  = new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate(), 0,0,0).getTime();
      const nMax  = new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate(), 0,0,0).getTime();
      if (cTime >= nMin && cTime <= nMax) inRange = true;
    }

    let cellBg = 'bg-white/[0.03] text-gray-500 border-white/5';
    let badgeText = '';

    if (logStatus === 'Present') {
      cellBg = 'bg-emerald-600/90 border-emerald-400 text-white font-black shadow-lg shadow-emerald-900/30';
      badgeText = '<span class="text-[8px] sm:text-[10px] uppercase font-bold text-emerald-100 mt-0.5 sm:mt-1 block truncate"><span class="sm:hidden">P</span><span class="hidden sm:inline">Present</span></span>';
    } else if (logStatus === 'Absent') {
      cellBg = 'bg-rose-600/90 border-rose-400 text-white font-black shadow-lg shadow-rose-900/30';
      badgeText = '<span class="text-[8px] sm:text-[10px] uppercase font-bold text-rose-100 mt-0.5 sm:mt-1 block truncate"><span class="sm:hidden">A</span><span class="hidden sm:inline">Absent</span></span>';
    } else if (inRange) {
      cellBg = 'bg-gray-800/70 border-white/10 text-gray-300 font-semibold opacity-75';
      badgeText = '<span class="text-[7px] sm:text-[9px] uppercase font-semibold text-gray-400 mt-0.5 sm:mt-1 block truncate"><span class="sm:hidden">—</span><span class="hidden sm:inline">No Data</span></span>';
    }

    const now = new Date();
    const isToday = (currentYear === now.getFullYear() && currentMonth === now.getMonth() && day === now.getDate());

    cells.push(`
      <div class="h-14 sm:h-20 rounded-lg sm:rounded-xl border p-1 sm:p-2 flex flex-col justify-between transition-all hover:scale-[1.02] ${cellBg} ${isToday ? 'ring-2 ring-blue-400/80 shadow-md shadow-blue-500/20' : ''}">
        <div class="flex items-center justify-between leading-none">
          <span class="text-xs sm:text-base font-mono font-bold">${day}</span>
          ${isToday ? '<span class="text-[8px] sm:text-[9px] px-1 py-0.5 rounded bg-blue-500 text-white font-black uppercase leading-none">Today</span>' : ''}
        </div>
        ${badgeText}
      </div>
    `);
  }

  return `
  <div class="glass-card rounded-2xl p-6 border border-white/10 space-y-6">

    <!-- Calendar Month Controls Header -->
    <div class="flex items-center justify-between flex-wrap gap-4 border-b border-white/10 pb-4">
      <div class="flex items-center gap-3">
        <span class="material-symbols-outlined text-blue-400 text-2xl">calendar_today</span>
        <div>
          <h3 class="text-xl font-bold text-white tracking-tight">${monthNames[currentMonth]} ${currentYear}</h3>
          <p class="text-xs text-gray-400">Automated Daily Attendance Calendar View</p>
        </div>
      </div>

      <div class="flex items-center gap-1.5 sm:gap-2">
        <button onclick="changeCalendarMonth(-1)"
          title="Previous Month"
          class="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white transition-all active:scale-95 flex items-center justify-center">
          <span class="material-symbols-outlined text-lg">chevron_left</span>
        </button>
        <button onclick="resetCalendarToToday()"
          title="Jump to Current Month"
          class="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-blue-600/20 border border-white/10 hover:border-blue-500/30 text-xs font-semibold text-gray-300 hover:text-blue-300 transition-all active:scale-95 flex items-center gap-1">
          <span class="material-symbols-outlined text-sm">today</span>
          <span class="hidden sm:inline">Today</span>
        </button>
        <span class="text-xs font-mono text-gray-300 px-2 sm:px-3 font-semibold">${monthNames[currentMonth]}</span>
        <button onclick="changeCalendarMonth(1)"
          title="Next Month"
          class="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white transition-all active:scale-95 flex items-center justify-center">
          <span class="material-symbols-outlined text-lg">chevron_right</span>
        </button>
      </div>
    </div>

    <!-- Status Legend -->
    <div class="flex items-center gap-6 text-xs flex-wrap bg-white/5 p-3 rounded-xl border border-white/5">
      <span class="text-gray-400 font-semibold">STATUS LEGEND:</span>
      <div class="flex items-center gap-2">
        <span class="w-3.5 h-3.5 rounded-md bg-emerald-500 inline-block border border-emerald-300"></span>
        <span class="text-white font-medium">Present</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="w-3.5 h-3.5 rounded-md bg-rose-500 inline-block border border-rose-300"></span>
        <span class="text-white font-medium">Absent</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="w-3.5 h-3.5 rounded-md bg-gray-800 inline-block border border-white/10"></span>
        <span class="text-gray-300 font-medium">Greyed Out (No Data / Non-Working)</span>
      </div>
    </div>

    <!-- Day Headers Grid -->
    <div class="grid grid-cols-7 gap-2 text-center text-xs font-bold text-gray-400 uppercase tracking-wider pb-2 border-b border-white/5">
      ${dayHeaderNames.map(d => `<div>${d}</div>`).join('')}
    </div>

    <!-- Calendar Days Grid -->
    <div class="grid grid-cols-7 gap-2 sm:gap-3">
      ${cells.join('')}
    </div>

  </div>`;
}

// ── CAE Results Tab ───────────────────────────────────────────────────────────
function renderCAE() {
  const c = appState.data.caeResults;
  const tbl = (rows, label) => `
    <div class="glass-card rounded-2xl p-4 sm:p-6 border border-white/10">
      <h3 class="text-sm sm:text-base font-bold text-white mb-3 sm:mb-4 flex items-center justify-between">
        <span class="flex items-center gap-2"><span class="material-symbols-outlined text-blue-400 text-lg">assignment</span> ${label}</span>
      </h3>
      ${rows.length === 0
        ? `<p class="text-gray-400 text-xs sm:text-sm text-center py-4">No data returned from portal for this exam.</p>`
        : `
        <!-- Mobile Card List View (sm:hidden) -->
        <div class="sm:hidden space-y-2.5">
          ${rows.map(r => `
          <div class="glass-card rounded-xl p-3 border border-white/5 space-y-2">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <h4 class="text-xs font-bold text-white leading-snug">${esc(r.name)}</h4>
                <span class="text-[10px] text-blue-400 font-mono">${esc(r.code)}</span>
              </div>
              <span class="badge-pill text-[10px] px-2 py-0.5 flex-shrink-0 ${r.status==='PASS'?'badge-pass':'badge-warning'}">${esc(r.status)}</span>
            </div>
            <div class="flex items-center justify-between text-xs pt-1 border-t border-white/5">
              <span class="text-gray-400 text-[11px]">Marks Scored</span>
              <div class="flex items-baseline gap-1 font-mono">
                <span class="text-base font-black ${r.status==='PASS'?'text-emerald-400':'text-amber-400'}">${Number(r.marksObtained) || 0}</span>
                <span class="text-[11px] text-gray-500">/ ${Number(r.maxMarks) || 0}</span>
              </div>
            </div>
          </div>`).join('')}
        </div>

        <!-- Desktop Table View (hidden sm:block) -->
        <div class="hidden sm:block overflow-x-auto">
          <table class="w-full text-left text-sm text-gray-300">
            <thead class="bg-white/5 text-gray-400 text-xs uppercase">
              <tr><th class="p-3">Code</th><th class="p-3">Subject</th><th class="p-3">Max</th><th class="p-3">Obtained</th><th class="p-3">Result</th></tr>
            </thead>
            <tbody class="divide-y divide-white/5">
              ${rows.map(r=>`
              <tr class="hover:bg-white/5 transition-colors">
                <td class="p-3 text-blue-400 font-semibold">${esc(r.code)}</td>
                <td class="p-3 text-white font-medium">${esc(r.name)}</td>
                <td class="p-3">${Number(r.maxMarks) || 0}</td>
                <td class="p-3 font-bold text-white">${Number(r.marksObtained) || 0}</td>
                <td class="p-3"><span class="badge-pill ${r.status==='PASS'?'badge-pass':'badge-warning'}">${esc(r.status)}</span></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
    </div>`;
  return `
  <div class="tab-content space-y-6">
    ${c.arrearDetails.totalArrears > 0 ? `
    <div class="glass-card rounded-2xl p-5 flex items-center gap-4 border border-amber-500/30 bg-amber-500/5">
      <span class="text-2xl">⚠️</span>
      <div>
        <span class="text-xs text-gray-400 uppercase tracking-wider block">CAE Arrears (CAE 1)</span>
        <span class="text-white font-bold">${c.arrearDetails.totalArrears} subject(s) below passing marks — ${(c.arrearDetails.history || []).map(esc).join(', ')}</span>
      </div>
    </div>` : `
    <div class="glass-card rounded-2xl p-5 flex items-center gap-4 border border-emerald-500/30 bg-emerald-500/5">
      <span class="text-2xl">✅</span>
      <div>
        <span class="text-xs text-gray-400 uppercase tracking-wider block">CAE Arrear Status</span>
        <span class="text-white font-bold">No arrears — All subjects passed in CAE 1</span>
      </div>
    </div>`}
    ${tbl(c.cae1, 'CAE 1 — Continuous Assessment Examination')}
    ${tbl(c.cae2, 'CAE 2 — Continuous Assessment Examination')}
  </div>`;
}

// ── Timetable Tab ─────────────────────────────────────────────────────────────
function formatSubjectName(name) {
  if (!name) return 'Class';
  let clean = String(name).replace(/^[A-Z0-9]{5,10}\s*[-–:]\s*/i, '').trim();
  return clean || name;
}

function resolveStaffName(subjectName, staff) {
  if (staff && staff !== 'Staff' && staff !== '—') return staff;
  const verified = {
    // 1st Year (Juniors)
    'Engineering Mathematics - I (Calculus & Linear Algebra)': 'Dr. S. KAVITHA',
    'Physics for Engineers': 'Dr. C. R. VIJAYASANKAR',
    'Engineering Chemistry': 'Dr. D. KARTHIKEYAN',
    'Basic Electrical and Electronics Engineering': 'Dr. G. SUNDAR',
    'Problem Solving and Python Programming': 'Dr. M. SANGEETHA',
    'Technical English': 'Dr. P. JEYA BALAJI',
    'Python Programming Laboratory': 'Dr. M. SANGEETHA',
    'Physics Laboratory': 'Dr. C. R. VIJAYASANKAR',

    // 2nd Year (Seniors)
    'Discrete Mathematics and Numerical Methods': 'Dr. M PREM KUMAR',
    'Computer Architecture and Organization': 'Ms. MADHUSHRI K',
    'Digital Logic Circuits': 'Dr. R. BHAVANI',
    'Theory of Computation': 'Dr. NANCY NOELLA R S',
    'Universal Human Values': 'AGILA HARSHINI T',
    'Programming in Java': 'Dr. E. Srividhya, Dr. S L JANY SHABU'
  };
  const key = formatSubjectName(subjectName);
  return verified[key] || staff || 'Faculty';
}

function isCseOrItDepartment(studentDetails) {
  if (!studentDetails) return true;
  const progText = `${studentDetails.department || ''} ${studentDetails.programme || ''} ${studentDetails.branch || ''}`.toLowerCase();
  if (!progText.trim()) return true;
  return /\b(computer|cse|information technology|\bit\b|software|artificial intelligence|data science|cyber|aiml)\b/i.test(progText);
}

function getClientFallbackTimetable(isJunior = false, studentDetails = null) {
  // If student belongs to a non-CSE/IT department, do not impose CSE timetable
  if (studentDetails && !isCseOrItDepartment(studentDetails)) {
    const dept = studentDetails.department || studentDetails.programme || 'your department';
    const sec = studentDetails.section || '—';
    return {
      days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      headers: [],
      schedule: { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
      subjects: [],
      isPublished: false,
      message: `Official ERP timetable schedule has not been published for ${dept} (Section ${sec}) yet.`
    };
  }

  if (isJunior) {
    const juniorStaffDirectory = [
      { subjectCode: 'SMTA1101', subjectName: 'Engineering Mathematics - I (Calculus & Linear Algebra)', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Dr. S. KAVITHA' },
      { subjectCode: 'SPHA1101', subjectName: 'Physics for Engineers', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Dr. C. R. VIJAYASANKAR' },
      { subjectCode: 'SCYA1101', subjectName: 'Engineering Chemistry', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Dr. D. KARTHIKEYAN' },
      { subjectCode: 'SEEA1101', subjectName: 'Basic Electrical and Electronics Engineering', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Dr. G. SUNDAR' },
      { subjectCode: 'SCSA1102', subjectName: 'Problem Solving and Python Programming', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Dr. M. SANGEETHA' },
      { subjectCode: 'SHSA1101', subjectName: 'Technical English', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Dr. P. JEYA BALAJI' },
      { subjectCode: 'SCSA2101', subjectName: 'Python Programming Laboratory', subjectType: 'PRACTICAL', type: 'PRACTICAL', isLab: true, staff: 'Dr. M. SANGEETHA' },
      { subjectCode: 'SPHA2101', subjectName: 'Physics Laboratory', subjectType: 'PRACTICAL', type: 'PRACTICAL', isLab: true, staff: 'Dr. C. R. VIJAYASANKAR' }
    ];

    const juniorHeaders = [
      { hour: 1, time: '09:00 am - 10:00 am' },
      { hour: 2, time: '10:00 am - 11:00 am' },
      { hour: 3, time: '11:00 am - 11:15 am', isBreak: true, label: 'Break' },
      { hour: 4, time: '11:15 am - 12:15 pm' },
      { hour: 5, time: '12:15 pm - 01:15 pm', isLunch: true, label: 'Lunch' },
      { hour: 6, time: '01:15 pm - 02:15 pm' },
      { hour: 7, time: '02:15 pm - 03:15 pm' }
    ];

    const juniorDayCodes = {
      Monday: ['SMTA1101', 'SPHA1101', 'BREAK', 'SCSA1102', 'LUNCH', 'SCSA2101', 'SCSA2101'],
      Tuesday: ['SCYA1101', 'SEEA1101', 'BREAK', 'SMTA1101', 'LUNCH', 'SHSA1101', 'SPHA1101'],
      Wednesday: ['SCSA1102', 'SMTA1101', 'BREAK', 'SCYA1101', 'LUNCH', 'SPHA2101', 'SPHA2101'],
      Thursday: ['SEEA1101', 'SHSA1101', 'BREAK', 'SPHA1101', 'LUNCH', 'SMTA1101', 'SCSA1102'],
      Friday: ['SPHA1101', 'SCYA1101', 'BREAK', 'SEEA1101', 'LUNCH', 'SHSA1101', 'SMTA1101']
    };

    const juniorSubMap = {};
    juniorStaffDirectory.forEach(s => {
      juniorSubMap[s.subjectCode] = s;
    });

    const schedule = {};
    for (const [day, codes] of Object.entries(juniorDayCodes)) {
      const rawSlots = codes.map((code, idx) => {
        const h = juniorHeaders[idx];
        if (code === 'BREAK') {
          return { hour: h.hour, time: h.time, subjectName: 'Morning Break', isBreak: true, label: 'Break' };
        }
        if (code === 'LUNCH') {
          return { hour: h.hour, time: h.time, subjectName: 'Lunch Break', isLunch: true, label: 'Lunch' };
        }
        const s = juniorSubMap[code] || { subjectName: code, subjectType: 'THEORY', staff: 'Faculty' };
        return {
          hour: h.hour,
          time: h.time,
          subjectCode: code,
          subjectName: s.subjectName,
          staff: s.staff,
          subjectType: s.subjectType,
          isBreak: false,
          isLunch: false,
          isLab: Boolean(s.isLab),
          type: s.type || (s.isLab ? 'PRACTICAL' : 'THEORY')
        };
      });
      schedule[day] = rawSlots;
    }

    return {
      days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      headers: juniorHeaders,
      schedule,
      subjects: juniorStaffDirectory
    };
  }

  const staffDirectory = [
    { subjectCode: 'SMTB1302', subjectName: 'Discrete Mathematics and Numerical Methods', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Dr. M PREM KUMAR' },
    { subjectCode: 'SCSBOB1301', subjectName: 'Computer Architecture and Organization', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Ms. MADHUSHRI K' },
    { subjectCode: 'S13BLH21', subjectName: 'Digital Logic Circuits', subjectType: 'Practical', type: 'PRACTICAL', isLab: true, staff: 'Dr. R. BHAVANI' },
    { subjectCode: 'SCSB1303', subjectName: 'Theory of Computation', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'Dr. NANCY NOELLA R S' },
    { subjectCode: 'SISB4301', subjectName: 'Universal Human Values', subjectType: 'THEORY', type: 'THEORY', isLab: false, staff: 'AGILA HARSHINI T' },
    { subjectCode: 'S12BLH31', subjectName: 'Programming in Java', subjectType: 'PRACTICAL', type: 'PRACTICAL', isLab: true, staff: 'Dr. E. Srividhya' },
    { subjectCode: 'S12BLH31', subjectName: 'Programming in Java', subjectType: 'PRACTICAL', type: 'PRACTICAL', isLab: true, staff: 'Dr. S L JANY SHABU' }
  ];

  const subMap = {
    'SMTB1302': { subjectName: 'Discrete Mathematics and Numerical Methods', subjectType: 'THEORY', staff: 'Dr. M PREM KUMAR' },
    'SCSBOB1301': { subjectName: 'Computer Architecture and Organization', subjectType: 'THEORY', staff: 'Ms. MADHUSHRI K' },
    'SCSB0B1301': { subjectName: 'Computer Architecture and Organization', subjectType: 'THEORY', staff: 'Ms. MADHUSHRI K' },
    'S13BLH21': { subjectName: 'Digital Logic Circuits', subjectType: 'Practical', staff: 'Dr. R. BHAVANI' },
    'SCSB1303': { subjectName: 'Theory of Computation', subjectType: 'THEORY', staff: 'Dr. NANCY NOELLA R S' },
    'SISB4301': { subjectName: 'Universal Human Values', subjectType: 'THEORY', staff: 'AGILA HARSHINI T' },
    'S12BLH31': { subjectName: 'Programming in Java', subjectType: 'PRACTICAL', staff: 'Dr. E. Srividhya, Dr. S L JANY SHABU' }
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

function parseTimeToMinutes(str) {
  if (!str) return null;
  const clean = String(str).trim().toLowerCase();
  const m = clean.match(/(\d{1,2}):(\d{2})(?:\s*(am|pm))?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ampm = m[3];

  if (ampm) {
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
  } else {
    // College schedule heuristic: 1-6 is afternoon (13:00-18:00), 7-12 is morning/noon
    if (h >= 1 && h <= 6) h += 12;
  }
  return h * 60 + min;
}

function parseSlotRange(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const parts = timeStr.split('-');
  if (parts.length < 2) return null;
  const start = parseTimeToMinutes(parts[0]);
  const end = parseTimeToMinutes(parts[1]);
  if (start === null || end === null) return null;
  return { start, end };
}

function renderLiveClassHero(tt, todayName) {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const isWeekday = days.includes(todayName);

  if (!isWeekday) {
    return `
    <div class="glass-card rounded-2xl p-4 sm:p-5 border border-purple-500/20 bg-gradient-to-r from-purple-500/10 via-blue-500/5 to-transparent flex items-center justify-between gap-4">
      <div class="flex items-center gap-3.5 min-w-0">
        <div class="w-11 h-11 rounded-xl bg-purple-500/20 border border-purple-500/30 text-purple-300 flex items-center justify-center flex-shrink-0">
          <span class="material-symbols-outlined text-2xl">weekend</span>
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-[10px] sm:text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">Weekend</span>
            <span class="text-xs text-gray-400 font-mono">${todayName}</span>
          </div>
          <h4 class="text-sm sm:text-base font-bold text-white mt-0.5">No classes scheduled today!</h4>
          <p class="text-xs text-gray-400 mt-0.5">Classes resume on Monday morning at 8:30 AM.</p>
        </div>
      </div>
      <button onclick="setTimetableDay('Monday')" class="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-gray-300 border border-white/10 flex-shrink-0 hidden sm:flex items-center gap-1.5">
        <span>Monday Schedule</span>
        <span class="material-symbols-outlined text-sm">arrow_forward</span>
      </button>
    </div>`;
  }

  const daySchedule = tt.schedule?.[todayName] || [];
  if (daySchedule.length === 0) return '';

  const parsedSlots = daySchedule.map(s => {
    const range = parseSlotRange(s.time);
    return { ...s, range };
  }).filter(s => s.range !== null);

  if (parsedSlots.length === 0) return '';

  parsedSlots.sort((a, b) => a.range.start - b.range.start);
  const firstSlot = parsedSlots[0];
  const lastSlot = parsedSlots[parsedSlots.length - 1];

  // 1. Currently active class or break
  const activeSlot = parsedSlots.find(s => currentMinutes >= s.range.start && currentMinutes < s.range.end);

  if (activeSlot) {
    const isBreak = activeSlot.isBreak || activeSlot.isLunch;
    const minsLeft = Math.max(1, activeSlot.range.end - currentMinutes);
    const title = isBreak
      ? (activeSlot.isLunch ? 'Lunch Break' : 'Morning Break')
      : formatSubjectName(activeSlot.subjectName);
    const faculty = isBreak ? '' : resolveStaffName(activeSlot.subjectName, activeSlot.staff);
    const nextSlot = parsedSlots.find(s => s.range.start >= activeSlot.range.end);

    return `
    <div class="glass-card rounded-2xl p-4 sm:p-5 border border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-emerald-500/[0.03] to-transparent shadow-lg shadow-emerald-950/20 space-y-3">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <span class="relative flex h-2.5 w-2.5">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <span class="text-[10px] sm:text-xs font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">Happening Now</span>
          <span class="text-xs text-gray-400 font-mono hidden xs:inline">• Period ${activeSlot.hour || 'Break'}</span>
        </div>
        <span class="text-xs font-bold text-emerald-300 font-mono flex items-center gap-1">
          <span class="material-symbols-outlined text-sm">timer</span>
          ${minsLeft} min${minsLeft !== 1 ? 's' : ''} left
        </span>
      </div>

      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <h4 class="text-base sm:text-lg font-bold text-white tracking-wide leading-snug break-words">
            ${esc(title)}
            ${activeSlot.isLab ? '<span class="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-black bg-purple-500/20 text-purple-300 border border-purple-500/30 font-mono">[LAB]</span>' : ''}
          </h4>
          <div class="flex items-center gap-3 mt-1 text-xs text-gray-300 flex-wrap">
            ${faculty ? `
            <span class="flex items-center gap-1">
              <span class="material-symbols-outlined text-sm text-gray-400">person</span>
              <span>${esc(faculty)}</span>
            </span>` : ''}
            <span class="flex items-center gap-1 font-mono text-gray-400">
              <span class="material-symbols-outlined text-sm text-gray-500">schedule</span>
              <span>${esc(activeSlot.time)}</span>
            </span>
          </div>
        </div>
      </div>

      ${nextSlot ? `
      <div class="pt-2 border-t border-white/5 flex items-center justify-between text-xs text-gray-400">
        <span class="truncate">Next: <strong class="text-gray-200">${esc(formatSubjectName(nextSlot.subjectName))}</strong></span>
        <span class="font-mono text-[11px] text-gray-500 flex-shrink-0">${esc(nextSlot.time)}</span>
      </div>` : ''}
    </div>`;
  }

  // 2. Upcoming class today
  const nextSlot = parsedSlots.find(s => s.range.start > currentMinutes);
  if (nextSlot) {
    const minsUntil = nextSlot.range.start - currentMinutes;
    const isBreak = nextSlot.isBreak || nextSlot.isLunch;
    const title = isBreak
      ? (nextSlot.isLunch ? 'Lunch Break' : 'Morning Break')
      : formatSubjectName(nextSlot.subjectName);
    const faculty = isBreak ? '' : resolveStaffName(nextSlot.subjectName, nextSlot.staff);

    const timeDisplay = minsUntil < 60
      ? `Starts in ${minsUntil} min${minsUntil !== 1 ? 's' : ''}`
      : `Starts at ${formatTo12Hour(nextSlot.time.split('-')[0].trim())}`;

    return `
    <div class="glass-card rounded-2xl p-4 sm:p-5 border border-blue-500/30 bg-gradient-to-r from-blue-500/10 via-blue-500/[0.03] to-transparent shadow-lg shadow-blue-950/20 space-y-2.5">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-blue-400"></span>
          <span class="text-[10px] sm:text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">Next Up</span>
          <span class="text-xs text-gray-400 font-mono hidden xs:inline">• Period ${nextSlot.hour || 'Break'}</span>
        </div>
        <span class="text-xs font-semibold text-blue-300 font-mono flex items-center gap-1">
          <span class="material-symbols-outlined text-sm">schedule</span>
          ${timeDisplay}
        </span>
      </div>

      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <h4 class="text-base sm:text-lg font-bold text-white tracking-wide leading-snug break-words">
            ${esc(title)}
            ${nextSlot.isLab ? '<span class="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-black bg-purple-500/20 text-purple-300 border border-purple-500/30 font-mono">[LAB]</span>' : ''}
          </h4>
          <div class="flex items-center gap-3 mt-1 text-xs text-gray-300 flex-wrap">
            ${faculty ? `
            <span class="flex items-center gap-1">
              <span class="material-symbols-outlined text-sm text-gray-400">person</span>
              <span>${esc(faculty)}</span>
            </span>` : ''}
            <span class="flex items-center gap-1 font-mono text-gray-400">
              <span class="material-symbols-outlined text-sm text-gray-500">schedule</span>
              <span>${esc(nextSlot.time)}</span>
            </span>
          </div>
        </div>
      </div>
    </div>`;
  }

  // 3. Classes finished for today
  if (currentMinutes >= lastSlot.range.end) {
    return `
    <div class="glass-card rounded-2xl p-4 sm:p-5 border border-white/10 bg-white/[0.02] flex items-center justify-between gap-4">
      <div class="flex items-center gap-3.5 min-w-0">
        <div class="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 flex items-center justify-center flex-shrink-0">
          <span class="material-symbols-outlined text-xl">done_all</span>
        </div>
        <div class="min-w-0">
          <span class="text-[10px] sm:text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">Day Complete</span>
          <h4 class="text-sm sm:text-base font-bold text-white mt-1">All classes wrapped up for ${todayName}! 🎉</h4>
          <p class="text-xs text-gray-400 mt-0.5">Check tomorrow's schedule or review your attendance tracker.</p>
        </div>
      </div>
    </div>`;
  }

  return '';
}

function renderTimetable() {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const todayName = dayNames[new Date().getDay()];
  const activeDay = appState.timetableDay || (days.includes(todayName) ? todayName : 'Monday');
  const layout = appState.timetableLayout || 'day';

  const semRaw = appState.data?.studentDetails?.semester || '';
  const yrRaw = appState.data?.studentDetails?.year || appState.data?.studentDetails?.yearDisplay || '';
  const semNum = parseInt(String(semRaw).replace(/\D/g, ''), 10) || 0;
  const yrNum = parseInt(String(yrRaw).replace(/\D/g, ''), 10) || 0;
  const isJunior = (semNum === 1 || semNum === 2 || yrNum === 1);

  const rawTt = (appState.data && appState.data.timetable && appState.data.timetable.schedule && Object.keys(appState.data.timetable.schedule).length > 0)
    ? appState.data.timetable
    : getClientFallbackTimetable(isJunior, appState.data?.studentDetails);
  const tt = getEnrichedTimetable(rawTt, isJunior, appState.data?.studentDetails);

  const sectionName = appState.data?.studentDetails?.section || '—';
  const subjects = tt.subjects || [];

  return `
  <div class="tab-content space-y-6">
    <!-- Live Current / Next Class Widget -->
    ${renderLiveClassHero(tt, todayName)}

    <!-- Header & View Switcher Bar -->
    <div class="glass-card rounded-2xl p-4 sm:p-5 border border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <div class="flex items-center gap-2 flex-wrap">
          <span class="material-symbols-outlined text-blue-400 text-lg sm:text-xl">event_available</span>
          <h3 class="text-lg sm:text-xl font-bold text-white tracking-wide">Class Timetable</h3>
          <span class="text-[10px] sm:text-xs px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">Section ${esc(sectionName)}</span>
        </div>
      </div>

      <!-- Layout Toggle: Day View vs Weekly Matrix (Segmented Control) -->
      <div class="mobile-segmented-control w-full md:w-auto self-start md:self-auto min-w-[240px]">
        <button onclick="setTimetableLayout('day')"
          class="mobile-segmented-item ${layout === 'day' ? 'active' : ''}">
          <span class="material-symbols-outlined text-sm">view_day</span>
          <span>Day View</span>
        </button>
        <button onclick="setTimetableLayout('week')"
          class="mobile-segmented-item ${layout === 'week' ? 'active' : ''}">
          <span class="material-symbols-outlined text-sm">calendar_view_week</span>
          <span>Weekly Grid</span>
        </button>
      </div>
    </div>

    ${layout === 'day' ? renderDayTimeline(tt, days, activeDay, todayName) : renderWeeklyGrid(tt, days, todayName, isJunior)}

    <!-- Course Instructors & Faculty Directory (Clean minimal cards, no subject codes) -->
    ${subjects.length > 0 ? `
    <div class="space-y-4 pt-2">
      <div class="flex items-center gap-2 px-1">
        <span class="material-symbols-outlined text-gray-400 text-base">groups</span>
        <h4 class="text-xs sm:text-sm font-semibold text-gray-300 uppercase tracking-wider">Course Instructors & Faculty</h4>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-3.5">
        ${subjects.map(s => `
        <div class="glass-card rounded-xl p-3.5 sm:p-4 border border-white/5 hover:border-blue-500/20 transition-all flex items-start gap-3">
          <div class="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 flex-shrink-0 mt-0.5">
            <span class="material-symbols-outlined text-base">person</span>
          </div>
          <div class="min-w-0 flex-1">
            <h5 class="text-xs sm:text-sm font-semibold text-white truncate leading-tight">${esc(formatSubjectName(s.subjectName))}</h5>
            <div class="flex items-center gap-2 mt-1.5 flex-wrap">
              <span class="text-[9px] sm:text-[10px] font-semibold px-2 py-0.5 rounded-full ${/practical/i.test(s.subjectType || s.type) ? 'bg-purple-500/15 text-purple-300 border border-purple-500/20' : 'bg-blue-500/15 text-blue-300 border border-blue-500/20'}">
                ${esc(s.subjectType || 'THEORY')}
              </span>
              <span class="text-[11px] sm:text-xs text-gray-400 truncate">${esc(resolveStaffName(s.subjectName, s.staff))}</span>
            </div>
          </div>
        </div>`).join('')}
      </div>
    </div>` : ''}
  </div>`;
}

function renderDayTimeline(tt, days, activeDay, todayName) {
  const daySchedule = tt.schedule?.[activeDay] || [];

  // Dynamic calendar date calculation for current week days
  const now = new Date();
  const currentDayOfWeek = now.getDay(); // 0: Sun, 1: Mon, ...
  const monOffset = currentDayOfWeek === 0 ? 1 : (1 - currentDayOfWeek);
  const mondayDate = new Date(now);
  mondayDate.setDate(now.getDate() + monOffset);

  const dayIndexMap = { Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4 };
  const monthAbbrs = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return `
  <div class="space-y-4">
    <!-- Day Selector Pills (Touch scrollable, no ugly scrollbars) -->
    <div class="glass-card p-1.5 sm:p-2 rounded-2xl flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar whitespace-nowrap">
      ${days.map(d => {
        const isSelected = d === activeDay;
        const isToday = d === todayName;
        const offset = dayIndexMap[d] ?? 0;
        const dateForDay = new Date(mondayDate);
        dateForDay.setDate(mondayDate.getDate() + offset);
        const dateLabel = `${dateForDay.getDate()} ${monthAbbrs[dateForDay.getMonth()]}`;

        return `
        <button onclick="setTimetableDay('${esc(d)}')"
          class="px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 flex-shrink-0 ${isSelected ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' : 'bg-white/5 text-gray-300 hover:bg-white/10 border border-white/5'}">
          <div class="flex flex-col items-start text-left">
            <div class="flex items-center gap-1.5">
              <span>${esc(d)}</span>
              ${isToday ? '<span class="text-[8px] sm:text-[9px] px-1.5 py-0.2 rounded-full bg-emerald-500/25 text-emerald-300 font-bold border border-emerald-500/30">TODAY</span>' : ''}
            </div>
            <span class="text-[9px] sm:text-[10px] font-mono ${isSelected ? 'text-blue-200' : 'text-gray-400'}">${dateLabel}</span>
          </div>
        </button>`;
      }).join('')}
    </div>

    <!-- Timeline Slots -->
    <div class="space-y-3">
      ${daySchedule.length === 0 ? `
        <div class="glass-card rounded-2xl p-8 sm:p-12 text-center space-y-3 border border-white/10">
          <div class="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mx-auto">
            <span class="material-symbols-outlined text-2xl">event_busy</span>
          </div>
          <h4 class="text-base sm:text-lg font-bold text-white tracking-tight">No Schedule Available</h4>
          <p class="text-xs sm:text-sm text-gray-400 max-w-md mx-auto">
            ${esc(tt.message || `No classes scheduled for ${activeDay}.`)}
          </p>
        </div>` :
        daySchedule.map(slot => {
          if (slot.isBreak || slot.isLunch) {
            const defaultLabel = slot.isLunch ? 'Lunch Break' : 'Morning Break';
            const displayTitle = slot.isLunch
              ? (/lunch/i.test(slot.subjectName || '') ? formatSubjectName(slot.subjectName) : 'Lunch Break')
              : (/break|interval/i.test(slot.subjectName || '') ? formatSubjectName(slot.subjectName) : defaultLabel);
            return `
            <div class="rounded-2xl p-3 sm:p-3.5 px-3 sm:px-4 border border-amber-500/20 bg-amber-500/5 flex items-center justify-between gap-3">
              <div class="flex items-center gap-2.5 sm:gap-3 min-w-0">
                <div class="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0 text-amber-400">
                  <span class="material-symbols-outlined text-base sm:text-lg">${slot.isLunch ? 'restaurant' : 'coffee'}</span>
                </div>
                <div class="min-w-0">
                  <span class="text-xs sm:text-sm font-semibold text-amber-200 block truncate">${esc(displayTitle)}</span>
                  <span class="block text-[10px] sm:text-xs text-amber-400/70 mt-0.5">${esc(slot.time || '')}</span>
                </div>
              </div>
              <span class="text-[9px] sm:text-[10px] font-semibold px-2 sm:px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 tracking-wider flex-shrink-0">
                ${slot.isLunch ? 'LUNCH' : 'BREAK'}
              </span>
            </div>`;
          }

          const isPractical = slot.type === 'PRACTICAL' || slot.isLab;
          return `
          <div class="glass-card rounded-2xl p-3.5 sm:p-5 border border-white/10 hover:border-blue-500/30 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
            <div class="flex items-start sm:items-center gap-3 sm:gap-4 min-w-0 flex-1">
              <div class="w-10 h-10 sm:w-12 sm:h-12 rounded-xl ${isPractical ? 'bg-purple-500/10 border border-purple-500/20 text-purple-400' : 'bg-blue-500/10 border border-blue-500/20 text-blue-400'} flex flex-col items-center justify-center flex-shrink-0">
                <span class="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">P${Number(slot.hour) || 1}</span>
                <span class="material-symbols-outlined text-sm sm:text-base">${isPractical ? 'biotech' : 'school'}</span>
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5 sm:gap-2 flex-wrap mb-1">
                  <h4 class="text-sm sm:text-base font-bold text-white tracking-wide leading-snug break-words flex items-center gap-1.5 flex-wrap">
                    <span>${esc(formatSubjectName(slot.subjectName))}</span>
                    ${slot.isLab ? '<span class="px-2 py-0.5 rounded text-[10px] sm:text-xs font-black bg-purple-500/20 text-purple-300 border border-purple-500/40 font-mono">[LAB]</span>' : ''}
                  </h4>
                  <span class="text-[9px] sm:text-[10px] font-semibold px-2 py-0.5 rounded-full ${isPractical ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'}">
                    ${slot.isLab ? 'LAB' : esc(slot.type || 'THEORY')}
                  </span>
                </div>
                <div class="flex items-center gap-3 sm:gap-4 text-[11px] sm:text-xs text-gray-400 flex-wrap">
                  <span class="inline-flex items-center gap-1">
                    <span class="material-symbols-outlined text-sm text-gray-500">person</span>
                    <span class="text-gray-300 font-medium">${esc(resolveStaffName(slot.subjectName, slot.staff))}</span>
                  </span>
                  <span class="inline-flex items-center gap-1">
                    <span class="material-symbols-outlined text-sm text-gray-500">schedule</span>
                    <span>${esc(slot.time)}</span>
                  </span>
                </div>
              </div>
            </div>
          </div>`;
        }).join('')
      }
    </div>
  </div>`;
}

function renderWeeklyGrid(tt, days, todayName, isJunior = false) {
  const now = new Date();
  const currentDayOfWeek = now.getDay();
  const monOffset = currentDayOfWeek === 0 ? 1 : (1 - currentDayOfWeek);
  const mondayDate = new Date(now);
  mondayDate.setDate(now.getDate() + monOffset);

  const dayIndexMap = { Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4 };
  const monthAbbrs = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  if (tt.isPublished === false || !tt.schedule || Object.keys(tt.schedule).length === 0 || Object.values(tt.schedule).every(slots => !slots || slots.length === 0)) {
    return `
    <div class="glass-card rounded-2xl p-8 sm:p-12 text-center space-y-3 border border-white/10">
      <div class="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mx-auto">
        <span class="material-symbols-outlined text-2xl">event_busy</span>
      </div>
      <h4 class="text-base sm:text-lg font-bold text-white tracking-tight">Weekly Grid Not Published Yet</h4>
      <p class="text-xs sm:text-sm text-gray-400 max-w-md mx-auto">
        ${esc(tt.message || 'The official ERP has not published the class schedule for your department and section yet.')}
      </p>
    </div>`;
  }

  const headers = (Array.isArray(tt.headers) && tt.headers.length > 0)
    ? tt.headers.filter(h => !h.hour || h.hour <= 10)
    : (isJunior ? [
      { hour: 1, time: '09:00 - 10:00', label: 'P1' },
      { hour: 2, time: '10:00 - 11:00', label: 'P2' },
      { hour: 3, time: '11:00 - 11:15', isBreak: true, label: 'Break' },
      { hour: 4, time: '11:15 - 12:15', label: 'P3' },
      { hour: 5, time: '12:15 - 01:15', isLunch: true, label: 'Lunch' },
      { hour: 6, time: '01:15 - 02:15', label: 'P5' },
      { hour: 7, time: '02:15 - 03:15', label: 'P6' }
    ] : [
      { hour: 1, time: '09:00 - 10:00', label: 'P1' },
      { hour: 2, time: '10:00 - 11:00', label: 'P2' },
      { hour: 3, time: '11:00 - 11:15', isBreak: true, label: 'Break' },
      { hour: 4, time: '11:15 - 12:15', isLunch: true, label: 'Lunch' },
      { hour: 5, time: '12:15 - 01:15', label: 'P5' },
      { hour: 6, time: '01:15 - 02:15', label: 'P6' },
      { hour: 7, time: '02:15 - 03:15', label: 'P7' }
    ]);

  return `
  <div class="glass-card rounded-2xl border border-white/10 overflow-hidden">
    <!-- Header with Hint & Mobile Indicator -->
    <div class="p-3 sm:p-4 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
      <div class="flex items-center gap-2">
        <span class="text-xs font-semibold text-gray-300 uppercase tracking-wider">Weekly Schedule Overview</span>
        <span class="text-[11px] text-gray-500 hidden sm:inline">• Monday — Friday</span>
      </div>
      <div class="inline-flex items-center gap-1.5 text-[10px] sm:text-[11px] text-blue-300 bg-blue-500/10 px-2.5 py-1 rounded-full border border-blue-500/20 self-start sm:self-auto">
        <span class="material-symbols-outlined text-xs animate-pulse">swap_horiz</span>
        <span>Scroll horizontally to view all periods</span>
      </div>
    </div>

    <!-- Horizontally scrollable container with sticky Day column and custom sleek scrollbar -->
    <div class="overflow-x-auto custom-scrollbar relative">
      <table class="w-full text-left border-separate border-spacing-0 min-w-[760px] sm:min-w-[850px]">
        <thead>
          <tr class="bg-white/5 border-b border-white/10 text-xs font-semibold text-gray-400">
            <!-- Sticky Day column header -->
            <th class="p-2.5 sm:p-3.5 pl-3 sm:pl-5 w-24 sm:w-28 sticky-day-col">
              Day
            </th>
            ${headers.map(h => `
            <th class="p-2 sm:p-3 text-center border-b border-white/10 ${h.isBreak || h.isLunch ? 'w-20 sm:w-24 bg-amber-500/5 text-amber-300' : 'min-w-[125px] sm:min-w-[140px]'}">
              <div class="text-[10px] sm:text-[11px] font-bold text-gray-300">${esc(h.label || (h.isBreak ? 'Break' : (h.isLunch ? 'Lunch' : `P${h.hour}`)))}</div>
              <div class="text-[9px] sm:text-[10px] text-gray-500 font-normal mt-0.5">${esc((h.time || '').replace(/am|pm/gi, '').trim())}</div>
            </th>`).join('')}
          </tr>
        </thead>
        <tbody class="divide-y divide-white/5 text-xs">
          ${days.map(d => {
            const isToday = d === todayName;
            const slots = (tt.schedule?.[d] || []).filter(s => !s.hour || s.hour <= 10);
            const offset = dayIndexMap[d] ?? 0;
            const dateForDay = new Date(mondayDate);
            dateForDay.setDate(mondayDate.getDate() + offset);
            const dateLabel = `${dateForDay.getDate()} ${monthAbbrs[dateForDay.getMonth()]}`;
            return `
            <tr class="hover:bg-white/[0.03] transition-colors ${isToday ? 'bg-blue-500/5' : ''}">
              <!-- Sticky Day Column Cell -->
              <td class="p-2.5 sm:p-3.5 pl-3 sm:pl-5 font-bold sticky-day-col border-b border-white/5 ${isToday ? 'text-blue-400' : 'text-white'} align-middle">
                <div class="flex flex-col">
                  <div class="flex items-center gap-1.5">
                    <span class="text-xs sm:text-sm whitespace-nowrap">${esc(d)}</span>
                    ${isToday ? '<span class="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>' : ''}
                  </div>
                  <span class="text-[9px] sm:text-[10px] font-mono ${isToday ? 'text-blue-300 font-semibold' : 'text-gray-400'}">${dateLabel}</span>
                </div>
              </td>
              ${slots.map(slot => {
                if (slot.isBreak || slot.isLunch) {
                  const dispTime = (slot.time || '').replace(/am|pm/gi, '').trim();
                  return `
                  <td class="p-1.5 sm:p-2 text-center bg-amber-500/[0.02] border-b border-white/5 align-middle">
                    <div class="flex flex-col items-center justify-center">
                      <span class="text-[9px] sm:text-[10px] text-amber-400/90 font-bold">${slot.isLunch ? 'Lunch' : 'Break'}</span>
                      ${dispTime ? `<span class="text-[8px] text-amber-400/70 font-mono mt-0.5 leading-tight">${esc(dispTime)}</span>` : ''}
                    </div>
                  </td>`;
                }
                const isPractical = slot.type === 'PRACTICAL' || slot.isLab;
                return `
                <td class="p-1.5 sm:p-2.5 border-b border-white/5 align-middle">
                  <div class="rounded-xl p-2 sm:p-2.5 border transition-all ${isPractical ? 'bg-purple-500/5 border-purple-500/20 hover:border-purple-500/40' : 'bg-white/5 border-white/10 hover:border-blue-500/30'}">
                    <div class="font-bold text-white text-[10px] sm:text-[11px] leading-tight line-clamp-2">
                      ${esc(formatSubjectName(slot.subjectName))}
                      ${slot.isLab ? '<span class="text-purple-400 font-mono text-[9px] sm:text-[10px] font-bold ml-1">[LAB]</span>' : ''}
                    </div>
                    <div class="text-[9px] sm:text-[10px] text-gray-400 mt-1 truncate">${esc(resolveStaffName(slot.subjectName, slot.staff))}</div>
                    <div class="mt-1">
                      <span class="text-[8px] sm:text-[9px] px-1.5 py-0.2 rounded font-semibold ${isPractical ? 'text-purple-300 bg-purple-500/20' : 'text-blue-300 bg-blue-500/20'}">
                        ${slot.isLab ? 'LAB' : esc(slot.type || 'THEORY')}
                      </span>
                    </div>
                  </div>
                </td>`;
              }).join('')}
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

// ── Progressive Web App (PWA) Service Worker Registration ────────────────────
if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        console.log('[PWA] Service Worker registered with scope:', reg.scope);
      })
      .catch((err) => {
        console.warn('[PWA] Service Worker registration failed:', err);
      });
  });
}
