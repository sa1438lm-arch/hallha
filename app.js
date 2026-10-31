// حلّها — تحدي حل المسائل (نسخة مبسطة: جلسة واحدة)
const app = document.getElementById('app');
let ws = null;
let role = null;
let currentSession = null;
let teamId = null;
let reconnectToken = null;
let soundEnabled = localStorage.getItem('soundEnabled') !== 'false';
let lobbyAudio = null;
let startAudio = null;
let winnerAudio = null;
let audioPrepared = false;
let audioContext = null;
let audioBuffers = {};
let lobbySource = null;
let audioUnlocked = false;
let winnerSoundPlayed = false;
let timerInterval = null;
let teacherClockInterval = null;
let currentView = 'home';
let maxGroups = 5;
let pendingTeamJoin = false;
let showJoinedSuccess = false;
let joinStep = 'code';
let pendingJoinCode = '';
let pendingTeamName = '';
let finalFinalizeSent = false;
const QUESTION_DURATION_MS = 20000;
const QUESTION_DURATION_SEC = 20;

const SUGGESTED_NAMES = ['المتألقات', 'العبقريات', 'المبدعات', 'الذكيات', 'المتميزات'];

function connectWS() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);
  ws.onopen = () => {
    console.log('متصل');

    // كل تبويب يحتفظ بهوية مجموعته بشكل مستقل، ثم يستعيد حالته فور عودة الاتصال.
    // هذا يمنع مجموعة من سرقة اتصال مجموعة أخرى عند استخدام أكثر من تبويب على الجهاز نفسه.
    if (!pendingTeamJoin) {
      try {
        const saved = JSON.parse(sessionStorage.getItem('teamReconnect') || 'null');
        if (saved?.sessionId && saved?.teamId && saved?.token) {
          reconnectToken = saved.token;
          ws.send(JSON.stringify({
            type: 'reconnect_team',
            sessionId: saved.sessionId,
            teamId: saved.teamId,
            token: saved.token
          }));
          return;
        }
      } catch {}
    }

    const hostSaved = sessionStorage.getItem('hostSession');
    if (role === 'host' && hostSaved) {
      ws.send(JSON.stringify({ type: 'join_as_host', sessionId: hostSaved }));
    }
  };
  ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
  ws.onclose = () => {
    if (role === 'team' || role === 'host' || currentSession) {
      showError('فقد الاتصال — تتم إعادة المزامنة تلقائيًا');
    }
    setTimeout(connectWS, 1200);
  };
}

function send(msg) {
  const payload = JSON.stringify(msg);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(payload);
    return;
  }
  connectWS();
  if (ws && ws.readyState === WebSocket.CONNECTING) {
    ws.addEventListener('open', () => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(payload);
    }, { once: true });
  }
}

function handleMessage(msg) {
  if (msg.type === 'error') {
    pendingTeamJoin = false;
    showError(msg.message);
    return;
  }
  if (msg.type === 'joined') {
    role = msg.role;
    if (msg.role === 'team') {
      teamId = msg.teamId;
      reconnectToken = msg.reconnectToken || reconnectToken;
      showJoinedSuccess = pendingTeamJoin;
      pendingTeamJoin = false;
      currentView = 'team';
      sessionStorage.setItem('teamReconnect', JSON.stringify({
        sessionId: msg.session?.id,
        teamId,
        token: reconnectToken
      }));
    }
    currentSession = msg.session;
    if (role === 'host') {
      sessionStorage.setItem('hostSession', currentSession.id);
      if (currentSession.state === 'waiting') startLobbyAudio();
    }
    render();
    return;
  }
  if (msg.type === 'answered') {
    if (currentSession?.teams && msg.teamId) {
      const team = currentSession.teams.find(t => t.id === msg.teamId);
      if (team) team.answered = true;
      if (role === 'host' && currentSession.state === 'question_active') renderHost();
    }
    return;
  }
  if (msg.type === 'state') {
    currentSession = msg.session;
    if (currentSession.state !== 'final_reveal') finalFinalizeSent = false;
    if (role === 'host' && currentSession.state === 'waiting') startLobbyAudio();
    else stopLobbyAudio();
    if (role === 'host' && currentSession.state === 'finished' && !winnerSoundPlayed) {
      playWinner();
      winnerSoundPlayed = true;
    }
    render();
  }
}

function showError(text) {
  const el = document.createElement('div');
  el.className = 'error';
  el.textContent = text;
  app.prepend(el);
  setTimeout(() => el.remove(), 4000);
}

function isHost() { return role === 'host'; }

function prepareTeacherAudio() {
  if (audioPrepared) return;

  // HTMLAudio fallback فقط. المحرك الأساسي بالأسفل هو Web Audio API.
  lobbyAudio = new Audio('./audio/lobby.mp3');
  startAudio = new Audio('./audio/start.mp3');
  winnerAudio = new Audio('./audio/winner.mp3');

  lobbyAudio.preload = 'none';
  startAudio.preload = 'none';
  winnerAudio.preload = 'none';
  lobbyAudio.loop = true;
  lobbyAudio.volume = 0.18;
  startAudio.volume = 0.8;
  winnerAudio.volume = 0.9;

  audioPrepared = true;
}

