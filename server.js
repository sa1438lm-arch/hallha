const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// In-memory store
const sessions = new Map(); // sessionId -> session
const codeToSession = new Map(); // joinCode -> sessionId

const QUESTIONS = [
  {
    id: 1,
    category: '🕌 الدين',
    text: 'تقرأ سارة ٤ صفحات من القرآن الكريم بعد كل صلاة، فإذا قرأت بعد ٥ صلوات، فكم صفحة قرأت في اليوم؟',
    options: ['٩ صفحات', '١٥ صفحة', '٢٠ صفحة', '٢٥ صفحة'],
    correct: 2, // 0-indexed
    solution: '٤ صفحات بعد كل صلاة × ٥ صلوات\n٤ × ٥ = ٢٠\n٢٠ صفحة'
  },
  {
    id: 2,
    category: '🔬 العلوم',
    text: 'زرعت طالبات الصف ٦ صفوف من النباتات، وفي كل صف ٨ نباتات. كم نباتًا زرعن؟',
    options: ['١٤ نباتًا', '٤٢ نباتًا', '٤٨ نباتًا', '٥٤ نباتًا'],
    correct: 2,
    solution: '٦ صفوف × ٨ نباتات\n٦ × ٨ = ٤٨\n٤٨ نباتًا'
  },
  {
    id: 3,
    category: '🛒 الحياة اليومية',
    text: 'كان مع نورة ٥٠ ريالًا، واشترت أدوات مدرسية بمبلغ ٣٢ ريالًا. كم ريالًا بقي معها؟',
    options: ['١٨ ريالًا', '٢٢ ريالًا', '٢٨ ريالًا', '٨٢ ريالًا'],
    correct: 0,
    solution: 'نطرح ثمن الأدوات من المبلغ\n٥٠ − ٣٢ = ١٨\n١٨ ريالًا'
  },
  {
    id: 4,
    category: '👩🏻‍⚕️ المهن',
    text: 'تفحص طبيبة الأسنان ٦ مرضى يوميًا، فكم مريضًا تفحص خلال ٥ أيام؟',
    options: ['١١ مريضًا', '٢٥ مريضًا', '٣٠ مريضًا', '٣٥ مريضًا'],
    correct: 2,
    solution: '٦ مرضى × ٥ أيام\n٦ × ٥ = ٣٠\n٣٠ مريضًا'
  },
  {
    id: 5,
    category: '🏫 الحياة المدرسية',
    text: 'لدى المعلمة ٣٦ قلمًا، وزعتها بالتساوي على ٤ مجموعات من الطالبات. كم قلمًا تحصل عليه كل مجموعة؟',
    options: ['٦ أقلام', '٨ أقلام', '٩ أقلام', '١٢ قلمًا'],
    correct: 2,
    solution: '٣٦ قلمًا ÷ ٤ مجموعات\n٣٦ ÷ ٤ = ٩\n٩ أقلام'
  }
];

const SYMBOLS = ['◆', '✦', '⬡', '◈', '✧'];
const SUGGESTED_NAMES = ['المتألقات', 'العبقريات', 'المبدعات', 'الذكيات', 'المتميزات'];

function generateSessionId() {
  return 's_' + Math.random().toString(36).slice(2, 10);
}

function generateJoinCode() {
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (codeToSession.has(code));
  return code;
}

function generateTeamId() {
  return 't_' + Math.random().toString(36).slice(2, 10);
}

function generateReconnectToken() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function createSession(maxGroups = 5) {
  const id = generateSessionId();
  const code = generateJoinCode();
  const session = {
    maxGroups: Math.min(5, Math.max(2, maxGroups)),
    id,
    code,
    state: 'waiting',
    teams: [],
    currentQuestion: 0,
    questionStartTime: null,
    answers: new Map(), // teamId -> {option, time, score, correct}
    hostSockets: new Set(),
    teamSockets: new Map(), // teamId -> ws
    createdAt: Date.now(),
    finishedAt: null,
    winnerSoundPlayed: false
  };
  sessions.set(id, session);
  codeToSession.set(code, id);
  return session;
}

function getPublicSession(session, forTeam = false) {
  const base = {
    id: session.id,
    code: session.code,
    state: session.state,
    currentQuestion: session.currentQuestion,
    teamCount: session.teams.length,
    maxGroups: session.maxGroups || 5,
    teams: session.teams.map(t => ({
      id: t.id,
      name: t.name,
      symbol: t.symbol,
      score: t.score,
      totalTime: t.totalTime,
      correctCount: t.correctCount,
      connected: session.teamSockets.has(t.id),
      answered: session.answers.has(t.id)
    }))
  };
  base.questionStartTime = session.questionStartTime;
  if (session.state === 'question_active') {
    const q = QUESTIONS[session.currentQuestion];
    base.question = {
      index: session.currentQuestion + 1,
      total: QUESTIONS.length,
      category: q.category,
      text: q.text,
      options: q.options,
      timeLimit: 20
    };
  }
  if (session.state === 'question_reveal' || session.state === 'leaderboard' || session.state === 'finished') {
    const q = QUESTIONS[session.currentQuestion];
    base.reveal = {
      category: q.category,
      text: q.text,
      options: q.options,
      correct: q.correct,
      solution: q.solution,
      answers: Array.from(session.answers.entries()).map(([teamId, a]) => {
        const team = session.teams.find(t => t.id === teamId);
        return {
          teamId,
          name: team?.name,
          symbol: team?.symbol,
          option: a.option,
          correct: a.correct,
          score: a.score,
          time: a.time
        };
      })
    };
  }
  return base;
}

