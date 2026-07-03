const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'anon-chat-app';
const client = new MongoClient(MONGODB_URI);
let messagesCollection;

async function connectDb() {
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    messagesCollection = db.collection('messages');
    await messagesCollection.createIndex({ threadId: 1, timestamp: 1 });
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection failed:', error);
    process.exit(1);
  }
}

function getThreadLabel(threadId) {
  return `Anonymous ${threadId.slice(-4)}`;
}

function formatThread(threadId, preview, lastTimestamp) {
  return {
    id: threadId,
    label: getThreadLabel(threadId),
    preview: preview || '',
    lastTimestamp,
  };
}

function ensureThread(threadId) {
  return {
    id: threadId,
    label: getThreadLabel(threadId),
    preview: '',
  };
}

async function loadThreadSummaries() {
  const pipeline = [
    { $sort: { timestamp: -1 } },
    {
      $group: {
        _id: '$threadId',
        preview: { $first: '$text' },
        timestamp: { $first: '$timestamp' },
      },
    },
    {
      $project: {
        _id: 0,
        threadId: '$_id',
        preview: 1,
        timestamp: 1,
      },
    },
    { $sort: { timestamp: -1 } },
  ];
  return messagesCollection.aggregate(pipeline).toArray();
}

async function getMessagesForThread(threadId) {
  return messagesCollection
    .find({ threadId })
    .sort({ timestamp: 1 })
    .project({ _id: 0, threadId: 1, sender: 1, text: 1, timestamp: 1 })
    .toArray();
}

async function saveMessage(message) {
  await messagesCollection.insertOne(message);

  // Send web-push notifications to subscribed clients
  if (pushSubscriptions.length > 0 && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    const payload = JSON.stringify({
      title: 'New message',
      body: message.text,
      threadId: message.threadId,
      timestamp: message.timestamp,
    });

    pushSubscriptions.forEach((sub) => {
      webpush.sendNotification(sub, payload).catch((err) => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // subscription is gone, remove it
          pushSubscriptions = pushSubscriptions.filter((s) => JSON.stringify(s) !== JSON.stringify(sub));
        } else {
          console.error('Web Push error:', err);
        }
      });
    });
  }
}

const webpush = require('web-push');

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn('VAPID keys are not set. Web Push will be disabled until keys are provided.');
}

let pushSubscriptions = []; // in-memory; optional persistence can be added

const ADMIN_ROUTE = process.env.ADMIN_ROUTE || '/admin-secret-access-xyz';
const ADMIN_KEY = process.env.ADMIN_KEY || 'mySecretPassword';

function validateAdminKey(req, res, next) {
  const { key } = req.query;
  if (!key || key !== ADMIN_KEY) {
    return res.status(403).send('Forbidden');
  }
  next();
}

app.use((req, res, next) => {
  if (req.path === '/admin.html' || req.path === '/admin') {
    return res.status(404).send('Not found');
  }
  next();
});

// Serve static files (landing page, index.html, client assets)
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get(ADMIN_ROUTE, validateAdminKey, (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get(['/landing', '/hub'], (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.sendFile(path.join(__dirname, 'landing.html'));
});

app.get('/threads', async (req, res) => {
  try {
    const threads = await loadThreadSummaries();
    res.json(threads);
  } catch (error) {
    console.error('Failed to load threads:', error);
    res.status(500).json({ error: 'Failed to load threads' });
  }
});

app.get('/threads/:threadId/messages', async (req, res) => {
  try {
    const messages = await getMessagesForThread(req.params.threadId);
    res.json(messages);
  } catch (error) {
    console.error('Failed to load messages for thread', req.params.threadId, error);
    res.status(500).json({ error: 'Failed to load thread messages' });
  }
});

// Web Push subscription endpoints
app.use(express.json());

app.post('/subscribe', (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    if (VAPID_PUBLIC_KEY) {
      return res.json({ publicKey: VAPID_PUBLIC_KEY });
    }
    return res.status(400).json({ error: 'Invalid subscription' });
  }
  pushSubscriptions.push(subscription);
  res.status(201).json({ success: true });
});

app.post('/unsubscribe', (req, res) => {
  const subscription = req.body;
  pushSubscriptions = pushSubscriptions.filter((s) => JSON.stringify(s) !== JSON.stringify(subscription));
  res.json({ success: true });
});

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on('join_room', (threadId) => {
    if (!threadId) {
      return;
    }

    socket.join(threadId);
    console.log(`Socket ${socket.id} joined room ${threadId}`);
    socket.emit('joined_room', { threadId });
    io.emit('thread_joined', {
      threadId,
      label: getThreadLabel(threadId),
      preview: '',
    });
  });

  socket.on('send_message', async (payload) => {
    const { threadId, text, sender } = payload || {};
    if (!threadId || !text) {
      return;
    }

    const message = {
      threadId,
      sender: sender || 'unknown',
      text,
      timestamp: new Date().toISOString(),
    };

    try {
      await saveMessage(message);
    } catch (error) {
      console.error('Failed to save message:', error);
      return;
    }

    io.to(threadId).emit('receive_message', message);
    io.emit('thread_joined', {
      threadId,
      label: getThreadLabel(threadId),
      preview: text,
    });
    console.log(`Message in ${threadId} from ${sender || 'unknown'}: ${text}`);
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;

async function start() {
  await connectDb();
  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

start().catch((error) => {
  console.error('Server failed to start:', error);
  process.exit(1);
});
