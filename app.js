/**
 * Sathyabama Student Portal — Frontend App Controller
 * All data comes from the live backend. No hardcoded placeholders.
 */

let appState = { user: null, data: null, activeTab: 'profile', timetableDay: 'Monday' };

document.addEventListener('DOMContentLoaded', () => {
  initShader();
  const stored = PortalAPI.getStoredCredentials();
  if (stored) autoLogin(stored.regNumber, stored.password);
});

// ── WebGL Background Shader ───────────────────────────────────────────────────
function initShader() {
  const canvas = document.getElementById('shader-canvas');
  if (!canvas) return;
  const sync = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
  window.addEventListener('resize', sync); sync();
  const gl = canvas.getContext('webgl');
  if (!gl) return;
  const VS = `attribute vec2 p;void main(){gl_Position=vec4(p,0,1);}`;
  const FS = `precision highp float;uniform vec2 R;uniform float T;
  #define N 6
  float glow(float x){return 0.02/pow(max(x,1e-4),0.65);}
  void main(){
    vec2 uv=gl_FragCoord.xy/R;float c=0.;
    for(int i=0;i<N;i++){
      float fi=float(i);
      float amp=0.16*abs(uv.x-.5)*(1.+fi*.8);
      float sdf=abs(uv.y-.5+sin(uv.x*4.5+T*.15+fi*1.047)*amp);
      vec3 col=mix(vec3(.145,.388,.921),vec3(.53,.22,.98),fi/float(N-1));
      c+=glow(sdf);
    }
    vec3 bg=vec3(.06,.07,.11);
    gl_FragColor=vec4(mix(bg,vec3(.145,.388,.921)*c*.65+bg,clamp(c,0.,1.)),1.);
  }`;
  const mk = (t,s) => { const x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);return x; };
  const pr = gl.createProgram();
  gl.attachShader(pr,mk(gl.VERTEX_SHADER,VS));
  gl.attachShader(pr,mk(gl.FRAGMENT_SHADER,FS));
  gl.linkProgram(pr); gl.useProgram(pr);
  const buf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const pp=gl.getAttribLocation(pr,'p'); gl.enableVertexAttribArray(pp);
  gl.vertexAttribPointer(pp,2,gl.FLOAT,false,0,0);
  const uR=gl.getUniformLocation(pr,'R'), uT=gl.getUniformLocation(pr,'T');
  (function loop(t){ gl.viewport(0,0,canvas.width,canvas.height);
    gl.uniform2f(uR,canvas.width,canvas.height); gl.uniform1f(uT,t*.001);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4); requestAnimationFrame(loop); })(0);
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

  try {
    // POST credentials to Express/Playwright backend
    const result = await PortalAPI.login(regNumber, password, remember);

    appState.user = result.student;
    appState.data = result.data;

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
  appState = { user: null, data: null, activeTab: 'profile', timetableDay: 'Monday' };
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
  document.getElementById('headerStudentName').textContent = s.name;
  document.getElementById('headerRegNo').textContent       = `REG NO: ${s.regNo}`;
  document.getElementById('headerBranch').textContent      = `${s.department} • SEMESTER ${s.semester}`;
  document.getElementById('avatarInitials').textContent    = s.name.split(' ').map(n=>n[0]).join('').slice(0,2);
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

// ── Profile Tab ───────────────────────────────────────────────────────────────
function renderProfile() {
  const s = appState.data.studentDetails;
  const row = (label, val) => val ? `<div class="flex justify-between items-center py-2.5 border-b border-white/5"><span class="text-gray-400 text-xs">${label}</span><span class="text-white font-semibold text-sm text-right max-w-[60%]">${val}</span></div>` : '';
  return `
  <div class="tab-content space-y-6">
    <div class="glass-card rounded-2xl p-6 relative overflow-hidden">
      <div class="absolute right-0 top-0 w-80 h-80 bg-blue-600/10 rounded-full blur-3xl pointer-events-none"></div>
      <div class="flex flex-col md:flex-row items-center md:items-start gap-6">
        <div class="w-24 h-24 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-3xl font-bold text-white shadow-xl flex-shrink-0">
          ${s.name.split(' ').map(n=>n[0]).join('').slice(0,2)}
        </div>
        <div class="flex-1 text-center md:text-left space-y-2">
          <div class="flex flex-wrap items-center justify-center md:justify-start gap-2">
            <h2 class="text-2xl font-bold text-white">${s.name}</h2>
            ${s.section ? `<span class="badge-pill badge-info">Section ${s.section}</span>` : ''}
            ${s.hostel   ? `<span class="badge-pill badge-pass">Hostel: ${s.hostel}</span>` : ''}
          </div>
          <p class="text-blue-300 text-sm font-medium">${s.department}</p>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            ${[['Register No', s.regNo],['Batch',s.batch],['Semester',`Sem ${s.semester} (${s.year})`],['School',s.school]]
              .filter(([,v])=>v).map(([l,v])=>`
              <div class="bg-white/5 p-2.5 rounded-lg border border-white/5">
                <span class="text-gray-400 block text-[10px] uppercase tracking-wider">${l}</span>
                <span class="font-semibold text-white text-sm">${v}</span>
              </div>`).join('')}
          </div>
        </div>
      </div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div class="glass-card rounded-2xl p-6">
        <h3 class="text-base font-bold text-white mb-3 flex items-center gap-2">
          <span class="material-symbols-outlined text-blue-400 text-lg">person</span> Personal Information
        </h3>
        ${row('Date of Birth', s.dob)}
        ${row('Gender', s.gender)}
        ${row('Blood Group', s.bloodGroup)}
        ${row('Nationality', s.nationality)}
        ${row('Religion', s.religion)}
        ${row('Community', s.community)}
        ${row('Mother Tongue', s.motherTongue)}
        ${row('Email', s.email)}
        ${row('Mobile', s.mobile)}
        ${row('Aadhaar', s.aadhaar)}
        ${row('First Graduate', s.firstGraduate)}
      </div>
      <div class="glass-card rounded-2xl p-6">
        <h3 class="text-base font-bold text-white mb-3 flex items-center gap-2">
          <span class="material-symbols-outlined text-blue-400 text-lg">family_history</span> Guardian Details
        </h3>
        ${row('Father Name', s.fatherName)}
        ${row('Father Mobile', s.fatherMobile)}
        ${row('Father Aadhaar', s.fatherAadhaar)}
        ${row('Father Occupation', s.fatherOccupation)}
        ${row('Mother Name', s.motherName)}
        ${row('Mother Mobile', s.motherMobile)}
        ${row('Mother Occupation', s.motherOccupation)}
      </div>
    </div>
  </div>`;
}

// ── Attendance Tab ────────────────────────────────────────────────────────────
function renderAttendance() {
  const a = appState.data.attendanceSummary;
  const pct = a.overallPercentage;
  const dash = 264, offset = dash - (dash * pct / 100);
  const color = pct >= 75 ? '#2563eb' : '#f59e0b';
  return `
  <div class="tab-content space-y-6">
    <div class="glass-card rounded-2xl p-6 flex flex-col md:flex-row items-center gap-6">
      <div class="relative w-28 h-28 flex-shrink-0">
        <svg class="w-full h-full" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" stroke="rgba(255,255,255,.1)" stroke-width="10" fill="none"/>
          <circle cx="50" cy="50" r="42" stroke="${color}" stroke-width="10" fill="none"
            stroke-dasharray="${dash}" stroke-dashoffset="${offset}" class="progress-ring-circle"/>
        </svg>
        <span class="absolute inset-0 flex items-center justify-center text-xl font-bold text-white">${pct}%</span>
      </div>
      <div class="flex-1 space-y-2 text-center md:text-left">
        <h3 class="text-lg font-bold text-white">Overall Attendance</h3>
        <p class="text-sm text-gray-300">Attended <span class="text-white font-semibold">${a.attendedClasses}</span> of <span class="text-white font-semibold">${a.conductedClasses}</span> hours</p>
        <span class="badge-pill ${pct >= 75 ? 'badge-pass' : 'badge-warning'} inline-flex">
          ${pct >= 75 ? '✅ Eligible for Exams (≥75%)' : '⚠️ Attendance Below 75% Threshold'}
        </span>
      </div>
    </div>
    <div class="glass-card rounded-2xl p-6">
      <h3 class="text-base font-bold text-white mb-4 flex items-center gap-2">
        <span class="material-symbols-outlined text-blue-400 text-lg">bar_chart</span> Subject-wise Breakdown
      </h3>
      ${a.subjectWise.length === 0
        ? `<p class="text-gray-400 text-sm text-center py-6">No attendance data returned from portal.</p>`
        : a.subjectWise.map(sub => `
        <div class="bg-white/5 p-4 rounded-xl border border-white/5 mb-3">
          <div class="flex justify-between items-center text-sm mb-1.5">
            <div>
              <span class="text-blue-400 font-semibold text-xs mr-2">[${sub.code}]</span>
              <span class="font-semibold text-white">${sub.name}</span>
            </div>
            <span class="font-bold text-white">${sub.percentage}%</span>
          </div>
          <div class="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
            <div class="h-2 rounded-full ${sub.percentage >= 75 ? 'bg-gradient-to-r from-blue-600 to-indigo-400' : 'bg-amber-500'}"
                 style="width:${Math.min(sub.percentage,100)}%"></div>
          </div>
          <div class="flex justify-between text-xs text-gray-400 mt-1">
            <span>Attended: ${sub.attended} / ${sub.total} hrs</span>
            ${sub.percentage < 75 ? `<span class="text-amber-400">⚠️ Below minimum</span>` : ''}
          </div>
        </div>`).join('')}
    </div>
    ${a.dailyLogs && a.dailyLogs.length > 0 ? `
    <div class="glass-card rounded-2xl p-6">
      <h3 class="text-base font-bold text-white mb-4 flex items-center gap-2">
        <span class="material-symbols-outlined text-blue-400 text-lg">event_available</span> Daily Attendance Logs
      </h3>
      <div class="overflow-x-auto">
        <table class="w-full text-sm text-left text-gray-300">
          <thead class="bg-white/5 text-gray-400 text-xs uppercase">
            <tr><th class="p-3">Date</th><th class="p-3">Status</th><th class="p-3">Hours</th></tr>
          </thead>
          <tbody class="divide-y divide-white/5">
            ${a.dailyLogs.map(l => `
            <tr class="hover:bg-white/5 transition-colors">
              <td class="p-3 font-semibold text-white">${l.date}</td>
              <td class="p-3"><span class="badge-pill ${l.status==='Present'?'badge-pass':'badge-warning'}">${l.status}</span></td>
              <td class="p-3 text-xs">${l.hours || '-'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}
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
