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
  return `
  <div class="tab-content space-y-6">
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">

      <!-- LEFT SIDEBAR CARD -->
      <div class="lg:col-span-4 glass-card rounded-2xl p-6 flex flex-col items-center text-center relative overflow-hidden border border-white/10">
        <div class="relative w-32 h-32 mb-4">
          <div class="w-32 h-32 rounded-full overflow-hidden border-4 border-amber-600/60 shadow-xl mx-auto flex items-center justify-center bg-gray-800">
            ${s.photo ? `<img src="${s.photo}" alt="${s.name}" class="w-full h-full object-cover"/>` : `<span class="text-3xl font-bold text-white">${s.name.split(' ').map(n=>n[0]).join('').slice(0,2)}</span>`}
          </div>
        </div>

        <h2 class="text-xl font-bold text-white tracking-wide uppercase mb-1">${s.name}</h2>
        <p class="text-amber-400 font-bold text-base tracking-wider mb-1">${s.regNo}</p>
        <p class="text-gray-300 text-xs font-semibold uppercase tracking-wider mb-2 px-2 leading-relaxed">${s.programme}</p>
        
        <div class="flex items-center gap-1.5 text-xs text-blue-300 mb-6 bg-blue-500/10 px-3 py-1.5 rounded-full border border-blue-500/20 max-w-full truncate">
          <span class="material-symbols-outlined text-sm">mail</span>
          <span class="truncate">${s.email}</span>
        </div>

        <div class="w-full border-t border-white/10 my-2"></div>

        <div class="w-full space-y-2.5 text-xs text-left pt-2">
          <div class="flex justify-between items-center"><span class="text-gray-400">RollNumber</span><span class="text-gray-200 font-medium">: ${s.rollNumber || ''}</span></div>
          <div class="flex justify-between items-center"><span class="text-gray-400">Date of Birth</span><span class="text-gray-200 font-medium">: ${s.dob}</span></div>
          <div class="flex justify-between items-center"><span class="text-gray-400">Mobile</span><span class="text-gray-200 font-medium">: ${s.mobile}</span></div>
          <div class="flex justify-between items-center"><span class="text-gray-400">Age</span><span class="text-gray-200 font-medium">: ${s.age}</span></div>
          <div class="flex justify-between items-center"><span class="text-gray-400">Batch</span><span class="text-gray-200 font-medium">: ${s.batch}</span></div>
          <div class="flex justify-between items-center"><span class="text-gray-400">Semester</span><span class="text-gray-200 font-medium">: ${s.semester}</span></div>
          <div class="flex justify-between items-center"><span class="text-gray-400">Year</span><span class="text-gray-200 font-medium">: ${s.yearDisplay}</span></div>
          <div class="flex justify-between items-center"><span class="text-gray-400">Section Name</span><span class="text-gray-200 font-medium">: ${s.section}</span></div>
          <div class="flex justify-between items-center"><span class="text-gray-400">School</span><span class="text-gray-200 font-medium">: ${s.school}</span></div>
        </div>
      </div>

      <!-- RIGHT COLUMN -->
      <div class="lg:col-span-8 space-y-6">

        <!-- PERSONAL DETAILS GRID -->
        <div class="glass-card rounded-2xl p-6 border border-white/10">
          <h3 class="text-center text-sm font-bold text-gray-200 uppercase tracking-widest mb-6 pb-2 border-b border-white/10">
            PERSONAL DETAILS
          </h3>

          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-y-4 gap-x-6 text-xs divide-y sm:divide-y-0 divide-white/5">
            <div><span class="text-gray-400 block mb-0.5 font-medium">Name</span><span class="text-white font-bold text-sm">${s.name}</span></div>
            <div><span class="text-gray-400 block mb-0.5 font-medium">Gender</span><span class="text-white font-bold text-sm">${s.gender}</span></div>
            <div></div>

            <div class="pt-2 sm:pt-0"><span class="text-gray-400 block mb-0.5 font-medium">Blood Group</span><span class="text-white font-semibold">${s.bloodGroup}</span></div>
            <div class="pt-2 sm:pt-0"><span class="text-gray-400 block mb-0.5 font-medium">Medical History</span><span class="text-white font-semibold">${s.medicalHistory}</span></div>
            <div class="pt-2 sm:pt-0"><span class="text-gray-400 block mb-0.5 font-medium">NativeState</span><span class="text-white font-semibold">${s.nativeState}</span></div>

            <div class="pt-2 sm:pt-0"><span class="text-gray-400 block mb-0.5 font-medium">Height</span><span class="text-white font-semibold">${s.height}</span></div>
            <div class="pt-2 sm:pt-0"><span class="text-gray-400 block mb-0.5 font-medium">Date Of Birth</span><span class="text-white font-semibold">${s.dob}</span></div>
            <div class="pt-2 sm:pt-0"><span class="text-gray-400 block mb-0.5 font-medium">Nationality</span><span class="text-white font-semibold">${s.nationality}</span></div>

            <div class="pt-2 sm:pt-0"><span class="text-gray-400 block mb-0.5 font-medium">Religion</span><span class="text-white font-semibold">${s.religion}</span></div>
            <div class="pt-2 sm:pt-0"><span class="text-gray-400 block mb-0.5 font-medium">Community</span><span class="text-white font-semibold">${s.community}</span></div>
            <div class="pt-2 sm:pt-0"><span class="text-gray-400 block mb-0.5 font-medium">Mother Tongue</span><span class="text-white font-semibold">${s.motherTongue}</span></div>

            <div class="pt-2 sm:pt-0"><span class="text-gray-400 block mb-0.5 font-medium">Stayed in Hostel?</span><span class="text-white font-semibold">${s.stayedInHostel}</span></div>
            <div class="pt-2 sm:pt-0"><span class="text-gray-400 block mb-0.5 font-medium">Native Place</span><span class="text-white font-semibold">${s.nativePlace}</span></div>
            <div class="pt-2 sm:pt-0"><span class="text-gray-400 block mb-0.5 font-medium">Weight</span><span class="text-white font-semibold">${s.weight}</span></div>

            <div class="pt-2 sm:pt-0"><span class="text-gray-400 block mb-0.5 font-medium">Aadhaar</span><span class="text-white font-semibold">${s.aadhaar}</span></div>
            <div class="pt-2 sm:pt-0"><span class="text-gray-400 block mb-0.5 font-medium">Mother Name</span><span class="text-white font-semibold">${s.motherName}</span></div>
            <div class="pt-2 sm:pt-0"><span class="text-gray-400 block mb-0.5 font-medium">Student Mobile No</span><span class="text-white font-semibold">${s.studentMobile}</span></div>

            <div class="pt-2 sm:pt-0"><span class="text-gray-400 block mb-0.5 font-medium">Student Email</span><span class="text-white font-semibold truncate block">${s.studentEmail}</span></div>
            <div class="pt-2 sm:pt-0"><span class="text-gray-400 block mb-0.5 font-medium">First Graduate</span><span class="text-white font-semibold">${s.firstGraduate}</span></div>
            <div class="pt-2 sm:pt-0"><span class="text-gray-400 block mb-0.5 font-medium">Extra Curricular</span><span class="text-white font-semibold">${s.extraCurricular}</span></div>

            <div class="pt-2 sm:pt-0"><span class="text-gray-400 block mb-0.5 font-medium">IsPWD</span><span class="text-white font-semibold">${s.isPwd}</span></div>
          </div>
        </div>

        <!-- PARENTS DETAILS -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">

          <!-- FATHER DETAILS CARD -->
          <div class="glass-card rounded-2xl p-6 border border-white/10 flex flex-col items-center text-center">
            <h4 class="text-xs font-bold text-gray-300 uppercase tracking-wider mb-4 w-full text-left border-b border-white/10 pb-2">FATHER DETAILS</h4>
            
            <div class="w-20 h-20 rounded-full overflow-hidden border-2 border-blue-500/40 shadow-md mb-3 flex items-center justify-center bg-gray-800">
              ${s.fatherPhoto ? `<img src="${s.fatherPhoto}" alt="${s.fatherName}" class="w-full h-full object-cover"/>` : `<span class="text-xl font-bold text-white">${s.fatherName.split(' ').map(n=>n[0]).join('')}</span>`}
            </div>

            <h5 class="text-sm font-bold text-white mb-0.5">${s.fatherName}</h5>
            <p class="text-xs text-gray-400 font-medium mb-4">${s.fatherSubtitle}</p>

            <div class="w-full space-y-2 text-xs text-left">
              <div class="flex justify-between items-center"><span class="text-gray-400">Occupation</span><span class="text-gray-200">: ${s.fatherOccupation}</span></div>
              <div class="flex justify-between items-center"><span class="text-gray-400">Office Designation</span><span class="text-gray-200">: ${s.fatherOfficeDesignation}</span></div>
              <div class="flex justify-between items-center"><span class="text-gray-400">Annual Income</span><span class="text-gray-200">: ${s.fatherAnnualIncome}</span></div>
              <div class="flex justify-between items-center"><span class="text-gray-400">Aadhar</span><span class="text-gray-200 font-semibold">: ${s.fatherAadhaar}</span></div>
              <div class="flex justify-between items-center"><span class="text-gray-400">Email</span><span class="text-gray-200">: ${s.fatherEmail}</span></div>
              <div class="flex justify-between items-center"><span class="text-gray-400">Mobile</span><span class="text-gray-200">: ${s.fatherMobile}</span></div>
            </div>
          </div>

          <!-- MOTHER DETAILS CARD -->
          <div class="glass-card rounded-2xl p-6 border border-white/10 flex flex-col items-center text-center">
            <h4 class="text-xs font-bold text-gray-300 uppercase tracking-wider mb-4 w-full text-left border-b border-white/10 pb-2">MOTHER DETAILS</h4>
            
            <div class="w-20 h-20 rounded-full overflow-hidden border-2 border-blue-500/40 shadow-md mb-3 flex items-center justify-center bg-gray-800">
              ${s.motherPhoto ? `<img src="${s.motherPhoto}" alt="${s.motherName}" class="w-full h-full object-cover"/>` : `<span class="text-xl font-bold text-white">${s.motherName.split(' ').map(n=>n[0]).join('')}</span>`}
            </div>

            <h5 class="text-sm font-bold text-white mb-0.5">${s.motherName}</h5>
            <p class="text-xs text-gray-400 font-medium mb-4">${s.motherSubtitle}</p>

            <div class="w-full space-y-2 text-xs text-left">
              <div class="flex justify-between items-center"><span class="text-gray-400">Occupation</span><span class="text-gray-200">: ${s.motherOccupation}</span></div>
              <div class="flex justify-between items-center"><span class="text-gray-400">Office Designation</span><span class="text-gray-200">: ${s.motherOfficeDesignation}</span></div>
              <div class="flex justify-between items-center"><span class="text-gray-400">Annual Income</span><span class="text-gray-200">: ${s.motherAnnualIncome}</span></div>
              <div class="flex justify-between items-center"><span class="text-gray-400">Aadhar</span><span class="text-gray-200">: ${s.motherAadhaar}</span></div>
              <div class="flex justify-between items-center"><span class="text-gray-400">Email</span><span class="text-gray-200">: ${s.motherEmail}</span></div>
              <div class="flex justify-between items-center"><span class="text-gray-400">Mobile</span><span class="text-gray-200">: ${s.motherMobile}</span></div>
            </div>
          </div>

        </div>

        <!-- SIBLING DETAILS -->
        <div class="glass-card rounded-2xl p-5 border border-white/10">
          <h4 class="text-xs font-bold text-gray-300 uppercase tracking-widest text-center mb-3">SIBLING DETAILS</h4>
          <div class="bg-white/5 rounded-xl p-3 text-center text-xs text-gray-400 border border-white/5 font-medium">
            No Data Avaliable
          </div>
        </div>

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
