/**
 * Sathyabama Student Portal — Frontend App Controller
 * All data comes from the live backend. No hardcoded placeholders.
 */

let appState = { user: null, data: null, activeTab: 'profile', timetableDay: 'Monday', attendanceSubView: 'daily', calendarYear: null, calendarMonth: null };

document.addEventListener('DOMContentLoaded', () => {
  initWebThreads();
  const stored = PortalAPI.getStoredCredentials();
  if (stored) autoLogin(stored.regNumber, stored.password);
});

// ── WebThreads Shader Component (React Bits Adaptation for Vanilla WebGL2) ────
function initWebThreads() {
  const canvas = document.getElementById('threads-canvas');
  if (!canvas) return;

  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
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
  #define MAX_THREADS 10

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
    float baseT = iTime * uSpeed;
    float tauOverN = TAU / n;
    float mirror = uMirror > 0.5 ? sign(pinchX - uv.x) : 1.0;
    bool doShimmer = uShimmer > 0.5;
    float shimmerT = iTime * 1.7;
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
  gl.uniform1f(gl.getUniformLocation(program, 'uEnableMouse'), 1.0);
  const uMouseActiveLoc = gl.getUniformLocation(program, 'uMouseActive');

  let targetMouse = [0.5, 0.5];
  let currMouse = [0.5, 0.5];
  let targetActive = 0;
  let currActive = 0;

  window.addEventListener('mousemove', (e) => {
    targetMouse[0] = e.clientX / window.innerWidth;
    targetMouse[1] = 1.0 - (e.clientY / window.innerHeight);
    targetActive = 1;
  });

  const syncSize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uResLoc, canvas.width, canvas.height);
  };
  window.addEventListener('resize', syncSize);
  syncSize();

  const t0 = performance.now();
  function render(t) {
    gl.uniform1f(uTimeLoc, (t - t0) * 0.001);
    currMouse[0] += 0.05 * (targetMouse[0] - currMouse[0]);
    currMouse[1] += 0.05 * (targetMouse[1] - currMouse[1]);
    currActive += 0.05 * (targetActive - currActive);

    gl.uniform2f(uMouseLoc, currMouse[0], currMouse[1]);
    gl.uniform1f(uMouseActiveLoc, currActive);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}

// Helper fallback function: returns '[404]' if field is missing, null, undefined, empty, or placeholder dash
function val(v) {
  if (v === null || v === undefined) return '[404]';
  const str = String(v).trim();
  if (str === '' || str === 'null' || str === 'undefined' || str === '-') return '[404]';
  return str;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function autoLogin(regNumber, password) {
  document.getElementById('regNumber').value = regNumber;
  document.getElementById('password').value  = password;
  await executeLogin(regNumber, password, true);
}

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
    renderHeader();
    setTab('profile');

  } catch (err) {
    showStatus(status, 'error', err.message || 'Login failed. Check your credentials and try again.');
    btn.disabled = false;
    btn.innerHTML = `<span class="material-symbols-outlined text-lg">login</span><span>Sign In to Dashboard</span>`;
  }
}

function handleSignOut() {
  PortalAPI.clearCredentials();
  appState = { user: null, data: null, activeTab: 'profile', timetableDay: 'Monday', attendanceSubView: 'daily', calendarYear: null, calendarMonth: null };
  document.getElementById('dashboardSection').classList.add('hidden');
  document.getElementById('loginSection').classList.remove('hidden');
  document.getElementById('password').value = '';
  document.getElementById('regNumber').value = '';
}

function showStatus(el, type, msg) {
  el.className = type === 'error'
    ? 'rounded-lg p-3 text-center bg-red-500/20 border border-red-500/40 text-red-300 text-sm block mb-4'
    : 'rounded-lg p-3 text-center bg-green-500/20 border border-green-500/40 text-green-300 text-sm block mb-4';
  el.textContent = msg;
}