async function loadAudioBuffer(name, url) {
  if (!audioContext || audioBuffers[name]) return audioBuffers[name] || null;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  audioBuffers[name] = await audioContext.decodeAudioData(bytes.slice(0));
  return audioBuffers[name];
}

async function unlockTeacherAudio() {
  if (!isHost() && currentView !== 'host-setup') return;
  prepareTeacherAudio();

  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error('Web Audio API غير مدعوم');

    if (!audioContext) audioContext = new AudioCtx();
    if (audioContext.state === 'suspended') await audioContext.resume();

    // يتم استدعاء هذه الدالة من نقرة المعلمة، لذلك تصبح الجلسة الصوتية مصرحًا بها.
    audioUnlocked = true;

    // تحميل الملفات كـ ArrayBuffer يمنع مشاكل Range/416 التي قد تحدث مع HTMLAudio على بعض الاستضافات.
    await Promise.allSettled([
      loadAudioBuffer('lobby', './audio/lobby.mp3'),
      loadAudioBuffer('start', './audio/start.mp3'),
      loadAudioBuffer('winner', './audio/winner.mp3')
    ]);
  } catch (err) {
    console.warn('تعذر تهيئة Web Audio، سيتم استخدام HTMLAudio كخيار احتياطي:', err);
  }
}

function playBuffer(name, { loop = false, volume = 1 } = {}) {
  if (!audioContext || !audioUnlocked || !audioBuffers[name]) return null;
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});

  const source = audioContext.createBufferSource();
  const gain = audioContext.createGain();
  source.buffer = audioBuffers[name];
  source.loop = loop;
  gain.gain.value = volume;
  source.connect(gain);
  gain.connect(audioContext.destination);
  source.start(0);
  return source;
}

function startLobbyAudio() {
  if (!isHost() || !soundEnabled) return;
  prepareTeacherAudio();

  if (lobbySource) return;
  const source = playBuffer('lobby', { loop: true, volume: 0.18 });
  if (source) {
    lobbySource = source;
    source.onended = () => { if (lobbySource === source) lobbySource = null; };
    return;
  }

  // fallback إذا لم يكتمل تحميل Web Audio بعد.
  if (lobbyAudio) {
    lobbyAudio.currentTime = 0;
    lobbyAudio.play().catch((err) => console.warn('تعذر تشغيل lobby.mp3:', err));
  }
}

function stopLobbyAudio() {
  if (lobbySource) {
    try { lobbySource.stop(); } catch {}
    lobbySource = null;
  }
  if (lobbyAudio) {
    lobbyAudio.pause();
    try { lobbyAudio.currentTime = 0; } catch {}
  }
}

function playStart() {
  if (!isHost() || !soundEnabled) return;
  prepareTeacherAudio();
  const source = playBuffer('start', { volume: 0.8 });
  if (source) return;
  if (startAudio) {
    startAudio.currentTime = 0;
    startAudio.play().catch((err) => console.warn('تعذر تشغيل start.mp3:', err));
  }
}

function playWinner() {
  if (!isHost() || !soundEnabled) return;
  prepareTeacherAudio();
  const source = playBuffer('winner', { volume: 0.9 });
  if (source) return;
  if (winnerAudio) {
    winnerAudio.currentTime = 0;
    winnerAudio.play().catch((err) => console.warn('تعذر تشغيل winner.mp3:', err));
  }
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem('soundEnabled', soundEnabled);
  if (!soundEnabled) stopLobbyAudio();
  else if (currentSession?.state === 'waiting' && isHost()) startLobbyAudio();
  renderSoundToggle();
}
function renderSoundToggle() {
  let btn = document.querySelector('.sound-toggle');
  if (!btn) {
    btn = document.createElement('button');
    btn.className = 'sound-toggle';
    btn.onclick = toggleSound;
    document.body.appendChild(btn);
  }
  btn.textContent = soundEnabled ? '🔊 الصوت' : '🔇 الصوت';
  btn.style.display = isHost() ? 'block' : 'none';
}

function render() {
  renderSoundToggle();
  if (currentView === 'home') return renderHome();
  if (currentView === 'join') return renderJoin();
  if (role === 'host' && currentSession) return renderHost();
  if (role === 'team' && currentSession) return renderTeam();
  renderHome();
}

