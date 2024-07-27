const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');

// Initialize app and server
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(express.json());

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/quiz-app', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Define Room schema and model
const roomSchema = new mongoose.Schema({
  roomId: String,
  users: [String],
  status: String, // 'waiting', 'full', 'in-progress', 'completed'
  questions: [String], // Array of question IDs
  scores: { type: Map, of: Number }
});

const Room = mongoose.model('Room', roomSchema);

// Define Question schema and model
const questionSchema = new mongoose.Schema({
  question: String,
  options: [String],
  answer: Number, // index of the correct option
});

const Question = mongoose.model('Question', questionSchema);

// REST API routes
app.get('/rooms', async (req, res) => {
  const rooms = await Room.find({ status: { $ne: 'completed' } });
  res.json(rooms);
});

app.post('/rooms', async (req, res) => {
  const newRoom = new Room({
    roomId: `room_${Date.now()}`,
    users: [],
    status: 'waiting',
    questions: [],
    scores: {}
  });
  await newRoom.save();
  res.json(newRoom);
});

app.post('/join', async (req, res) => {
  const { roomId, userId } = req.body;
  const room = await Room.findOne({ roomId });
  if (room && room.users.length < 2) {
    room.users.push(userId);
    if (room.users.length === 2) {
      room.status = 'full';
    }
    await room.save();
    res.json(room);
  } else {
    res.status(400).json({ message: 'Room is full or does not exist.' });
  }
});

// Socket.IO connections
io.on('connection', (socket) => {
  console.log('A user connected');

  socket.on('joinRoom', async ({ roomId, userId }) => {
    const room = await Room.findOne({ roomId });
    if (room) {
      socket.join(roomId);
      socket.emit('roomJoined', room);
      if (room.users.length === 2) {
        startGame(room);
      }
    }
  });

  socket.on('submitAnswer', async ({ roomId, userId, answerIndex }) => {
    const room = await Room.findOne({ roomId });
    if (room && room.status === 'in-progress') {
      // Check the answer and update the score
      const questionIndex = room.questions.length;
      const question = await Question.findById(room.questions[questionIndex]);
      if (question.answer === answerIndex) {
        room.scores.set(userId, (room.scores.get(userId) || 0) + 10);
      }
      await room.save();
      if (room.questions.length === 5) {
        endGame(roomId);
      } else {
        sendNextQuestion(roomId);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected');
    // Handle disconnection
  });
});

// Start the game
const startGame = async (room) => {
  room.status = 'in-progress';
  const questions = await Question.aggregate([{ $sample: { size: 5 } }]);
  room.questions = questions.map(q => q._id);
  await room.save();
  sendNextQuestion(room.roomId);
};

const sendNextQuestion = async (roomId) => {
  const room = await Room.findOne({ roomId });
  const questionIndex = room.questions.length;
  const question = await Question.findById(room.questions[questionIndex]);
  io.to(roomId).emit('nextQuestion', question);
};

const endGame = async (roomId) => {
  const room = await Room.findOne({ roomId });
  room.status = 'completed';
  await room.save();
  io.to(roomId).emit('gameOver', room.scores);
};

server.listen(3000, () => {
  console.log('Server is running on port 3000');
});