// ── Navigation ────────────────────────────────────────────────────────────────
function renderHeader() {
  const s = appState.data.studentDetails;
  document.getElementById('headerStudentName').textContent = val(s.name);
  document.getElementById('headerRegNo').textContent       = `REG NO: ${val(s.regNo)}`;
  document.getElementById('headerBranch').textContent      = `${val(s.department)} • SEMESTER ${val(s.semester)}`;
  document.getElementById('avatarInitials').textContent    = (s.name && s.name !== '[404]') ? s.name.split(' ').map(n=>n[0]).join('').slice(0,2) : '??';
}

function setTab(tab) {
  appState.activeTab = tab;
  ['profile','attendance','cae','timetable'].forEach(t => {
    const b = document.getElementById(`tab-btn-${t}`);
    b.className = t === tab
      ? 'px-4 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 text-white shadow-lg shadow-blue-500/25 flex items-center gap-2 transition-all flex-shrink-0'
      : 'px-4 py-2.5 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 flex items-center gap-2 transition-all flex-shrink-0';
  });
  const view = { profile: renderProfile, attendance: renderAttendance, cae: renderCAE, timetable: renderTimetable };
  document.getElementById('dashboardTabContent').innerHTML = view[tab]();
}

function setTimetableDay(day) { appState.timetableDay = day; setTab('timetable'); }

function setAttendanceSubView(subView) {
  appState.attendanceSubView = subView;
  setTab('attendance');
}