function renderHome() {
  clearInterval(teacherClockInterval);
  currentView = 'home';
  role = null;
  currentSession = null;
  stopLobbyAudio();
  app.innerHTML = `
    <div class="edu-page home-page">
      <div class="edu-decor decor-stars">✦ ✧ ✦</div>
      <header class="public-brandbar">
        <div class="brand-school">🏫 <span>ابتدائية الأبناء الثانية بالبحرية</span></div>
        <div class="brand-center"><span>الرياضيات</span><strong>خطة حل المسألة</strong></div>
        <div class="brand-game">✨ حلّها</div>
      </header>
      <main class="home-stage">
        <section class="hero-panel">
          <div class="hero-icon">💡</div>
          <div class="hero-kicker">تحدي تعليمي تفاعلي</div>
          <h1>حلّها</h1>
          <p>تحدي حل المسائل بطريقة ممتعة وتعاونية</p>
          <div class="hero-meta"><span>٥ أسئلة</span><span>٢٠ ثانية لكل سؤال</span><span>تحدٍ تفاعلي</span></div>
        </section>
        <section class="role-cards">
          <button class="role-card teacher-role" onclick="startAsTeacher()">
            <span class="role-icon">👩🏻‍🏫</span>
            <strong>دخول المعلمة</strong>
            <small>إنشاء الجلسة وإدارة التحدي</small>
            <b>ابدئي الآن ←</b>
          </button>
          <button class="role-card student-role" onclick="showJoin()">
            <span class="role-icon">👭</span>
            <strong>دخول الطالبات</strong>
            <small>الانضمام برمز الجلسة واختيار المجموعة</small>
            <b>انضمي الآن ←</b>
          </button>
        </section>
      </main>
      <footer class="edu-footer">المعلمة: سلمى العسيري • الرياضيات</footer>
    </div>`;
}

function startAsTeacher() {
  currentView = 'host-setup';
  app.innerHTML = `
    <div class="edu-page setup-page">
      ${teacherHeaderHTML()}
      <main class="setup-stage">
        <section class="setup-card">
          <button class="back-btn styled-back" onclick="renderHome()">← العودة</button>
          <div class="setup-illustration">👥</div>
          <div class="setup-kicker">إعداد التحدي</div>
          <h2>كم مجموعة ستشارك اليوم؟</h2>
          <p>حددي عدد المجموعات ثم أنشئي الجلسة ليظهر رمز الانضمام للطالبات.</p>
          <div class="counter premium-counter">
            <button onclick="changeMax(-1)" aria-label="تقليل عدد المجموعات">−</button>
            <div><strong id="max-groups">${maxGroups}</strong><span>مجموعات</span></div>
            <button onclick="changeMax(1)" aria-label="زيادة عدد المجموعات">+</button>
          </div>
          <div class="setup-range">من ٢ إلى ٥ مجموعات</div>
          <button class="btn btn-gold teacher-primary-action" onclick="createAndOpen()">✨ إنشاء الجلسة</button>
        </section>
      </main>
    </div>`;
  startTeacherClock();
}

function changeMax(d) {
  maxGroups = Math.max(2, Math.min(5, maxGroups + d));
  const el = document.getElementById('max-groups');
  if (el) el.textContent = maxGroups;
}

async function createAndOpen() {
  await unlockTeacherAudio();
  connectWS();
  const trySend = () => {
    if (ws && ws.readyState === WebSocket.OPEN) send({ type: 'create_single_session', maxGroups });
    else setTimeout(trySend, 80);
  };
  trySend();
}

function showJoin() {
  currentView = 'join';
  joinStep = 'code';
  pendingJoinCode = '';
  pendingTeamName = '';
  renderJoin();

  const saved = sessionStorage.getItem('teamReconnect');
  if (saved) {
    try {
      const data = JSON.parse(saved);
      if (data.sessionId && data.teamId && data.token) {
        connectWS();
        setTimeout(() => send({ type: 'reconnect_team', sessionId: data.sessionId, teamId: data.teamId, token: data.token }), 300);
      }
    } catch {}
  }
}

function renderJoin() {
  currentView = 'join';
  const isNameStep = joinStep === 'name';
  const codeValue = pendingJoinCode || '';
  const teamNameValue = pendingTeamName || '';

  app.innerHTML = `
    <div class="edu-page student-entry-page">
      <header class="student-brandbar">
        <div class="student-brand-school">🏫 ابتدائية الأبناء الثانية بالبحرية</div>
        <div class="student-brand-lesson"><span>الرياضيات</span><strong>خطة حل المسألة</strong></div>
        <div class="student-brand-logo">✨ حلّها</div>
      </header>
      <main class="student-entry-stage">
        <section class="student-entry-card">
          <button class="back-btn styled-back" onclick="${isNameStep ? 'backToJoinCodeStep()' : 'renderHome()'}">← ${isNameStep ? 'تغيير الرمز' : 'العودة'}</button>
          <div class="entry-icon">${isNameStep ? '👭' : '🔐'}</div>
          <div class="entry-kicker">${isNameStep ? 'الخطوة الثانية' : 'الخطوة الأولى'}</div>
          <h2>${isNameStep ? 'اختاري اسم المجموعة' : 'انضمي إلى التحدي'}</h2>
          <p>${isNameStep ? 'اختاري اسمًا مميزًا لمجموعتك ثم أكملي الانضمام.' : 'أدخلي رمز الجلسة المكوّن من ٦ أرقام.'}</p>

          <div class="join-progress premium-steps">
            <div class="join-step-item ${!isNameStep ? 'active' : 'done'}"><span>١</span><strong>رمز الجلسة</strong></div>
            <div class="join-step-line"></div>
            <div class="join-step-item ${isNameStep ? 'active' : ''}"><span>٢</span><strong>اسم المجموعة</strong></div>
          </div>

          ${!isNameStep ? `
            <div class="join-card premium-join-card">
              <label>رمز الجلسة</label>
              <input class="code-input" type="text" id="join-code" maxlength="6" value="${codeValue}" placeholder="مثال: ١٢٣٤٥٦" inputmode="numeric" autocomplete="off">
              <div class="helper-text">سيتم التحقق من الرمز عند الانضمام النهائي.</div>
              <button class="btn btn-primary join-main-btn" onclick="checkCode()">دخول إلى الجلسة</button>
            </div>
          ` : `
            <div class="join-card premium-join-card">
              <div class="code-summary">🔑 رمز الجلسة <strong>${codeValue}</strong></div>
              <label>اسم المجموعة</label>
              <input type="text" id="team-name" maxlength="30" value="${teamNameValue}" placeholder="اكتبي اسم المجموعة" oninput="pendingTeamName=this.value">
              <div class="suggestions premium-suggestions">
                ${SUGGESTED_NAMES.map(n => `<button class="suggestion" onclick="setSuggestedName('${n}')">${n}</button>`).join('')}
              </div>
              <div class="join-actions">
                <button class="btn btn-light" onclick="backToJoinCodeStep()">رجوع</button>
                <button class="btn btn-gold join-main-btn" onclick="joinTeam()">✨ انضمام</button>
              </div>
            </div>
          `}
        </section>
      </main>
    </div>`;
}

