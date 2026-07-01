const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const DATA_FILE = path.join(__dirname, 'threads.json');
let threads = [];

function loadThreads() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      threads = JSON.parse(raw) || [];
    }
  } catch (error) {
    console.error('Failed to load threads:', error);
    threads = [];
  }
}

function saveThreads() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(threads, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to save threads:', error);
  }
}

function findThread(threadId) {
  return threads.find((thread) => thread.id === threadId);
}

function ensureThread(threadId) {
  let thread = findThread(threadId);
  if (!thread) {
    thread = {
      id: threadId,
      label: `Anonymous ${threadId.slice(-4)}`,
      preview: '',
      messages: [],
    };
    threads.unshift(thread);
    saveThreads();
  }
  return thread;
}

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.get('/', (req, res) => {
  res.send('Anonymous chat server is running.');
});

app.get('/threads', (req, res) => {
  res.json(threads);
});

loadThreads();

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on('join_room', (threadId) => {
    if (!threadId) {
      return;
    }

    socket.join(threadId);
    const thread = ensureThread(threadId);
    console.log(`Socket ${socket.id} joined room ${threadId}`);
    socket.emit('joined_room', { threadId });
    io.emit('thread_joined', {
      threadId: thread.id,
      label: thread.label,
      preview: thread.preview,
    });
  });

  socket.on('send_message', (payload) => {
    const { threadId, text, sender } = payload || {};
    if (!threadId || !text) {
      return;
    }

    const thread = ensureThread(threadId);
    const message = {
      threadId,
      sender: sender || 'unknown',
      text,
      timestamp: new Date().toISOString(),
    };

    thread.messages.push(message);
    thread.preview = text;
    saveThreads();

    io.emit('receive_message', message);
    console.log(`Message in ${threadId} from ${sender || 'unknown'}: ${text}`);
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
