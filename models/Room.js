const mongoose = require('mongoose');


const messageSchema = new mongoose.Schema({
  username: { type: String, required: true },
  message: { type: String, required: true },
  time: { type: String, required: true },
}, { timestamps: true });

const roomSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true },
  roomName: { type: String, required: true },
  codeContent: { type: String, default: '// Start typing your collaborative code here...' },
  language: { type: String, default: 'javascript' },
  messages: [messageSchema],
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('Room', roomSchema);

messages: [
  {
    username: String,
    message: String,
    time: {
      type: Date,
      default: Date.now
    }
  }
]