function backToJoinCodeStep() {
  joinStep = 'code';
  renderJoin();
}

function normalizeDigits(value) {
  return String(value || '')
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/\s+/g, '');
}

function checkCode() {
  const codeInput = document.getElementById('join-code');
  const code = normalizeDigits(codeInput ? codeInput.value : pendingJoinCode);
  if (!/^\d{6}$/.test(code)) return showError('أدخلي رمز الجلسة المكوّن من ٦ أرقام');
  pendingJoinCode = code;
  joinStep = 'name';
  renderJoin();
}

function setSuggestedName(name) {
  pendingTeamName = name;
  const input = document.getElementById('team-name');
  if (input) input.value = name;
}

function joinTeam() {
  const input = document.getElementById('team-name');
  const name = (input ? input.value : pendingTeamName).trim();
  if (!name) return showError('يرجى إدخال اسم المجموعة');
  pendingTeamName = name;
  pendingTeamJoin = true;
  connectWS();
  setTimeout(() => send({ type: 'join_as_team', code: normalizeDigits(pendingJoinCode), name }), 200);
}

function stateText(state) {
  return { waiting: 'بانتظار المجموعات', question_active: 'السؤال جارٍ', question_reveal: 'عرض الحل', leaderboard: 'انتقال', final_reveal: 'إعلان المراكز', finished: 'انتهت الجلسة' }[state] || state;
}

function toArabicDigits(value) {
  return String(value).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
}

function teacherHeaderHTML() {
  return `
    <header class="teacher-topbar">
      <div class="teacher-school-chip">
        <div class="teacher-school-icon">🏫</div>
        <div>
          <div class="teacher-school-name">ابتدائية الأبناء الثانية بالبحرية</div>
          <div class="teacher-school-sub">تحدي حلّها • الرياضيات</div>
        </div>
      </div>
      <div class="teacher-lesson-brand">
        <span class="teacher-subject-pill">الرياضيات</span>
        <strong>خطة حل المسألة</strong>
        <span class="teacher-bulb">💡</span>
      </div>
      <div class="teacher-meta-area">
        <div class="teacher-name-chip">👩🏻‍🏫 <span>المعلمة: سلمى العسيري</span></div>
        <div class="teacher-datetime-card">
          <div id="teacher-hijri-date" class="teacher-hijri-date">—</div>
          <div id="teacher-date" class="teacher-gregorian-date">—</div>
          <div id="teacher-time">—</div>
        </div>
      </div>
    </header>`;
}

