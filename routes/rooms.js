const router = require('express').Router();
const Room = require('../models/Room');

// CREATE OR FIND A ROOM
router.post('/join', async (req, res) => {
  try {
    const { roomId, roomName, userId } = req.body;
    
    let room = await Room.findOne({ roomId });
    
    if (!room) {
      // Create room if it doesn't exist yet
      room = new Room({
        roomId,
        roomName: roomName || `Room ${roomId}`,
        owner: userId,
      });
      await room.save();
    }
    
    res.status(200).json(room);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SAVE CODE SNAPSHOT TO ROOM
router.put('/save/:roomId', async (req, res) => {
  try {
    const { codeContent, language } = req.body;
    const updatedRoom = await Room.findOneAndUpdate(
      { roomId: req.params.roomId },
      { codeContent, language, updatedAt: Date.now() },
      { upsert: true, new: true }
    );
    res.status(200).json({ message: 'Room saved successfully', updatedRoom });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET ROOM DATA (Code & Language) BY ROOM ID
router.get('/:roomId', async (req, res) => {
  try {
    const room = await Room.findOne({ roomId: req.params.roomId }).populate('owner', 'username name');
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    res.json({
      codeContent: room.codeContent,
      language: room.language,
      hostUsername: room.owner ? (room.owner.username || room.owner.name) : null
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error fetching room' });
  }
});

// Get user recent rooms (or all active rooms)
router.get('/user-rooms/:userId', async (req, res) => {
  try {
    const rooms = await Room.find().sort({ updatedAt: -1 }).limit(10);
    res.status(200).json(rooms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

// DELETE /api/rooms/:roomId
router.delete('/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    
    const deletedRoom = await Room.findOneAndDelete({ roomId });
    
    if (!deletedRoom) {
      return res.status(404).json({ message: 'Room not found in database' });
    }

    res.status(200).json({ message: 'Room deleted successfully' });
  } catch (err) {
    console.error('Error deleting room:', err);
    res.status(500).json({ error: 'Server error while deleting room' });
  }
});