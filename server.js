const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require("socket.io");
const admin = require('firebase-admin');

// --- FIREBASE ADMIN INIT (robust) ---
function initFirebase() {
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  try {
    if (credsPath) {
      const serviceAccount = require(path.resolve(credsPath));
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      console.log('✅ Firebase initialized from GOOGLE_APPLICATION_CREDENTIALS');
      return;
    }
  } catch (e) {
    console.error('Không thể load key từ GOOGLE_APPLICATION_CREDENTIALS:', e.message);
  }
  const candidates = ['./serviceAccountKey.json', './serviceAccountKey.json.json'];
  for (const file of candidates) {
    try {
      const serviceAccount = require(path.resolve(__dirname, file));
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      console.log(`✅ Firebase initialized from ${file}`);
      return;
    } catch (e) {}
  }
  console.error("LỖI: Không tìm thấy file serviceAccountKey. Đặt file trong thư mục dự án hoặc set biến môi trường GOOGLE_APPLICATION_CREDENTIALS.");
  process.exit(1);
}
initFirebase();
const db = admin.firestore();

const app = express();
app.use(express.static(__dirname));
app.use(express.json());

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// === QUIZ API ===
// Các API endpoint (GET, POST, DELETE, PUT) giữ nguyên, không cần thay đổi.
// Chúng tự động xử lý trường "imageUrl" mới nhờ tính linh hoạt của Firestore.
app.get('/api/quizzes', async (req, res) => {
  try {
    const snapshot = await db.collection('quizzes').orderBy('created_at', 'desc').get();
    const quizzes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(quizzes);
  } catch (err) { console.error("API Error - GET /api/quizzes:", err); res.status(500).json({ error: err.message }); }
});
app.post('/api/quizzes', async (req, res) => {
  try {
    const newQuiz = req.body;
    const quizWithTs = { ...newQuiz, created_at: admin.firestore.FieldValue.serverTimestamp() };
    const docRef = await db.collection('quizzes').add(quizWithTs);
    res.status(201).json({ id: docRef.id });
  } catch (err) { console.error("API Error - POST /api/quizzes:", err); res.status(500).json({ error: err.message }); }
});
app.delete('/api/quizzes/:quizId', async (req, res) => {
  try {
    const { quizId } = req.params;
    await db.collection('quizzes').doc(quizId).delete();
    res.status(200).json({ success: true });
  } catch (err) { console.error(`API Error - DELETE /api/quizzes/${req.params.quizId}:`, err); res.status(500).json({ error: err.message }); }
});
app.get('/api/quizzes/:quizId', async (req, res) => {
  try {
    const { quizId } = req.params;
    const doc = await db.collection('quizzes').doc(quizId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Không tìm thấy quiz' });
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) { console.error(`API Error - GET /api/quizzes/${req.params.quizId}:`, err); res.status(500).json({ error: err.message }); }
});
app.put('/api/quizzes/:quizId', async (req, res) => {
  try {
    const { quizId } = req.params;
    const updatedQuiz = req.body;
    await db.collection('quizzes').doc(quizId).set(updatedQuiz, { merge: true });
    res.status(200).json({ success: true });
  } catch (err) { console.error(`API Error - PUT /api/quizzes/${req.params.quizId}:`, err); res.status(500).json({ error: err.message }); }
});

// === SOCKET.IO LOGIC ===
const gameRooms = {};

function showAnswerStats(gamePin) {
  const room = gameRooms[gamePin];
  if (!room) return;

  const totalAnswered = room.players.filter(p => p.lastAnswer).length;
  // Sửa lỗi nhỏ: Nếu không ai trả lời, vẫn hiện leaderboard sau một lúc
  if (totalAnswered === 0) {
    setTimeout(() => {
        // Luôn sắp xếp lại player theo điểm trước khi hiện leaderboard
        room.players.sort((a, b) => b.score - a.score);
        io.to(gamePin).emit('show_leaderboard', { players: room.players });
    }, 3000);
    return;
  }
  
  const stats = {};
  const currentQuestion = room.questions[room.currentQuestionIndex];
  currentQuestion.options.forEach(option => { stats[option] = 0; });
  room.players.forEach(player => { if (player.lastAnswer) stats[player.lastAnswer]++; });
  const statsPercentage = {};
  for (const option in stats) { statsPercentage[option] = Math.round((stats[option] / totalAnswered) * 100); }

  io.to(gamePin).emit('show_answer_stats', {
    correctAnswer: currentQuestion.correctAnswer,
    stats: statsPercentage
  });

  setTimeout(() => {
    room.players.sort((a, b) => b.score - a.score);
    io.to(gamePin).emit('show_leaderboard', { players: room.players });
  }, 4000);
}

// UPDATE: Hợp nhất và dọn dẹp hàm sendQuestion
function sendQuestion(gamePin) {
    const room = gameRooms[gamePin];
    if (!room) return;

    const question = room.questions[room.currentQuestionIndex];
    if (!question) {
        // Sắp xếp người chơi lần cuối trước khi kết thúc
        room.players.sort((a, b) => b.score - a.score);
        io.to(gamePin).emit('game_over', { players: room.players });
        delete gameRooms[gamePin];
        console.log(`[SERVER] Đã xóa phòng ${gamePin} sau khi kết thúc.`);
        return;
    }

    // Gửi dữ liệu câu hỏi, bao gồm cả imageUrl (nếu có)
    io.to(gamePin).emit('new_question', {
      questionText: question.questionText,
      options: question.options,
      timeLimit: question.timeLimit,
      imageUrl: question.imageUrl // Gửi kèm URL hình ảnh
    });

    room.questionStartTime = Date.now();
    clearTimeout(room.timer);
    room.timer = setTimeout(() => { showAnswerStats(gamePin); }, question.timeLimit * 1000);
}


io.on('connection', (socket) => {
  socket.on('host_create_room', async ({ quizId }) => {
    try {
      const quizDoc = await db.collection('quizzes').doc(quizId).get();
      if (!quizDoc.exists) {
          socket.emit('host_error', 'Không tìm thấy bộ câu hỏi này.');
          return;
      }
      const questions = quizDoc.data().questions;
      const gamePin = Math.floor(100000 + Math.random() * 900000).toString();
      socket.join(gamePin);
      gameRooms[gamePin] = {
        hostId: socket.id, players: [], questions,
        currentQuestionIndex: -1,
        questionStartTime: 0, timer: null
      };
      socket.emit('room_created', { gamePin });
    } catch (err) { console.error("Lỗi tạo phòng:", err); socket.emit('host_error', 'Lỗi server khi tạo phòng.');}
  });

  socket.on('player_join_room', ({ gamePin, nickname }) => {
    const room = gameRooms[gamePin];
    if (!room) return socket.emit('join_error', { message: 'Mã PIN không đúng!' });
    if (room.currentQuestionIndex > -1) return socket.emit('join_error', { message: 'Trò chơi đã bắt đầu!' });
    if (room.players.find(p => p.nickname.toLowerCase() === nickname.toLowerCase())) return socket.emit('join_error', {message: 'Biệt danh đã được sử dụng!'});
    
    socket.join(gamePin);
    const newPlayer = { id: socket.id, nickname, score: 0, lastAnswer: null, streak: 0 };
    room.players.push(newPlayer);
    socket.emit('join_success');
    io.to(gamePin).emit('update_player_list', room.players);
  });

  socket.on('start_game', ({ gamePin, shuffle }) => {
    const room = gameRooms[gamePin];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length === 0) {
      io.to(room.hostId).emit('host_error', 'Chưa có người chơi trong phòng!');
      return;
    }
    
    room.players.forEach(p => { p.score = 0; p.streak = 0; p.lastAnswer = null; });
    
    if (shuffle) { 
        room.questions = [...room.questions].sort(() => Math.random() - 0.5); 
    }
    room.currentQuestionIndex = 0;
    sendQuestion(gamePin);
  });

  socket.on('player_answer', ({ gamePin, answer }) => {
    const room = gameRooms[gamePin];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    const question = room.questions[room.currentQuestionIndex];
    
    if (player && !player.lastAnswer) {
      player.lastAnswer = answer;
      const isCorrect = (answer === question.correctAnswer);
      
      if (isCorrect) {
        const timeTaken = (Date.now() - room.questionStartTime) / 1000;
        const timeLimit = question.timeLimit;
        const timeScore = Math.max(0, Math.round(1000 * (1 - (timeTaken / (timeLimit * 2)))));
        player.streak++;
        const bonusMultiplier = player.streak >= 2 ? (1 + 0.1 * (player.streak - 1)) : 1;
        const gainedPoints = Math.round(timeScore * bonusMultiplier);
        player.score += gainedPoints;
      } else {
        player.streak = 0;
      }
      
      io.to(socket.id).emit('answer_result', { isCorrect, score: player.score });
      
      const allAnswered = room.players.every(p => p.lastAnswer);
      if (allAnswered) { 
          clearTimeout(room.timer); 
          showAnswerStats(gamePin); 
      }
    }
  });

  socket.on('host_next_question', ({ gamePin }) => {
    const room = gameRooms[gamePin];
    if (!room || room.hostId !== socket.id) return;
    
    room.currentQuestionIndex++;
    room.players.forEach(p => p.lastAnswer = null);
    
    sendQuestion(gamePin);
  });

  socket.on('host_cancel_room', ({ gamePin }) => {
    const room = gameRooms[gamePin];
    if (room && room.hostId === socket.id) {
      io.to(gamePin).emit('host_disconnected');
      delete gameRooms[gamePin];
    }
  });

  socket.on('host_kick', ({ gamePin, playerId }) => {
    const room = gameRooms[gamePin];
    if (!room || room.hostId !== socket.id) return;
    const idx = room.players.findIndex(p => p.id === playerId);
    if (idx !== -1) {
      const [removed] = room.players.splice(idx, 1);
      io.to(removed.id).emit('kicked');
      io.sockets.sockets.get(removed.id)?.leave(gamePin);
      io.to(gamePin).emit('update_player_list', room.players);
    }
  });

  socket.on('disconnect', () => {
    for (const pin in gameRooms) {
      const room = gameRooms[pin];
      if (!room) continue;
      if (room.hostId === socket.id) {
        io.to(pin).emit('host_disconnected');
        delete gameRooms[pin];
        console.log(`[SERVER] Host ngắt kết nối. Đã xóa phòng ${pin}.`);
        return;
      }
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        // Cập nhật lại danh sách người chơi cho host
        io.to(pin).emit('update_player_list', room.players);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => { console.log(`✅ Server QAP đang chạy tại cổng ${PORT}`); });