function changeCalendarMonth(offset) {
  if (appState.calendarMonth === null) return;
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
  if (!dateStr || dateStr === '[404]') return null;
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

// ── Profile Tab (Minimalist & Dynamic with [404] Fallback) ────────────────────
function renderProfile() {
  const s = appState.data.studentDetails;

  return `
  <div class="tab-content space-y-8">
    
    <!-- Top Minimal Header Card -->
    <div class="glass-card rounded-xl p-6 border border-white/10">
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 class="text-2xl font-bold text-white tracking-tight uppercase">${val(s.name)}</h2>
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

// ── Attendance Tab (Automated Calendar Daily View & Updated Summary) ───────────
function renderAttendance() {
  const a = appState.data.attendanceSummary || {};
  const subView = appState.attendanceSubView || 'daily';
  
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

  // Programmatically set initial visible month to match the month of the very first date entry
  if (appState.calendarMonth === null || appState.calendarYear === null) {
    if (minDate) {
      appState.calendarMonth = minDate.getMonth();
      appState.calendarYear  = minDate.getFullYear();
    } else {
      const now = new Date();
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

    <!-- Top Sub-Navigation Toggle: Daily vs Hourly -->
    <div class="flex items-center justify-between gap-4 flex-wrap pb-2 border-b border-white/10">
      <div class="glass-card p-1.5 rounded-xl flex items-center gap-1 border border-white/10 bg-black/20">
        <button onclick="setAttendanceSubView('daily')" id="sub-btn-daily"
          class="px-5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${subView==='daily' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/25' : 'text-gray-400 hover:text-white hover:bg-white/5'}">
          <span class="material-symbols-outlined text-base">calendar_month</span>
          Daily Attendance
        </button>
        <button onclick="setAttendanceSubView('hourly')" id="sub-btn-hourly"
          class="px-5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${subView==='hourly' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/25' : 'text-gray-400 hover:text-white hover:bg-white/5'}">
          <span class="material-symbols-outlined text-base">schedule</span>
          Hourly Attendance
        </button>
      </div>
      <div class="text-xs text-gray-400 font-mono">
        ACTIVE: <span class="text-blue-400 font-bold uppercase">${subView} VIEW</span>
      </div>
    </div>

    <!-- Attendance Summary Header Card -->
    <div class="glass-card rounded-2xl p-6 border border-white/10 flex flex-col md:flex-row items-center justify-between gap-6">
      
      <!-- Left: Circular Percentage Wheel -->
      <div class="flex items-center gap-6">
        <div class="relative w-28 h-28 flex-shrink-0">
          <svg class="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="42" stroke="rgba(255,255,255,.08)" stroke-width="10" fill="none"/>
            <circle cx="50" cy="50" r="42" stroke="${ringColor}" stroke-width="10" fill="none"
              stroke-dasharray="${dash}" stroke-dashoffset="${offset}" stroke-linecap="round" class="transition-all duration-700 ease-out"/>
          </svg>
          <span class="absolute inset-0 flex items-center justify-center text-xl font-extrabold text-white">${pct}%</span>
        </div>

        <div class="space-y-2">
          <h3 class="text-lg font-bold text-white tracking-tight">Overall Attendance</h3>
          <p class="text-sm text-gray-300">
            Attended <span class="text-white font-bold">${totalPresent}</span> of <span class="text-white font-bold">${totalDays}</span> days
          </p>
          <div>
            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${isPass ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'}">
              ${isPass ? '✅ Eligible for Exams (≥80%)' : '⚠️ Attendance Below 80% Threshold'}
            </span>
          </div>
        </div>
      </div>

      <!-- Right: Summary Stats Side-by-Side (Total Present & Total Absent) -->
      <div class="grid grid-cols-2 gap-4 w-full md:w-auto flex-shrink-0">
        <div class="glass-card rounded-xl p-4 border border-emerald-500/20 bg-emerald-500/5 text-center min-w-[130px]">
          <span class="text-[11px] font-bold text-emerald-400 uppercase tracking-wider block mb-1">Total Present</span>
          <span class="text-2xl font-black text-emerald-300 font-mono">${totalPresent}</span>
          <span class="text-[10px] text-gray-400 block mt-0.5">days</span>
        </div>
        <div class="glass-card rounded-xl p-4 border border-rose-500/20 bg-rose-500/5 text-center min-w-[130px]">
          <span class="text-[11px] font-bold text-rose-400 uppercase tracking-wider block mb-1">Total Absent</span>
          <span class="text-2xl font-black text-rose-300 font-mono">${totalAbsent}</span>
          <span class="text-[10px] text-gray-400 block mt-0.5">days</span>
        </div>
      </div>

    </div>

    <!-- Main Content Area based on subView selection -->
    ${subView === 'hourly'
      ? `<div class="glass-card rounded-2xl p-12 text-center border border-white/10 space-y-3">
           <span class="material-symbols-outlined text-4xl text-blue-400">hourglass_empty</span>
           <h4 class="text-lg font-bold text-white">Hourly Attendance View</h4>
           <p class="text-xs text-gray-400 max-w-md mx-auto">Hourly attendance tracking is currently under development. Switch to Daily Attendance view to monitor calendar breakdown.</p>
         </div>`
      : renderCalendarView(parsedLogs, minDate, maxDate)}

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
    cells.push(`<div class="h-16 sm:h-20 rounded-xl bg-white/[0.02] border border-white/5 opacity-20"></div>`);
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
      badgeText = '<span class="text-[10px] uppercase font-bold tracking-wider text-emerald-100 mt-1 block">Present</span>';
    } else if (logStatus === 'Absent') {
      cellBg = 'bg-rose-600/90 border-rose-400 text-white font-black shadow-lg shadow-rose-900/30';
      badgeText = '<span class="text-[10px] uppercase font-bold tracking-wider text-rose-100 mt-1 block">Absent</span>';
    } else if (inRange) {
      // Missing date within semester range -> greyed out with high contrast
      cellBg = 'bg-gray-800/70 border-white/10 text-gray-300 font-semibold opacity-75';
      badgeText = '<span class="text-[9px] uppercase font-semibold text-gray-400 mt-1 block">No Data</span>';
    }

    cells.push(`
      <div class="h-16 sm:h-20 rounded-xl border p-2 flex flex-col justify-between transition-all hover:scale-[1.02] ${cellBg}">
        <span class="text-sm sm:text-base font-mono font-bold leading-none">${day}</span>
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

      <div class="flex items-center gap-2">
        <button onclick="changeCalendarMonth(-1)"
          class="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white transition-all active:scale-95 flex items-center justify-center">
          <span class="material-symbols-outlined text-lg">chevron_left</span>
        </button>
        <span class="text-xs font-mono text-gray-300 px-3 font-semibold">${monthNames[currentMonth]}</span>
        <button onclick="changeCalendarMonth(1)"
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
    <div class="glass-card rounded-2xl p-6">
      <h3 class="text-base font-bold text-white mb-4 flex items-center justify-between">
        <span class="flex items-center gap-2"><span class="material-symbols-outlined text-blue-400 text-lg">assignment</span> ${label}</span>
      </h3>
      ${rows.length === 0
        ? `<p class="text-gray-400 text-sm text-center py-4">No data returned from portal for this exam.</p>`
        : `<div class="overflow-x-auto">
        <table class="w-full text-left text-sm text-gray-300">
          <thead class="bg-white/5 text-gray-400 text-xs uppercase">
            <tr><th class="p-3">Code</th><th class="p-3">Subject</th><th class="p-3">Max</th><th class="p-3">Obtained</th><th class="p-3">Result</th></tr>
          </thead>
          <tbody class="divide-y divide-white/5">
            ${rows.map(r=>`
            <tr class="hover:bg-white/5 transition-colors">
              <td class="p-3 text-blue-400 font-semibold">${r.code}</td>
              <td class="p-3 text-white font-medium">${r.name}</td>
              <td class="p-3">${r.maxMarks}</td>
              <td class="p-3 font-bold text-white">${r.marksObtained}</td>
              <td class="p-3"><span class="badge-pill ${r.status==='PASS'?'badge-pass':'badge-warning'}">${r.status}</span></td>
            </tr>`).join('')}
          </tbody>
        </table></div>`}
    </div>`;
  return `
  <div class="tab-content space-y-6">
    ${c.arrearDetails.totalArrears > 0 ? `
    <div class="glass-card rounded-2xl p-5 flex items-center gap-4 border border-amber-500/30 bg-amber-500/5">
      <span class="text-2xl">⚠️</span>
      <div>
        <span class="text-xs text-gray-400 uppercase tracking-wider block">CAE Arrears (CAE 1)</span>
        <span class="text-white font-bold">${c.arrearDetails.totalArrears} subject(s) below passing marks — ${c.arrearDetails.history.join(', ')}</span>
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
function renderTimetable() {
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
  const day  = appState.timetableDay;
  // Timetable is not available from ERP API — show a clear placeholder
  return `
  <div class="tab-content space-y-6">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass-card p-4 rounded-2xl">
      <div class="flex items-center gap-2 overflow-x-auto no-scrollbar whitespace-nowrap pb-1 sm:pb-0">
        ${days.map(d=>`
        <button onclick="setTimetableDay('${d}')"
          class="px-4 py-2 rounded-xl text-sm font-semibold transition-all flex-shrink-0 ${d===day?'bg-blue-600 text-white shadow-lg shadow-blue-600/30':'bg-white/5 text-gray-300 hover:bg-white/10'}">
          ${d}
        </button>`).join('')}
      </div>
      <div class="text-xs text-gray-400 flex items-center gap-1 flex-shrink-0">
        <span class="material-symbols-outlined text-sm">schedule</span> Section: ${appState.data.studentDetails.section || '—'}
      </div>
    </div>
    <div class="glass-card rounded-2xl p-8 text-center">
      <span class="material-symbols-outlined text-4xl text-blue-400 mb-3 block">calendar_month</span>
      <h3 class="text-lg font-bold text-white mb-2">Timetable Not Available via API</h3>
      <p class="text-gray-400 text-sm max-w-sm mx-auto">The Sathyabama ERP portal does not expose a timetable endpoint in its REST API.
      To enable this tab, open DevTools on the <strong class="text-white">Time Table</strong> section of the portal and share the network request URL and response.</p>
    </div>
  </div>`;
}
