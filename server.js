const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const Room = require('./models/Room');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["https://devcode-24.netlify.app", "http://localhost:5173", "http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors({
  origin: ["https://devcode-24.netlify.app", "http://localhost:5173", "http://localhost:3000"],
  credentials: true
}));
app.use(express.json());

const authRoute = require('./routes/auth');
const roomRoute = require('./routes/rooms');

app.use('/api/auth', authRoute);
app.use('/api/rooms', roomRoute);

app.get('/', (req, res) => {
  res.send('DevCode Backend is running!');
});

// Legacy non-interactive fallback execution route
app.post('/api/execute', async (req, res) => {
  const { language, code } = req.body;

  if (language !== 'python') {
    return res.status(400).json({ message: 'Unsupported language for server execution' });
  }

  const filePath = path.join(__dirname, `temp_${Date.now()}.py`);
  fs.writeFileSync(filePath, code);

  exec(`python3 "${filePath}"`, { timeout: 10000 }, (error, stdout, stderr) => {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  if (error) {
    const errorMessage = stderr || error.stderr || error.message || 'Unknown execution error';
    return res.json({ output: `Error:\n${errorMessage}` });
  }

  res.json({ output: stdout || stderr || 'Program executed successfully (no output).' });
});
});

const activeRooms = new Map(); // roomId -> Map of socket.id -> username
const activeProcesses = {};    // socket.id -> { process, filePath }

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Run Python code interactively via Socket.io
  socket.on('run-python', ({ roomId, code }) => {
    // Kill existing process if user runs a new one
    if (activeProcesses[socket.id]) {
      try {
        activeProcesses[socket.id].process.kill();
        if (fs.existsSync(activeProcesses[socket.id].filePath)) {
          fs.unlinkSync(activeProcesses[socket.id].filePath);
        }
      } catch (e) {}
    }

    const tempFilePath = path.join(__dirname, `temp_${socket.id}_${Date.now()}.py`);
    fs.writeFileSync(tempFilePath, code);

    // -u forces unbuffered Python stdout/stdin
    const pyProcess = spawn('python3', ['-u', tempFilePath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    activeProcesses[socket.id] = { process: pyProcess, filePath: tempFilePath };

    pyProcess.stdout.on('data', (data) => {
      socket.emit('python-output', { type: 'stdout', data: data.toString() });
    });

    pyProcess.stderr.on('data', (data) => {
      socket.emit('python-output', { type: 'stderr', data: data.toString() });
    });

    pyProcess.on('close', (code) => {
      socket.emit('python-output', { type: 'exit', data: `\n[Process exited with code ${code}]` });
      if (activeProcesses[socket.id]) {
        delete activeProcesses[socket.id];
      }
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    });
  });

  // Pipe user input from frontend into Python's stdin
  socket.on('provide-python-input', ({ input }) => {
    const procObj = activeProcesses[socket.id];
    if (procObj && procObj.process) {
      procObj.process.stdin.write(input + '\n');
    }
  });

  socket.on('draw-stroke', (data) => {
    if (data.roomId) {
      socket.to(data.roomId).emit('draw-stroke', data);
    }
  });

  socket.on('clear-whiteboard', ({ roomId }) => {
    socket.to(roomId).emit('clear-whiteboard');
  });

  socket.on('join-room', async ({ roomId, username }) => {
    socket.join(roomId);

    try {
      const room = await Room.findOne({ roomId });

      if (room) {
        if (room.codeContent) {
          socket.emit('update-code', room.codeContent);
        }
        if (room.language) {
          socket.emit('update-language', room.language);
        }
        if (room.messages) {
          socket.emit('load-messages', room.messages);
        }
      }
    } catch (err) {
      console.error('Error fetching room code on join:', err);
    }

    if (!activeRooms.has(roomId)) {
      activeRooms.set(roomId, new Map());
    }
    activeRooms.get(roomId).set(socket.id, username || 'Anonymous');

    const roomUsers = Array.from(activeRooms.get(roomId).values());
    io.to(roomId).emit('room-users', roomUsers);
    console.log(`User ${username} joined room: ${roomId}`);
  });

  socket.on('code-change', ({ roomId, code }) => {
    socket.to(roomId).emit('update-code', code);
  });

  socket.on('language-change', ({ roomId, language }) => {
    socket.to(roomId).emit('language-change', language);
  });

  socket.on('send-message', async ({ roomId, message, username }) => {
    const chatData = {
      username: username || 'Anonymous',
      message,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    try {
      await Room.findOneAndUpdate(
        { roomId },
        { $push: { messages: chatData } },
        { upsert: true }
      );
    } catch (err) {
      console.error('Error saving message to DB:', err);
    }

    io.to(roomId).emit('receive-message', chatData);
  });

  socket.on('end-session', async ({ roomId }) => {
    io.to(roomId).emit('session-ended');
    activeRooms.delete(roomId);
    try {
      await Room.findOneAndDelete({ roomId });
    } catch (err) {
      console.error('Error deleting room on session end:', err);
    }
  });

  socket.on('check-room', ({ roomId }, callback) => {
    const room = io.sockets.adapter.rooms.get(roomId);
    const roomExists = room && room.size > 0;
    callback({ exists: roomExists });
  });

  socket.on('cursor-move', ({ roomId, position, username }) => {
    socket.to(roomId).emit('update-cursor', { socketId: socket.id, position, username });
  });

  socket.on('disconnect', () => {
    // Clean up any running python process for this user
    if (activeProcesses[socket.id]) {
      try {
        activeProcesses[socket.id].process.kill();
        if (fs.existsSync(activeProcesses[socket.id].filePath)) {
          fs.unlinkSync(activeProcesses[socket.id].filePath);
        }
      } catch (e) {}
      delete activeProcesses[socket.id];
    }

    activeRooms.forEach((users, roomId) => {
      if (users.has(socket.id)) {
        users.delete(socket.id);
        const roomUsers = Array.from(users.values());
        io.to(roomId).emit('room-users', roomUsers);
      }
    });
    console.log(`User disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB Connected');
    server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => console.log('Database connection error:', err));