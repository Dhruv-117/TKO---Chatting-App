require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('./db/database');
const { JWT_SECRET } = require('./middleware/auth');

const app = express();
const server = http.createServer(app);

// Trust proxy — required when running behind ngrok or any reverse proxy
app.set('trust proxy', 1);

// ── Allowed origin: set ALLOWED_ORIGIN in .env, else allow all (dev)
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGIN, methods: ['GET', 'POST'] }
});

// ── CORS
app.use(cors({
  origin: ALLOWED_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));

app.use(express.json({ limit: '2mb' }));

// ── Rate limiting — token-based so ngrok shared IP doesn't block everyone
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 min window (was 15)
  max: 15,
  message: { error: 'Too many attempts, please try again later' },
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.ip + (req.headers['user-agent'] || '').slice(0, 50),
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  message: { error: 'Too many requests' },
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => {
    // Per-token bucket — each logged in user gets their own limit
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) return 'tok_' + auth.slice(-32);
    return req.ip + (req.headers['user-agent'] || '').slice(0, 50);
  },
});

app.use('/api/auth/register', authLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api', apiLimiter);

// ── Authenticated media serving
app.get('/media/:filename', (req, res) => {
  // Accept token from Authorization header OR query param (needed for img/video/audio tags)
  const authHeader = req.headers.authorization;
  const queryToken = req.query.t;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : queryToken;

  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  const filename = path.basename(req.params.filename); // prevent path traversal
  const filepath = path.join(__dirname, 'media', filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(filepath);
});

// ── Serve built React frontend
const FRONTEND_BUILD = path.join(__dirname, '..', 'frontend', 'build');
if (fs.existsSync(FRONTEND_BUILD)) {
  app.use(express.static(FRONTEND_BUILD));
  console.log('✅ Serving frontend from build folder');
}

// ── API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/conversations', require('./routes/conversations'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', name: 'TKO Server' }));

// ── PWA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/media')) return;
  const indexPath = path.join(FRONTEND_BUILD, 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else res.status(404).send('Frontend not built yet. Run: cd frontend && npm run build');
});

// ── Socket.io auth
const userSockets = new Map(); // userId -> socketId

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Unauthorized'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.userId;
  userSockets.set(userId, socket.id);

  db.prepare('UPDATE users SET is_online = 1, last_seen = ? WHERE id = ?')
    .run(Math.floor(Date.now() / 1000), userId);

  broadcastPresence(userId, true);

  // Join conversation rooms
  const convos = db.prepare('SELECT conversation_id FROM conversation_members WHERE user_id = ?').all(userId);
  for (const c of convos) socket.join(c.conversation_id);

  // ── Message relay: server verifies membership before broadcasting
  socket.on('send_message', ({ conversationId, message }) => {
    // Verify sender is actually a member of this conversation
    const isMember = db.prepare(
      'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
    ).get(conversationId, userId);
    if (!isMember) return; // silently drop forged messages
    // Only broadcast to others — sender already has the message
    socket.to(conversationId).emit('new_message', { conversationId, message });
  });

  socket.on('typing', ({ conversationId, isTyping }) => {
    const isMember = db.prepare(
      'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?'
    ).get(conversationId, userId);
    if (!isMember) return;
    socket.to(conversationId).emit('user_typing', { userId, conversationId, isTyping });
  });

  socket.on('mark_read', ({ conversationId, messageId }) => {
    socket.to(conversationId).emit('message_read', { userId, conversationId, messageId });
  });

  socket.on('chat_request_sent', ({ toUserId, requestData }) => {
    const targetSocket = userSockets.get(toUserId);
    if (targetSocket) io.to(targetSocket).emit('chat_request_received', requestData);
  });

  socket.on('request_accepted', ({ toUserId, conversationData }) => {
    const targetSocket = userSockets.get(toUserId);
    if (targetSocket) {
      io.to(targetSocket).emit('new_conversation', conversationData);
      io.sockets.sockets.get(targetSocket)?.join(conversationData.id);
    }
    socket.join(conversationData.id);
  });

  socket.on('message_deleted_broadcast', ({ conversationId, messageId, deleteFor }) => {
    const isMember = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(conversationId, userId);
    if (!isMember) return;
    socket.to(conversationId).emit('message_deleted', { messageId, deleteFor });
  });

  // Account deleted — notify all conversation members to remove the chat
  socket.on('account_deleted', ({ conversationIds }) => {
    for (const convoId of conversationIds) {
      socket.to(convoId).emit('conversation_removed', { conversationId: convoId, reason: 'account_deleted' });
    }
  });

  socket.on('disconnect', () => {
    userSockets.delete(userId);
    const now = Math.floor(Date.now() / 1000);
    db.prepare('UPDATE users SET is_online = 0, last_seen = ? WHERE id = ?').run(now, userId);
    broadcastPresence(userId, false, now);
  });
});

// ── Presence broadcast — respects privacy_online_status
function broadcastPresence(userId, isOnline, lastSeen = null) {
  const user = db.prepare('SELECT privacy_online_status, privacy_last_seen FROM users WHERE id = ?').get(userId);
  const ts = lastSeen || Math.floor(Date.now() / 1000);

  const convos = db.prepare('SELECT conversation_id FROM conversation_members WHERE user_id = ?').all(userId);
  for (const c of convos) {
    io.to(c.conversation_id).emit('presence_update', {
      userId,
      // Only send real status if user allows it
      isOnline: user?.privacy_online_status === 'everyone' ? isOnline : null,
      lastSeen: user?.privacy_last_seen === 'everyone' ? ts : null,
    });
  }
}

// ── Background cleanup: delete expired conversations every 5 minutes
function cleanupExpired() {
  const now = Math.floor(Date.now() / 1000);
  const expired = db.prepare(
    'SELECT id FROM conversations WHERE expires_at IS NOT NULL AND expires_at < ? AND is_permanent = 0'
  ).all(now);

  for (const convo of expired) {
    const members = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?').all(convo.id);
    const { v4: uuidv4 } = require('uuid');
    if (members.length === 2) {
      db.prepare(
        "INSERT INTO request_history (id, from_user_id, to_user_id, outcome) VALUES (?, ?, ?, 'not_kept')"
      ).run(uuidv4(), members[0].user_id, members[1].user_id);
    }
    db.prepare('DELETE FROM message_status WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)').run(convo.id);
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(convo.id);
    db.prepare('DELETE FROM conversation_members WHERE conversation_id = ?').run(convo.id);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(convo.id);
    console.log(`🗑 Expired conversation ${convo.id} cleaned up`);
  }
}

setInterval(cleanupExpired, 5 * 60 * 1000); // every 5 min
cleanupExpired(); // also run on startup

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🚀 TKO Server running on http://localhost:${PORT}`);
  console.log(`📦 API: http://localhost:${PORT}/api`);
  console.log(`🔒 E2E Encrypted messaging ready\n`);
});
