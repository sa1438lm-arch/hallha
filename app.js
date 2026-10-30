// حلّها — تحدي حل المسائل (نسخة مبسطة: جلسة واحدة)
const app = document.getElementById('app');
let ws = null;
let role = null;
let currentSession = null;
let teamId = null;
let reconnectToken = null;
let soundEnabled = localStorage.getItem('soundEnabled') !== 'false';
let lobbyAudio = null;
let winnerSoundPlayed = false;
let timerInterval = null;
let currentView = 'home';
let maxGroups = 5;

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
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function handleMessage(msg) {
  if (msg.type === 'error') { showError(msg.message); return; }
  if (msg.type === 'joined') {
    role = msg.role;
    if (msg.role === 'team') {
      teamId = msg.teamId;
      reconnectToken = msg.reconnectToken || reconnectToken;
      localStorage.setItem('teamReconnect', JSON.stringify({
        sessionId: msg.session?.id,
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

function startLobbyAudio() {
  if (!isHost() || !soundEnabled || lobbyAudio) return;
  lobbyAudio = new Audio('/audio/lobby.mp3');
  lobbyAudio.loop = true;
  lobbyAudio.volume = 0.18;
  lobbyAudio.play().catch(() => {});
}
function stopLobbyAudio() {
  if (lobbyAudio) { lobbyAudio.pause(); lobbyAudio = null; }
}
function playStart() {
  if (!isHost() || !soundEnabled) return;
  new Audio('/audio/start.mp3').play().catch(() => {});
}
function playWinner() {
  if (!isHost() || !soundEnabled) return;
  new Audio('/audio/winner.mp3').play().catch(() => {});
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
  currentView = 'home';
  role = null;
  currentSession = null;
  stopLobbyAudio();
  app.innerHTML = `
    <div class="digital-space">
      <div class="grid-floor"></div>
      <div class="glow glow-blue"></div>
      <div class="glow glow-purple"></div>
      <div class="glow glow-orange"></div>
      <div class="particles">
        <span style="--i:1;--x:12vw;--y:18vh;--s:1.4;">∫ f(x)dx</span>
        <span style="--i:2;--x:78vw;--y:14vh;--s:1.2;">E=mc²</span>
        <span style="--i:3;--x:48vw;--y:48vh;--s:1.8;">π ≈ 3.14</span>
        <span style="--i:4;--x:22vw;--y:72vh;--s:1.1;">∑ n=1∞</span>
        <span style="--i:5;--x:72vw;--y:78vh;--s:1.6;">√(x²+y²)</span>
        <span style="--i:6;--x:38vw;--y:12vh;--s:1.3;">dx/dt</span>
      </div>
    </div>
    <div class="container">
      <div class="home-header">
        <h1>حلّها</h1>
        <div class="subtitle">تحدي حل المسائل</div>
        <div class="lesson">اسم الدرس: خطة حل المسألة</div>
        <div class="meta">٥ أسئلة • ٢٠ ثانية لكل سؤال</div>
      </div>
      <div class="cards">
        <div class="card" onclick="startAsTeacher()">
          <div class="card-icon">▶</div>
          <h3>ابدأ كمعلم</h3>
          <p>أنشئي الجلسة وابدئي التحدي مع الطالبات</p>
        </div>
        <div class="card" onclick="showJoin()">
          <div class="card-icon">✦</div>
          <h3>ابدأ كمجموعة</h3>
          <p>انضمي إلى الجلسة باستخدام رمز الدخول</p>
        </div>
      </div>
    </div>
  `;
}

function startAsTeacher() {
  currentView = 'host-setup';
  app.innerHTML = `
    <div class="screen">
      <div class="screen-inner" style="max-width:480px; text-align:center;">
        <button class="back-btn" onclick="renderHome()">← العودة</button>
        <h2>إعداد الجلسة</h2>
        <p style="margin:16px 0 24px; color:#6B6580;">حددي عدد المجموعات المشاركة</p>
        <div class="counter" style="justify-content:center; margin:20px 0;">
          <button onclick="changeMax(-1)">−</button>
          <span id="max-groups">${maxGroups}</span>
          <button onclick="changeMax(1)">+</button>
        </div>
        <p style="color:#999; font-size:14px;">من ٢ إلى ٥ مجموعات</p>
        <button class="btn btn-gold" style="width:100%; margin-top:32px;" onclick="createAndOpen()">إنشاء الجلسة</button>
      </div>
    </div>
  `;
}

function changeMax(d) {
  maxGroups = Math.max(2, Math.min(5, maxGroups + d));
  const el = document.getElementById('max-groups');
  if (el) el.textContent = maxGroups;
}

function createAndOpen() {
  connectWS();
  setTimeout(() => {
    send({ type: 'create_single_session', maxGroups });
  }, 300);
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
  document.getElementById('name-section').style.display = 'block';
  window._pendingCode = code;
}

function joinTeam() {
  const name = document.getElementById('team-name').value.trim();
  if (!name) return showError('يرجى إدخال اسم المجموعة');
  connectWS();
  setTimeout(() => send({ type: 'join_as_team', code: window._pendingCode, name }), 200);
}

function stateText(state) {
  return { waiting: 'بانتظار المجموعات', question_active: 'السؤال جارٍ', question_reveal: 'عرض الحل', leaderboard: 'عرض الترتيب', finished: 'انتهت الجلسة' }[state] || state;
}

function renderHost() {
  if (!currentSession) return;
  const s = currentSession;
  let content = '';

  if (s.state === 'waiting') {
    content = `
      <h2 style="text-align:center;">كود الجلسة</h2>
      <div class="lobby-code">${s.code}</div>
      <div style="text-align:center; font-size:18px; margin-bottom:24px;">${s.teamCount} / ${s.maxGroups || 5} مجموعات</div>
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
    const q = s.question || {};
    const qText = q.text || 'السؤال قيد التحميل... يرجى الانتظار';
    const qCat = q.category || '🕌';
    content = `
      <div class="question-header">
        <div>السؤال ${q.index || (s.currentQuestion + 1)} من ٥</div>
        <div class="timer" id="timer">٢٠</div>
      </div>
      <div class="progress-bar"><div class="progress-fill" id="progress"></div></div>
      <div class="category">${qCat}</div>
      <div class="question-text">${qText}</div>
      <div class="options">
        ${(q.options || []).map(opt => `<div class="option">${opt}</div>`).join('')}
      </div>
      <div class="teams-list" style="margin-top:24px;">
        ${s.teams.map(t => `
          <div class="team-item">
            <span class="symbol">${t.symbol}</span>
            <span>${t.name}</span>
            <span>${t.answered ? '✓ أجابت' : 'بانتظار الإجابة'}</span>
          </div>
        `).join('')}
      </div>
    `;
    startTimer(s.questionStartTime);
  } else if (s.state === 'question_reveal') {
    const r = s.reveal || {};
    content = `
      <h2>كشف الحل</h2>
      <div class="category">${r.category || ''}</div>
      <div class="question-text">${r.text || ''}</div>
      <div class="options">
        ${(r.options || []).map((opt, i) => `<div class="option ${i === r.correct ? 'correct' : ''}">${opt}</div>`).join('')}
      </div>
      <div class="solution">${r.solution || ''}</div>
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
      <div class="class-result">
        <h3>نتيجة الفصل</h3>
        <div>${totalCorrect} / ${totalPossible} إجابة صحيحة</div>
        <div>دقة الفصل: ${accuracy}٪</div>
      </div>
    `;
    createConfetti();
  }

  app.innerHTML = `<div class="screen"><div class="screen-inner"><button class="back-btn" onclick="renderHome()">← الرئيسية</button>${content}</div></div>`;
}

function startChallenge() {
  send({ type: 'start_challenge' });
  playStart();
  stopLobbyAudio();
}
function goNext() { send({ type: 'next_question' }); }

function renderTeam() {
  if (!currentSession) return;
  const s = currentSession;
  let content = '';
  if (s.state === 'waiting') {
    content = `
      <h2 style="text-align:center;">في انتظار بدء التحدي</h2>
      <div class="lobby-code" style="font-size:48px;">${s.code}</div>
      <div class="teams-list">
        ${s.teams.map(t => `<div class="team-item ${t.id === teamId ? 'connected' : ''}"><span class="symbol">${t.symbol}</span><span>${t.name}</span>${t.id === teamId ? '<span>✓ أنتِ</span>' : ''}</div>`).join('')}
      </div>
    `;
  } else if (s.state === 'question_active' && s.question) {
    const q = s.question;
    content = `
      <div class="question-header"><div>السؤال ${q.index} من ${q.total}</div><div class="timer" id="timer">٢٠</div></div>
      <div class="progress-bar"><div class="progress-fill" id="progress"></div></div>
      <div class="category">${q.category}</div>
      <div class="question-text">${q.text}</div>
      <div class="options" id="options">
        ${q.options.map((opt, i) => `<div class="option" data-index="${i}" onclick="selectOption(this, ${i})">${opt}</div>`).join('')}
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
      <div class="options">${(r.options || []).map((opt, i) => `<div class="option ${i === r.correct ? 'correct' : ''}">${opt}</div>`).join('')}</div>
      <div class="solution">${r.solution || ''}</div>
    `;
  } else if (s.state === 'leaderboard' || s.state === 'finished') {
    const sorted = [...s.teams].sort((a,b) => b.score - a.score || a.totalTime - b.totalTime);
    content = `
      <h2>${s.state === 'finished' ? 'النتيجة النهائية' : 'الترتيب'}</h2>
      <div class="leaderboard">
        ${sorted.map((t, i) => `<div class="rank-item ${i===0?'first':''} ${t.id===teamId?'connected':''}"><span class="rank">${i+1}</span><span class="symbol">${t.symbol}</span><span>${t.name}</span><span class="score">${t.score} نقطة</span></div>`).join('')}
      </div>
      ${s.state === 'finished' ? '<div style="text-align:center; margin-top:24px; font-size:20px;">أحسنتِ!</div>' : ''}
    `;
    if (s.state === 'finished') createConfetti();
  }
  app.innerHTML = `<div class="screen"><div class="screen-inner">${content}</div></div>`;
}

function selectOption(el, index) {
  if (el.parentElement.classList.contains('locked')) return;
  document.querySelectorAll('.option').forEach(o => {
    o.classList.remove('selected');
    o.style.pointerEvents = 'none';
  });
  el.classList.add('selected');
  el.parentElement.classList.add('locked');
  const status = document.getElementById('answer-status');
  if (status) status.textContent = '✓ تم اعتماد إجابتك ولا يمكن تغييرها';
  send({ type: 'answer', option: index });
}

function startTimer(startTime) {
  clearInterval(timerInterval);
  if (!startTime) startTime = Date.now();
  const update = () => {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, 20 - Math.floor(elapsed / 1000));
    const timerEl = document.getElementById('timer');
    const progressEl = document.getElementById('progress');
    if (timerEl) {
      timerEl.textContent = remaining;
      timerEl.classList.toggle('pulse', remaining <= 5 && remaining > 0);
    }
    if (progressEl) progressEl.style.width = `${(elapsed / 20000) * 100}%`;
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

connectWS();
renderHome();

const hostSaved = sessionStorage.getItem('hostSession');
if (hostSaved) {
  setTimeout(() => {
    currentView = 'host';
    send({ type: 'join_as_host', sessionId: hostSaved });
  }, 400);
}