function broadcast(session, data, excludeWs = null) {
  const baseMsg = JSON.stringify(data);
  // Hosts get full public (no question options during active for privacy? Wait, hosts don't need options)
  for (const ws of session.hostSockets) {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(baseMsg);
    }
  }
  // Teams get version with question if active
  const teamData = { ...data };
  if (data.session && session.state === 'question_active') {
    teamData.session = getPublicSession(session, true);
  }
  const teamMsg = JSON.stringify(teamData);
  for (const [teamId, ws] of session.teamSockets) {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(teamMsg);
    }
  }
}

function sendTo(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function closeQuestion(session) {
  if (session.state !== 'question_active') return;
  session.state = 'question_reveal';
  // Calculate scores for unanswered (0)
  for (const team of session.teams) {
    if (!session.answers.has(team.id)) {
      session.answers.set(team.id, { option: null, time: 20000, score: 0, correct: false });
    }
  }
  broadcast(session, { type: 'state', session: getPublicSession(session) });
}

function nextQuestion(session) {
  session.answers.clear();
  session.currentQuestion++;
  if (session.currentQuestion >= QUESTIONS.length) {
    session.state = 'finished';
    session.finishedAt = Date.now();
    // Compute final ranking
    session.teams.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.totalTime - b.totalTime;
    });
    broadcast(session, { type: 'state', session: getPublicSession(session) });
    return;
  }
  session.state = 'question_active';
  session.questionStartTime = Date.now();
  broadcast(session, { type: 'state', session: getPublicSession(session) });
  // Auto close after 20s
  setTimeout(() => closeQuestion(session), 20000);
}

function handleAnswer(session, teamId, optionIndex) {
  if (session.state !== 'question_active') return;
  if (session.answers.has(teamId)) return; // already answered
  const team = session.teams.find(t => t.id === teamId);
  if (!team) return;

  const elapsed = Date.now() - session.questionStartTime;
  const timeRemaining = Math.max(0, 20000 - elapsed);
  const q = QUESTIONS[session.currentQuestion];
  const correct = optionIndex === q.correct;
  const score = correct ? Math.round(500 + 500 * timeRemaining / 20000) : 0;

  session.answers.set(teamId, { option: optionIndex, time: elapsed, score, correct });
  team.score += score;
  team.totalTime += elapsed;
  if (correct) team.correctCount++;

  // Notify hosts of answered status
  broadcast(session, { type: 'answered', teamId, answered: true });

  // If all answered, close early
  if (session.answers.size === session.teams.length) {
    closeQuestion(session);
  }
}

// Static files
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

