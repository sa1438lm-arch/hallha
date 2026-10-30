// حلّها — تحدي حل المسائل
// Client SPA

const app = document.getElementById('app');
let ws = null;
let role = null; // 'host' | 'team' | null
let currentSession = null;
let teamId = null;
let reconnectToken = null;
let soundEnabled = localStorage.getItem('soundEnabled') !== 'false';
let lobbyAudio = null;
let winnerSoundPlayed = false;
let timerInterval = null;
let currentView = 'home';

const SYMBOLS = ['◆', '✦', '⬡', '◈', '✧'];
const SUGGESTED_NAMES = ['المتألقات', 'العبقريات', 'المبدعات', 'الذكيات', 'المتميزات'];

function connectWS() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);
  ws.onopen = () => console.log('متصل');
  ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
  ws.onclose = () => {
    showError('فقد الاتصال — نحاول إعادة الاتصال');
    setTimeout(connectWS, 2000);
  };
  ws.onerror = () => {};
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function handleMessage(msg) {
  if (msg.type === 'error') {
    showError(msg.message);
    return;
  }
  if (msg.type === 'sessions_created' || msg.type === 'sessions_list') {
    renderSettings(msg.sessions || []);
    return;
  }
  if (msg.type === 'joined') {
    role = msg.role;
    if (msg.role === 'team') {
      teamId = msg.teamId;
      reconnectToken = msg.reconnectToken || reconnectToken;
      localStorage.setItem('teamReconnect', JSON.stringify({
        sessionId: currentSession?.id || msg.session?.id,
        teamId,
        token: reconnectToken
      }));
    }
    currentSession = msg.session;
    if (role === 'host') sessionStorage.setItem('hostSession', currentSession.id);
    render();
    return;
  }
  if (msg.type === 'state') {
    currentSession = msg.session;
    if (role === 'host' && currentSession.state === 'waiting') {
      startLobbyAudio();
    } else {
      stopLobbyAudio();
    }
    if (role === 'host' && currentSession.state === 'finished' && !winnerSoundPlayed) {
      playWinner();
      winnerSoundPlayed = true;
    }
    render();
    return;
  }
  if (msg.type === 'answered') {
    // update answered status visually if needed
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

// Audio helpers (host only)
function isHost() { return role === 'host'; }

function startLobbyAudio() {
  if (!isHost() || !soundEnabled) return;
  if (lobbyAudio) return;
  lobbyAudio = new Audio('/audio/lobby.mp3');
  lobbyAudio.loop = true;
  lobbyAudio.volume = 0.18;
  lobbyAudio.play().catch(() => {});
}

function stopLobbyAudio() {
  if (lobbyAudio) {
    lobbyAudio.pause();
    lobbyAudio.currentTime = 0;
    lobbyAudio = null;
  }
}

function playStart() {
  if (!isHost() || !soundEnabled) return;
  const a = new Audio('/audio/start.mp3');
  a.loop = false;
  a.play().catch(() => {});
}

function playWinner() {
  if (!isHost() || !soundEnabled) return;
  const a = new Audio('/audio/winner.mp3');
  a.loop = false;
  a.play().catch(() => {});
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

// Views
function render() {
  renderSoundToggle();
  if (currentView === 'home') return renderHome();
  if (currentView === 'settings') return renderSettings([]);
  if (currentView === 'join') return renderJoin();
  if (role === 'host' && currentSession) return renderHost();
  if (role === 'team' && currentSession) return renderTeam();
  renderHome();
}

function renderHome() {
  currentView = 'home';
  role = null;
  currentSession = null;
  stopLobbyAudio();
  app.innerHTML = `
    <div class="math-bg">
      ${['π','√','×','÷','+','−','△','◇','x²','E=mc²'].map((s,i) => 
        `<span style="left:${10+i*9}%; top:${20+i*7}%; animation-delay:${i*2}s">${s}</span>`
      ).join('')}
    </div>
    <div class="container">
      <div class="home-header">
        <h1>حلّها</h1>
        <div class="subtitle">تحدي حل المسائل</div>
        <div class="lesson">اسم الدرس: خطة حل المسألة</div>
        <div class="meta">٥ أسئلة • ٥ مجموعات لكل جلسة • ٢٠ ثانية لكل سؤال</div>
      </div>
      <div class="cards">
        <div class="card" onclick="showSettings()">
          <h3>⚙️ إعدادات المعلم</h3>
          <p>إدارة الجلسات والتحكم في عددها وإعداد التحدي</p>
        </div>
        <div class="card" onclick="showSettings()">
          <h3>▶ ابدأ كمعلم</h3>
          <p>ابدأ جلسة واعرض التحدي للطالبات</p>
        </div>
        <div class="card" onclick="showJoin()">
          <h3>▶ ابدأ كمجموعة</h3>
          <p>انضمي إلى إحدى الجلسات باستخدام رمز الجلسة</p>
        </div>
      </div>
    </div>
  `;
}

function showSettings() {
  currentView = 'settings';
  connectWS();
  send({ type: 'list_sessions' });
  renderSettings([]);
}

let sessionCount = 1;

function renderSettings(list = []) {
  app.innerHTML = `
    <div class="screen">
      <div class="screen-inner">
        <button class="back-btn" onclick="renderHome()">← العودة</button>
        <h2>إعدادات المعلم</h2>
        <p style="margin:12px 0 24px; color:#6B6580;">إنشاء وإدارة الجلسات المستقلة</p>

        <h3>عدد الجلسات</h3>
        <div class="counter" style="margin:16px 0 24px;">
          <button onclick="changeCount(-1)" ${sessionCount<=1?'disabled':''}>−</button>
          <span>${sessionCount}</span>
          <button onclick="changeCount(1)" ${sessionCount>=10?'disabled':''}>+</button>
        </div>
        <button class="btn btn-primary" onclick="createSessions()">إنشاء الجلسات</button>

        <h3 style="margin-top:40px;">الجلسات الحالية</h3>
        <div class="session-grid" id="session-list">
          ${list.map((s,i) => `
            <div class="session-card">
              <div>الجلسة ${i+1}</div>
              <div class="code">${s.code}</div>
              <div><span class="status-dot status-${s.state==='waiting'?'waiting':s.state==='finished'?'finished':'active'}"></span>
                ${stateText(s.state)}
              </div>
              <div style="margin:8px 0;">${s.teamCount} / ٥ مجموعات</div>
              ${s.currentQuestion !== undefined && s.state !== 'waiting' ? `<div>السؤال ${s.currentQuestion+1} من ٥</div>` : ''}
              <button class="btn btn-primary" style="width:100%; margin-top:12px;" onclick="openSession('${s.id}')">فتح الجلسة</button>
            </div>
          `).join('') || '<p style="grid-column:1/-1; text-align:center; color:#999;">لا توجد جلسات بعد</p>'}
        </div>
      </div>
    </div>
  `;
}

function changeCount(d) {
  sessionCount = Math.max(1, Math.min(10, sessionCount + d));
  renderSettings(document.querySelectorAll('.session-card').length ? [] : []);
  send({ type: 'list_sessions' });
}

function createSessions() {
  send({ type: 'create_sessions', count: sessionCount });
}

function openSession(id) {
  currentView = 'host';
  connectWS();
  send({ type: 'join_as_host', sessionId: id });
}

function showJoin() {
  currentView = 'join';
  app.innerHTML = `
    <div class="screen">
      <div class="screen-inner" style="max-width:480px;">
        <button class="back-btn" onclick="renderHome()">← العودة</button>
        <h2>انضمي إلى التحدي</h2>
        <label>رمز الجلسة</label>
        <input type="text" id="join-code" maxlength="6" placeholder="٦ أرقام" inputmode="numeric">
        <button class="btn btn-primary" style="width:100%;" onclick="checkCode()">دخول</button>
        <div id="name-section" style="display:none; margin-top:24px;">
          <label>اسم المجموعة</label>
          <input type="text" id="team-name" placeholder="اكتبي اسم المجموعة" maxlength="30">
          <div class="suggestions">
            ${SUGGESTED_NAMES.map(n => `<button class="suggestion" onclick="document.getElementById('team-name').value='${n}'">${n}</button>`).join('')}
          </div>
          <button class="btn btn-gold" style="width:100%;" onclick="joinTeam()">انضمام</button>
        </div>
      </div>
    </div>
  `;
  // Try reconnect
  const saved = localStorage.getItem('teamReconnect');
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

function checkCode() {
  const code = document.getElementById('join-code').value.trim();
  if (!/^\d{6}$/.test(code)) return showError('رمز الجلسة غير صحيح');
  // We don't validate code existence until join, but show name section
  document.getElementById('name-section').style.display = 'block';
  window._pendingCode = code;
}

function joinTeam() {
  const name = document.getElementById('team-name').value.trim();
  if (!name) return showError('يرجى إدخال اسم المجموعة');
  connectWS();
  setTimeout(() => {
    send({ type: 'join_as_team', code: window._pendingCode, name });
  }, 200);
}

function stateText(state) {
  const map = {
    waiting: 'بانتظار المجموعات',
    question_active: 'السؤال جارٍ',
    question_reveal: 'عرض الحل',
    leaderboard: 'عرض الترتيب',
    finished: 'انتهت الجلسة'
  };
  return map[state] || state;
}

function renderHost() {
  if (!currentSession) return;
  const s = currentSession;
  let content = '';

  if (s.state === 'waiting') {
    content = `
      <h2>كود الجلسة</h2>
      <div class="lobby-code">${s.code}</div>
      <div style="text-align:center; font-size:20px; margin-bottom:24px;">${s.teamCount} / ٥ مجموعات متصلة</div>
      <div class="teams-list">
        ${s.teams.map(t => `
          <div class="team-item">
            <span class="symbol">${t.symbol}</span>
            <span>${t.name}</span>
            <span class="${t.connected ? 'connected' : 'waiting'}">● ${t.connected ? 'متصلة' : 'غير متصلة'}</span>
          </div>
        `).join('') || '<p style="text-align:center; color:#999;">في انتظار انضمام المجموعات...</p>'}
      </div>
      <button class="btn btn-gold" style="width:100%; margin-top:16px;" ${s.teamCount < 2 ? 'disabled' : ''} onclick="startChallenge()">ابدئي التحدي</button>
    `;
  } else if (s.state === 'question_active') {
    content = `
      <div class="question-header">
        <div>السؤال ${s.currentQuestion + 1} من ٥</div>
        <div class="timer" id="timer">٢٠</div>
      </div>
      <div class="progress-bar"><div class="progress-fill" id="progress"></div></div>
      <div class="teams-list">
        ${s.teams.map(t => `
          <div class="team-item">
            <span class="symbol">${t.symbol}</span>
            <span>${t.name}</span>
            <span>${t.answered ? '✓ أجابت' : 'بانتظار الإجابة'}</span>
          </div>
        `).join('')}
      </div>
      <p style="text-align:center; color:#6B6580; margin-top:24px;">المعلمة لا ترى الإجابات أثناء السؤال</p>
    `;
    startTimer(s.questionStartTime);
  } else if (s.state === 'question_reveal') {
    const r = s.reveal || {};
    content = `
      <h2>كشف الحل</h2>
      <div class="category">${r.category || ''}</div>
      <div class="question-text">${r.text || ''}</div>
      <div class="options">
        ${(r.options || []).map((opt, i) => `
          <div class="option ${i === r.correct ? 'correct' : ''}">${opt}</div>
        `).join('')}
      </div>
      <div style="background:#F4F0FF; padding:20px; border-radius:16px; margin:24px 0; white-space:pre-line; line-height:1.8;">${r.solution || ''}</div>
      <button class="btn btn-primary" style="width:100%;" onclick="goNext()">السؤال التالي</button>
    `;
  } else if (s.state === 'leaderboard') {
    const sorted = [...s.teams].sort((a,b) => b.score - a.score || a.totalTime - b.totalTime);
    content = `
      <h2>الترتيب</h2>
      <div class="leaderboard">
        ${sorted.map((t, i) => `
          <div class="rank-item ${i===0?'first':''}">
            <span class="rank">${i+1}</span>
            <span class="symbol">${t.symbol}</span>
            <span>${t.name}</span>
            <span class="score">${t.score} نقطة</span>
            ${i===0 ? '<span style="color:#F4C542;">🏆</span>' : ''}
          </div>
        `).join('')}
      </div>
      <button class="btn btn-primary" style="width:100%; margin-top:24px;" onclick="goNext()">
        ${s.currentQuestion >= 4 ? 'النتيجة النهائية' : 'السؤال التالي'}
      </button>
    `;
  } else if (s.state === 'finished') {
    const sorted = [...s.teams].sort((a,b) => b.score - a.score || a.totalTime - b.totalTime);
    const winner = sorted[0];
    const totalCorrect = s.teams.reduce((sum, t) => sum + (t.correctCount || 0), 0);
    const totalPossible = s.teams.length * 5;
    const accuracy = totalPossible ? Math.round((totalCorrect / totalPossible) * 100) : 0;
    content = `
      <h2 style="text-align:center;">انتهى التحدي</h2>
      <h2 style="text-align:center; color:#F4C542;">بطلات حل المسائل</h2>
      <div class="final-winner">
        <div style="font-size:48px;">${winner?.symbol || ''}</div>
        <div class="name">${winner?.name || '—'}</div>
        <div class="score">${winner?.score || 0} نقطة</div>
      </div>
      <h3>الترتيب النهائي</h3>
      <div class="leaderboard">
        ${sorted.map((t, i) => `
          <div class="rank-item ${i===0?'first':''}">
            <span class="rank">${i+1}</span>
            <span class="symbol">${t.symbol}</span>
            <span>${t.name}</span>
            <span class="score">${t.score} نقطة</span>
          </div>
        `).join('')}
      </div>
      <div style="margin-top:32px; text-align:center; background:#F4F0FF; padding:20px; border-radius:16px;">
        <h3>نتيجة الفصل</h3>
        <div style="font-size:24px; margin:8px 0;">${totalCorrect} / ${totalPossible} إجابة صحيحة</div>
        <div style="font-size:20px;">دقة الفصل: ${accuracy}٪</div>
      </div>
    `;
    createConfetti();
  }

  app.innerHTML = `
    <div class="screen">
      <div class="screen-inner">
        <button class="back-btn" onclick="renderHome()">← العودة للرئيسية</button>
        ${content}
      </div>
    </div>
  `;
}

function startChallenge() {
  send({ type: 'start_challenge' });
  playStart();
  stopLobbyAudio();
}

function goNext() {
  send({ type: 'next_question' });
}

function renderTeam() {
  if (!currentSession) return;
  const s = currentSession;
  let content = '';

  if (s.state === 'waiting') {
    content = `
      <h2 style="text-align:center;">في انتظار بدء التحدي</h2>
      <div style="text-align:center; font-size:22px; margin:24px 0;">${s.code}</div>
      <div class="teams-list">
        ${s.teams.map(t => `
          <div class="team-item ${t.id === teamId ? 'connected' : ''}">
            <span class="symbol">${t.symbol}</span>
            <span>${t.name}</span>
            ${t.id === teamId ? '<span>✓ أنتِ</span>' : ''}
          </div>
        `).join('')}
      </div>
    `;
  } else if (s.state === 'question_active' && s.question) {
    const q = s.question;
    content = `
      <div class="question-header">
        <div>السؤال ${q.index} من ${q.total}</div>
        <div class="timer" id="timer">٢٠</div>
      </div>
      <div class="progress-bar"><div class="progress-fill" id="progress"></div></div>
      <div class="category">${q.category}</div>
      <div class="question-text">${q.text}</div>
      <div class="options" id="options">
        ${q.options.map((opt, i) => `
          <div class="option" data-index="${i}" onclick="selectOption(this, ${i})">${opt}</div>
        `).join('')}
      </div>
      <div id="answer-status" style="text-align:center; margin-top:16px; font-weight:700; color:#4C3A78;"></div>
    `;
    startTimer(s.questionStartTime);
  } else if (s.state === 'question_reveal') {
    const r = s.reveal || {};
    content = `
      <h2>كشف الحل</h2>
      <div class="category">${r.category || ''}</div>
      <div class="question-text">${r.text || ''}</div>
      <div class="options">
        ${(r.options || []).map((opt, i) => `
          <div class="option ${i === r.correct ? 'correct' : ''}">${opt}</div>
        `).join('')}
      </div>
      <div style="background:#F4F0FF; padding:20px; border-radius:16px; margin:24px 0; white-space:pre-line;">${r.solution || ''}</div>
    `;
  } else if (s.state === 'leaderboard' || s.state === 'finished') {
    const sorted = [...s.teams].sort((a,b) => b.score - a.score || a.totalTime - b.totalTime);
    content = `
      <h2>${s.state === 'finished' ? 'النتيجة النهائية' : 'الترتيب'}</h2>
      <div class="leaderboard">
        ${sorted.map((t, i) => `
          <div class="rank-item ${i===0?'first':''} ${t.id===teamId?'connected':''}">
            <span class="rank">${i+1}</span>
            <span class="symbol">${t.symbol}</span>
            <span>${t.name}</span>
            <span class="score">${t.score} نقطة</span>
          </div>
        `).join('')}
      </div>
      ${s.state === 'finished' ? '<div style="text-align:center; margin-top:24px; font-size:20px;">أحسنتِ!</div>' : ''}
    `;
    if (s.state === 'finished') createConfetti();
  }

  app.innerHTML = `
    <div class="screen">
      <div class="screen-inner">
        ${content}
      </div>
    </div>
  `;
}

function selectOption(el, index) {
  if (el.parentElement.classList.contains('locked')) return;
  document.querySelectorAll('.option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  el.parentElement.classList.add('locked');
  document.getElementById('answer-status').textContent = 'تم اعتماد الإجابة';
  send({ type: 'answer', option: index });
}

function startTimer(startTime) {
  clearInterval(timerInterval);
  const update = () => {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, 20 - Math.floor(elapsed / 1000));
    const timerEl = document.getElementById('timer');
    const progressEl = document.getElementById('progress');
    if (timerEl) {
      timerEl.textContent = remaining;
      timerEl.classList.toggle('pulse', remaining <= 5 && remaining > 0);
    }
    if (progressEl) {
      progressEl.style.width = `${(elapsed / 20000) * 100}%`;
    }
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

// Init
connectWS();
renderHome();

// Restore host session if any
const hostSaved = sessionStorage.getItem('hostSession');
if (hostSaved) {
  setTimeout(() => {
    currentView = 'host';
    send({ type: 'join_as_host', sessionId: hostSaved });
  }, 400);
}
