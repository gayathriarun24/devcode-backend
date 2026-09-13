const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const Room = require('./models/Room');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["https://devcode-24.netlify.app", "http://localhost:5173"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors({
  origin: ["https://devcode-24.netlify.app", "http://localhost:5173"],
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

// Local Python execution route using child_process (No external APIs or keys needed)
app.post('/api/execute', async (req, res) => {
  const { language, code } = req.body;

  if (language !== 'python') {
    return res.status(400).json({ message: 'Unsupported language for server execution' });
  }

  const filePath = path.join(__dirname, `temp_${Date.now()}.py`);
  
  fs.writeFileSync(filePath, code);

  exec(`python "${filePath}"`, { timeout: 5000 }, (error, stdout, stderr) => {
    // Clean up temporary file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    if (error) {
      return res.json({ output: stderr || error.message });
    }
    
    res.json({ output: stdout || stderr || 'Program executed successfully (no output).' });
  });
});

const activeRooms = new Map(); // roomId -> Map of socket.id -> username

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('join-room', async ({ roomId, username }) => {
    socket.join(roomId);

    socket.on('draw-stroke', (data) => {
      socket.to(data.roomId).emit('draw-stroke', data);
    });

    socket.on('clear-whiteboard', ({ roomId }) => {
      socket.to(roomId).emit('clear-whiteboard');
    });

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
    socket.to(roomId).emit('update-language', language);
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

  socket.on('end-session', ({ roomId }) => {
  io.to(roomId).emit('session-ended');
});

  socket.on('disconnect', () => {
    activeRooms.forEach((users, roomId) => {
      if (users.has(socket.id)) {
        users.delete(socket.id);
        const roomUsers = Array.from(users.values());
        io.to(roomId).emit('room-users', roomUsers);
      }
    });
    console.log(`User disconnected: ${socket.id}`);
  });

  socket.on('check-room', ({ roomId }, callback) => {
  const room = io.sockets.adapter.rooms.get(roomId);
  const roomExists = room && room.size > 0;
  callback({ exists: roomExists });
});

  socket.on('cursor-move', ({ roomId, position, username }) => {
    socket.to(roomId).emit('update-cursor', { socketId: socket.id, position, username });
  });

});

const PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB Connected');
    server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => console.log('Database connection error:', err));