wss.on('connection', (ws) => {
  ws.sessionId = null;
  ws.role = null; // 'host' | 'team'
  ws.teamId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'create_single_session') {
      const maxG = Math.min(5, Math.max(2, parseInt(msg.maxGroups) || 5));
      const s = createSession(maxG);
      ws.sessionId = s.id;
      ws.role = 'host';
      s.hostSockets.add(ws);
      sendTo(ws, { type: 'joined', role: 'host', session: getPublicSession(s) });
      return;
    }

    if (msg.type === 'list_sessions') {
      const list = Array.from(sessions.values()).map(s => ({
        id: s.id,
        code: s.code,
        state: s.state,
        teamCount: s.teams.length,
        currentQuestion: s.currentQuestion,
        createdAt: s.createdAt
      }));
      sendTo(ws, { type: 'sessions_list', sessions: list });
      return;
    }

    if (msg.type === 'join_as_host') {
      const session = sessions.get(msg.sessionId);
      if (!session) return sendTo(ws, { type: 'error', message: 'الجلسة غير موجودة' });
      ws.sessionId = session.id;
      ws.role = 'host';
      session.hostSockets.add(ws);
      sendTo(ws, { type: 'joined', role: 'host', session: getPublicSession(session) });
      broadcast(session, { type: 'state', session: getPublicSession(session) }, ws);
      return;
    }

    if (msg.type === 'join_as_team') {
      const sessionId = codeToSession.get(msg.code);
      const session = sessions.get(sessionId);
      if (!session) return sendTo(ws, { type: 'error', message: 'رمز الجلسة غير صحيح' });
      if (session.state !== 'waiting') return sendTo(ws, { type: 'error', message: 'بدأ التحدي بالفعل' });
      if (session.teams.length >= (session.maxGroups || 5)) return sendTo(ws, { type: 'error', message: 'اكتمل عدد المجموعات في هذه الجلسة' });

      const name = (msg.name || '').trim().slice(0, 30) || 'مجموعة';
      if (session.teams.some(t => t.name === name)) return sendTo(ws, { type: 'error', message: 'اسم المجموعة مستخدم بالفعل' });

      const teamId = generateTeamId();
      const token = generateReconnectToken();
      const symbol = SYMBOLS[session.teams.length % SYMBOLS.length];
      const team = {
        id: teamId,
        name,
        symbol,
        score: 0,
        totalTime: 0,
        correctCount: 0,
        reconnectToken: token
      };
      session.teams.push(team);
      ws.sessionId = session.id;
      ws.role = 'team';
      ws.teamId = teamId;
      session.teamSockets.set(teamId, ws);

      sendTo(ws, {
        type: 'joined',
        role: 'team',
        teamId,
        reconnectToken: token,
        session: getPublicSession(session, true)
      });
      broadcast(session, { type: 'state', session: getPublicSession(session) });
      return;
    }

    if (msg.type === 'reconnect_team') {
      const session = sessions.get(msg.sessionId);
      if (!session) return sendTo(ws, { type: 'error', message: 'تعذر استعادة المجموعة' });
      const team = session.teams.find(t => t.id === msg.teamId && t.reconnectToken === msg.token);
      if (!team) return sendTo(ws, { type: 'error', message: 'تعذر استعادة المجموعة' });

      // Close old socket if any
      const old = session.teamSockets.get(team.id);
      if (old && old !== ws) try { old.close(); } catch {}
      session.teamSockets.set(team.id, ws);
      ws.sessionId = session.id;
      ws.role = 'team';
      ws.teamId = team.id;

      sendTo(ws, { type: 'joined', role: 'team', teamId: team.id, session: getPublicSession(session, true) });
      broadcast(session, { type: 'state', session: getPublicSession(session) });
      return;
    }

    if (msg.type === 'start_challenge' && ws.role === 'host') {
      const session = sessions.get(ws.sessionId);
      if (!session || session.state !== 'waiting') return;
      if (session.teams.length < 2) return sendTo(ws, { type: 'error', message: 'يحتاج التحدي مجموعتين على الأقل' });
      session.state = 'question_active';
      session.currentQuestion = 0;
      session.questionStartTime = Date.now();
      session.answers.clear();
      broadcast(session, { type: 'state', session: getPublicSession(session) });
      setTimeout(() => closeQuestion(session), 20000);
      return;
    }

    if (msg.type === 'answer' && ws.role === 'team') {
      const session = sessions.get(ws.sessionId);
      if (!session) return;
      handleAnswer(session, ws.teamId, msg.option);
      return;
    }

    if (msg.type === 'next_question' && ws.role === 'host') {
      const session = sessions.get(ws.sessionId);
      if (!session) return;
      if (session.state === 'question_reveal') {
        session.state = 'leaderboard';
        broadcast(session, { type: 'state', session: getPublicSession(session) });
      } else if (session.state === 'leaderboard') {
        nextQuestion(session);
      } else if (session.state === 'finished') {
        // already finished
      }
      return;
    }

    if (msg.type === 'end_session' && ws.role === 'host') {
      const session = sessions.get(ws.sessionId);
      if (session) {
        session.state = 'finished';
        session.finishedAt = Date.now();
        broadcast(session, { type: 'state', session: getPublicSession(session) });
      }
      return;
    }

    if (msg.type === 'delete_session') {
      const session = sessions.get(msg.sessionId);
      if (session && (session.state === 'finished' || Date.now() - session.createdAt > 1000 * 60 * 60 * 4)) {
        codeToSession.delete(session.code);
        sessions.delete(session.id);
        // Close sockets
        for (const h of session.hostSockets) try { h.close(); } catch {}
        for (const t of session.teamSockets.values()) try { t.close(); } catch {}
      }
      return;
    }
  });

  ws.on('close', () => {
    if (!ws.sessionId) return;
    const session = sessions.get(ws.sessionId);
    if (!session) return;
    if (ws.role === 'host') {
      session.hostSockets.delete(ws);
    } else if (ws.role === 'team' && ws.teamId) {
      session.teamSockets.delete(ws.teamId);
      broadcast(session, { type: 'state', session: getPublicSession(session) });
    }
  });
});

// Cleanup old finished sessions every 30 min
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.state === 'finished' && now - (s.finishedAt || s.createdAt) > 1000 * 60 * 30) {
      codeToSession.delete(s.code);
      sessions.delete(id);
    }
  }
}, 1000 * 60 * 30);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`حلّها يعمل على http://localhost:${PORT}`);
  console.log(`للدخول من أجهزة الفصل: http://<IP-الجهاز>:${PORT}`);
});