function updateTeacherDateTime() {
  const hijriEl = document.getElementById('teacher-hijri-date');
  const dateEl = document.getElementById('teacher-date');
  const timeEl = document.getElementById('teacher-time');
  if (!dateEl || !timeEl) return;
  const now = new Date();
  const hijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-arab', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }).format(now);
  const date = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-arab', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }).format(now);
  const time = new Intl.DateTimeFormat('ar-SA-u-nu-arab', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(now);
  if (hijriEl) hijriEl.textContent = `هـ ${hijri}`;
  dateEl.textContent = `م ${date}`;
  timeEl.textContent = `🕒 ${time}`;
}

function startTeacherClock() {
  clearInterval(teacherClockInterval);
  updateTeacherDateTime();
  teacherClockInterval = setInterval(updateTeacherDateTime, 1000);
}

function teamAnswerPanelHTML(s) {
  const total = s.teams?.length || 0;
  const answered = (s.teams || []).filter(t => t.answered).length;
  const allAnswered = total > 0 && answered >= total;
  const pct = total ? Math.round((answered / total) * 100) : 0;
  return `
    <aside class="teacher-answer-panel">
      <div class="teacher-panel-title"><span>👥</span> متابعة إجابات المجموعات</div>
      <div class="answer-summary-card ${allAnswered ? 'complete' : ''}">
        <div class="answer-summary-icon">${allAnswered ? '✅' : '⏳'}</div>
        <div class="answer-summary-label">الإجابات</div>
        <div class="answer-summary-count">${toArabicDigits(answered)} / ${toArabicDigits(total)}</div>
        <div class="answer-progress"><div style="width:${pct}%"></div></div>
        <div class="answer-summary-message">${allAnswered ? 'اكتملت إجابات جميع المجموعات' : `بانتظار ${toArabicDigits(Math.max(0,total-answered))} مجموعة`}</div>
      </div>
      <div class="teacher-team-status-list">
        ${(s.teams || []).map((t, i) => `
          <div class="teacher-team-status ${t.answered ? 'answered' : ''}">
            <span class="team-order">${toArabicDigits(i + 1)}</span>
            <span class="team-symbol">${t.symbol || '★'}</span>
            <span class="team-name">${t.name}</span>
            <span class="team-state">${t.answered ? '✅ تمت الإجابة' : '⏳ بانتظار الإجابة'}</span>
          </div>`).join('')}
      </div>
    </aside>`;
}

function renderHost() {
  if (!currentSession) return;
  const s = currentSession;
  let content = '';

  if (s.state === 'waiting') {
    content = `
      <section class="teacher-lobby-card">
        <div class="teacher-lobby-badge">جاهزون للانطلاق ✨</div>
        <h2>رمز الجلسة</h2>
        <div class="lobby-code">${s.code}</div>
        <div class="teacher-lobby-count">${toArabicDigits(s.teamCount)} / ${toArabicDigits(s.maxGroups || 5)} مجموعات</div>
        <div class="teacher-lobby-teams">
          ${s.teams.map(t => `<div class="teacher-lobby-team"><span>${t.symbol}</span><strong>${t.name}</strong><em class="${t.connected ? 'connected' : 'waiting'}">${t.connected ? '● متصلة' : '● غير متصلة'}</em></div>`).join('') || '<p>في انتظار انضمام المجموعات...</p>'}
        </div>
        <button class="btn btn-gold teacher-primary-action" ${s.teamCount < 2 ? 'disabled' : ''} onclick="startChallenge()">▶ ابدئي التحدي</button>
      </section>`;
  } else if (s.state === 'question_active') {
    const q = s.question || {};
    const answered = (s.teams || []).filter(t => t.answered).length;
    const allAnswered = s.teams?.length > 0 && answered === s.teams.length;
    content = `
      <div class="teacher-dashboard-grid">
        <section class="teacher-question-card">
          <div class="teacher-question-tools">
            <div class="teacher-question-number">📖 السؤال ${toArabicDigits(q.index || (s.currentQuestion + 1))} من ${toArabicDigits(q.total || 5)}</div>
            <div class="teacher-category-pill">${q.category || '📘 الرياضيات'}</div>
            <div class="teacher-timer-ring"><span id="timer">${toArabicDigits(QUESTION_DURATION_SEC)}</span><small>ثانية</small></div>
          </div>
          <div class="teacher-time-progress"><div class="progress-fill" id="progress"></div></div>
          <div class="teacher-question-text">${q.text || 'جاري تحميل السؤال...'}</div>
          <div class="teacher-options-grid">
            ${(q.options || []).map((opt, i) => `<div class="teacher-option"><span class="option-letter">${['أ','ب','ج','د'][i] || toArabicDigits(i+1)}</span><span>${opt}</span></div>`).join('')}
          </div>
          <div class="teacher-active-note ${allAnswered ? 'complete' : ''}">${allAnswered ? '✅ وصلت إجابات جميع المجموعات — يمكنكِ الانتقال الآن أو انتظار انتهاء الوقت.' : '⏱️ يمكنكِ الانتقال للسؤال التالي في أي وقت، حتى قبل انتهاء الـ٢٠ ثانية.'}</div>
          <button class="teacher-next-btn early-next" onclick="teacherSkipToNext(${allAnswered})">${s.currentQuestion >= 4 ? '🏆 إنهاء السؤال وعرض النتيجة' : 'السؤال التالي'} <span>◀</span></button>
        </section>
        ${teamAnswerPanelHTML(s)}
      </div>`;
    startTimer(s.questionStartTime);
  } else if (s.state === 'question_reveal') {
    const r = s.reveal || {};
    const isLast = s.currentQuestion >= 4;
    content = `
      <div class="teacher-dashboard-grid reveal-mode">
        <section class="teacher-question-card">
          <div class="teacher-question-tools">
            <div class="teacher-question-number">💡 كشف الحل</div>
            <div class="teacher-category-pill">${r.category || ''}</div>
            <div class="teacher-solution-check">✓</div>
          </div>
          <div class="teacher-question-text reveal-question">${r.text || ''}</div>
          <div class="teacher-options-grid">
            ${(r.options || []).map((opt, i) => `<div class="teacher-option ${i === r.correct ? 'correct' : ''}"><span class="option-letter">${['أ','ب','ج','د'][i] || toArabicDigits(i+1)}</span><span>${opt}</span>${i === r.correct ? '<b class="correct-mark">✓</b>' : ''}</div>`).join('')}
          </div>
          <div class="teacher-solution-box"><span>💡 كشف الحل (للمعلمة فقط)</span><strong>${(r.solution || '').replace(/\n/g, '<br>')}</strong></div>
        </section>
        ${teamAnswerPanelHTML(s)}
      </div>
      <button class="teacher-next-btn ${isLast ? 'final' : ''}" onclick="goNext()">${isLast ? '🏆 عرض النتيجة النهائية' : 'السؤال التالي'} <span>◀</span></button>`;
  } else if (s.state === 'leaderboard') {
    content = `<div class="teacher-transition-card"><div class="spinner-orbit">✦</div><h2>جارٍ الانتقال إلى السؤال التالي…</h2></div>`;
  } else if (s.state === 'final_reveal') {
    content = `
      <div class="final-reveal-shell">
        <div class="final-reveal-kicker">لحظة الحسم</div>
        <h2>إعلان المراكز النهائية</h2>
        <p class="final-reveal-subtitle">نبدأ من المركز الثالث وصولًا إلى بطلات التحدي 🏆</p>
        <div class="reveal-stage" id="reveal-stage"></div>
        <div class="reveal-progress"><div id="reveal-progress-fill"></div></div>
      </div>`;
  } else if (s.state === 'finished') {
    const sorted = [...s.teams].sort((a,b) => b.score - a.score || a.totalTime - b.totalTime);
    const winner = sorted[0];
    const totalCorrect = s.teams.reduce((sum, t) => sum + (t.correctCount || 0), 0);
    const totalPossible = s.teams.length * 5;
    const accuracy = totalPossible ? Math.round((totalCorrect / totalPossible) * 100) : 0;
    content = `
      <section class="teacher-final-board">
        <div class="final-crown">🏆</div>
        <div class="final-kicker">النتيجة النهائية</div>
        <h2>بطلات تحدي حلّها</h2>
        <div class="final-winner premium"><div class="winner-symbol">${winner?.symbol || '★'}</div><div class="name">${winner?.name || '—'}</div><div class="score">${toArabicDigits(winner?.score || 0)} نقطة</div></div>
        <div class="teacher-final-ranking">
          ${sorted.map((t,i)=>`<div class="teacher-final-rank rank-${i+1}"><span class="medal">${i===0?'🥇':i===1?'🥈':i===2?'🥉':toArabicDigits(i+1)}</span><span>${t.symbol}</span><strong>${t.name}</strong><b>${toArabicDigits(t.score)} نقطة</b></div>`).join('')}
        </div>
        <div class="class-result"><strong>نتيجة الفصل</strong><span>${toArabicDigits(totalCorrect)} / ${toArabicDigits(totalPossible)} إجابة صحيحة</span><span>دقة الفصل: ${toArabicDigits(accuracy)}٪</span></div>
      </section>`;
    createConfetti();
  }

  app.innerHTML = `<div class="teacher-page">${teacherHeaderHTML()}<main class="teacher-main">${content}</main></div>`;
  startTeacherClock();
  if (s.state === 'final_reveal') startFinalRevealAnimation(s);
}

function startFinalRevealAnimation(session) {
  clearInterval(timerInterval);
  const stage = document.getElementById('reveal-stage');
  const progress = document.getElementById('reveal-progress-fill');
  if (!stage) return;

  const ranking = session.finalSummary?.ranking || [...(session.teams || [])]
    .sort((a,b) => b.score - a.score || a.totalTime - b.totalTime)
    .map((t, index) => ({ ...t, rank: index + 1 }));
  const podium = ranking.slice(0, 3).reverse(); // الثالث ثم الثاني ثم الأول
  if (!podium.length) return;

  const start = session.finalRevealStartTime || Date.now();
  const duration = session.finalRevealDuration || 9000;
  const slot = duration / podium.length;
  let lastIndex = -1;

  const medal = rank => rank === 1 ? '🏆' : rank === 2 ? '🥈' : '🥉';
  const rankLabel = rank => rank === 1 ? 'المركز الأول' : rank === 2 ? 'المركز الثاني' : 'المركز الثالث';

  const tick = () => {
    const elapsed = Math.max(0, Date.now() - start);
    const index = Math.min(podium.length - 1, Math.floor(elapsed / slot));
    if (progress) progress.style.width = `${Math.min(100, (elapsed / duration) * 100)}%`;

    if (index !== lastIndex) {
      lastIndex = index;
      const team = podium[index];
      const isWinner = team.rank === 1;
      stage.innerHTML = `
        <div class="reveal-rank-card ${isWinner ? 'winner-reveal' : ''}">
          <div class="reveal-medal">${medal(team.rank)}</div>
          <div class="reveal-rank-label">${rankLabel(team.rank)}</div>
          <div class="reveal-team-symbol">${team.symbol || '★'}</div>
          <div class="reveal-team-name">${team.name || '—'}</div>
          <div class="reveal-team-score">${team.score || 0} نقطة</div>
          ${isWinner ? '<div class="reveal-winner-line">بطلات تحدي حلّها ✨</div>' : '<div class="reveal-next-line">والآن… من في المركز التالي؟</div>'}
        </div>`;
      if (isWinner) createConfetti();
    }

    if (elapsed >= duration) {
      clearInterval(timerInterval);
      if (!finalFinalizeSent && currentSession?.state === 'final_reveal') {
        finalFinalizeSent = true;
        send({ type: 'finalize_results' });
      }
    }
  };

  tick();
  timerInterval = setInterval(tick, 120);
}

function startChallenge() {
  send({ type: 'start_challenge' });
  playStart();
  stopLobbyAudio();
}
function teacherSkipToNext(allAnswered) {
  if (!allAnswered) {
    const remaining = (currentSession?.teams || []).filter(t => !t.answered).length;
    const ok = window.confirm(`ما زالت ${toArabicDigits(remaining)} مجموعة لم تُجب. هل تريدين الانتقال الآن؟`);
    if (!ok) return;
  }
  send({ type: 'force_next_question' });
}

function goNext() { send({ type: 'next_question' }); }

function studentGameHeaderHTML(s) {
  const me = (s.teams || []).find(t => t.id === teamId);
  return `
    <header class="student-game-header">
      <div class="student-game-school">🏫 <span>ابتدائية الأبناء الثانية بالبحرية</span></div>
      <div class="student-game-lesson"><span>الرياضيات</span><strong>خطة حل المسألة</strong></div>
      <div class="student-game-team"><small>المجموعة</small><strong>${me?.symbol || '★'} ${me?.name || '—'}</strong></div>
    </header>`;
}

function studentShell(content, s, extraClass = '') {
  return `<div class="student-game-page ${extraClass}">${studentGameHeaderHTML(s)}<main class="student-game-main">${content}</main></div>`;
}

function renderTeam() {
  if (!currentSession) return;
  const s = currentSession;
  const joinedNow = showJoinedSuccess;
  showJoinedSuccess = false;
  let content = '';

  if (s.state === 'waiting') {
    const me = (s.teams || []).find(t => t.id === teamId);
    content = `
      ${joinedNow ? '<div id="join-success" class="join-success premium-success">✓ تم الانضمام إلى التحدي بنجاح</div>' : ''}
      <section class="student-lobby-card">
        <div class="student-state-icon">✨</div>
        <div class="student-state-kicker">تم الانضمام بنجاح</div>
        <h2>في انتظار بدء التحدي</h2>
        <p>استعدوا يا <strong>${me?.name || 'بطلات'}</strong>، ستظهر الأسئلة هنا فور أن تبدأ المعلمة.</p>
        <div class="student-session-code"><span>رمز الجلسة</span><strong>${s.code}</strong></div>
        <div class="student-connected-badge">● متصلة بالتحدي</div>
        <div class="student-mini-teams">
          ${(s.teams || []).map(t => `<span class="${t.id===teamId?'mine':''}">${t.symbol} ${t.name}</span>`).join('')}
        </div>
      </section>`;
  } else if (s.state === 'question_active') {
    const q = s.question || {};
    content = `
      <section class="student-question-card">
        <div class="student-question-topline">
          <div class="student-question-number">📖 السؤال ${toArabicDigits(q.index || (s.currentQuestion+1))} من ${toArabicDigits(q.total || 5)}</div>
          <div class="student-category-pill">${q.category || '📘 الرياضيات'}</div>
          <div class="student-timer-ring"><span id="timer">${toArabicDigits(QUESTION_DURATION_SEC)}</span><small>ثانية</small></div>
        </div>
        <div class="student-time-progress"><div class="progress-fill" id="progress"></div></div>
        <div class="student-question-text">${q.text || 'جاري تحميل السؤال...'}</div>
        <div class="student-options-grid" id="options">
          ${(q.options || []).map((opt, i) => `<button class="student-option" data-index="${i}" onclick="selectOption(this, ${i})"><span class="option-letter">${['أ','ب','ج','د'][i] || toArabicDigits(i+1)}</span><span>${opt}</span></button>`).join('')}
        </div>
        <div id="answer-status" class="student-answer-status">اختاري إجابتك ثم انتظري بقية المجموعات 🌟</div>
      </section>`;
    startTimer(s.questionStartTime);
  } else if (s.state === 'question_reveal' || s.state === 'leaderboard') {
    const isLastQuestion = s.currentQuestion >= 4;
    content = isLastQuestion ? `
      <section class="student-wait-card premium-wait final-wait-card">
        <div class="student-wait-icon final-wait-icon">🏆</div>
        <div class="final-wait-kicker">اكتمل التحدي</div>
        <h2>انتهى السؤال الأخير</h2>
        <p>استعدوا لإعلان النتيجة النهائية</p>
        <div class="final-wait-pulse"><span></span><span></span><span></span></div>
        <small>انتظروا إعلان المعلمة…</small>
      </section>` : `
      <section class="student-wait-card premium-wait">
        <div class="student-wait-icon">⏳</div>
        <div class="student-state-kicker">أحسنتم</div>
        <h2>تم انتهاء السؤال</h2>
        <p>انتظروا انتقال المعلمة إلى السؤال التالي.</p>
        <div class="wait-decoration">✦  ✧  ✦</div>
      </section>`;
  } else if (s.state === 'final_reveal') {
    content = `
      <section class="student-wait-card premium-wait final-announcement-wait">
        <div class="student-wait-icon final-wait-icon">🏆</div>
        <div class="final-wait-kicker">لحظات الحسم</div>
        <h2>جارٍ إعلان المراكز النهائية</h2>
        <p>استعدوا لمعرفة المجموعة الفائزة…</p>
        <div class="final-wait-pulse"><span></span><span></span><span></span></div>
      </section>`;
  } else if (s.state === 'finished') {
    const summary = s.finalSummary || {};
    const winner = summary.winner || {};
    const me = (s.teams || []).find(t => t.id === teamId);
    const isWinner = winner.id && winner.id === teamId;
    content = `
      <section class="student-final-celebration premium-final ${isWinner ? 'you-won' : ''}">
        <div class="celebration-stars" aria-hidden="true">✦ ✧ ✦ ✧ ✦</div>
        <div class="winner-cup" aria-hidden="true">🏆</div>
        <div class="final-kicker">النتيجة النهائية</div>
        <h2>${isWinner ? 'مبروك! مجموعتكم هي الفائزة 🎉' : 'مبروك للمجموعة الفائزة!'}</h2>
        <div class="student-winner-card">
          <div class="winner-symbol">${winner.symbol || '★'}</div>
          <div class="winner-name">${winner.name || 'المجموعة الفائزة'}</div>
          <div class="winner-score">${toArabicDigits(winner.score ?? 0)} نقطة</div>
        </div>
        <div class="student-final-stats">
          <div><strong>${toArabicDigits(summary.totalCorrect ?? 0)}</strong><span>إجابة صحيحة</span></div>
          <div><strong>${toArabicDigits(summary.accuracy ?? 0)}٪</strong><span>دقة الفصل</span></div>
        </div>
        <p class="celebration-note">${isWinner ? 'بطلات حلّها لهذا التحدي 🌟' : `أحسنتم يا ${me?.name || 'بطلات'}، مشاركة رائعة 🌟`}</p>
      </section>`;
    createConfetti();
  } else {
    content = `
      <section class="student-wait-card premium-wait">
        <div class="student-wait-icon">🔄</div>
        <h2>جارٍ مزامنة التحدي</h2>
        <p>سيتم تحديث الشاشة تلقائيًا خلال لحظات.</p>
      </section>`;
    requestCurrentState();
  }

  app.innerHTML = studentShell(content, s, `state-${s.state}`);
  if (joinedNow) setTimeout(() => document.getElementById('join-success')?.remove(), 3500);
}

function requestCurrentState() {
  if (!currentSession?.id) return;
  send({ type: 'sync_state', sessionId: currentSession.id });
}

function selectOption(el, index) {
  if (el.parentElement.classList.contains('locked')) return;
  document.querySelectorAll('.option, .student-option').forEach(o => {
    o.classList.remove('selected');
    o.style.pointerEvents = 'none';
  });
  el.classList.add('selected');
  el.parentElement.classList.add('locked');
  const status = document.getElementById('answer-status');
  if (status) {
    status.textContent = '✓ تم اعتماد إجابتكم — انتظروا بقية المجموعات';
    status.classList.add('answered');
  }
  send({ type: 'answer', option: index });
}

function startTimer(startTime) {
  clearInterval(timerInterval);
  if (!startTime) startTime = Date.now();
  const update = () => {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, QUESTION_DURATION_SEC - Math.floor(elapsed / 1000));
    const timerEl = document.getElementById('timer');
    const progressEl = document.getElementById('progress');
    if (timerEl) {
      timerEl.textContent = toArabicDigits(remaining);
      timerEl.classList.toggle('pulse', remaining <= 5 && remaining > 0);
    }
    if (progressEl) progressEl.style.width = `${Math.min(100, (elapsed / QUESTION_DURATION_MS) * 100)}%`;
    if (remaining <= 0) clearInterval(timerInterval);
  };
  update();
  timerInterval = setInterval(update, 200);
}

function createConfetti() {
  for (let i = 0; i < 30; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = ['#F4C542','#4C3A78','#6EE7B7','#E9E2FF'][i%4];
    c.style.animationDelay = (Math.random() * 2) + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 4000);
  }
}

// استعادة حالة نفس التبويب عند التحديث، مع بقاء كل مجموعة مستقلة عن بقية التبويبات.
const storedTeamReconnect = (() => {
  try { return JSON.parse(sessionStorage.getItem('teamReconnect') || 'null'); }
  catch { return null; }
})();
const hostSaved = sessionStorage.getItem('hostSession');

if (storedTeamReconnect?.sessionId && storedTeamReconnect?.teamId && storedTeamReconnect?.token) {
  currentView = 'team';
  teamId = storedTeamReconnect.teamId;
  reconnectToken = storedTeamReconnect.token;
} else if (hostSaved) {
  currentView = 'host';
  role = 'host';
}

connectWS();
if (!storedTeamReconnect && !hostSaved) renderHome();
