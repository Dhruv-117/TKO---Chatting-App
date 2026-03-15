const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

const COOLDOWN_SECONDS = 24 * 60 * 60; // 1 day
const AUTO_BLOCK_THRESHOLD = 2;

// Send chat request
router.post('/', authMiddleware, (req, res) => {
  const { toUserId } = req.body;
  const fromUserId = req.user.id;

  if (toUserId === fromUserId) return res.status(400).json({ error: 'Cannot request yourself' });

  // Check if target exists and is discoverable
  const target = db.prepare('SELECT id, privacy_discoverable FROM users WHERE id = ?').get(toUserId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  // Check blocked
  const blocked = db.prepare(`
    SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?
  `).get(toUserId, fromUserId);
  if (blocked) return res.status(400).json({ error: 'Cannot send request' });

  const selfBlocked = db.prepare(`
    SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?
  `).get(fromUserId, toUserId);
  if (selfBlocked) return res.status(400).json({ error: 'User is blocked' });

  // Check cooldown - most recent declined/expired request
  const now = Math.floor(Date.now() / 1000);
  const lastRequest = db.prepare(`
    SELECT created_at FROM request_history 
    WHERE from_user_id = ? AND to_user_id = ? 
    ORDER BY created_at DESC LIMIT 1
  `).get(fromUserId, toUserId);

  if (lastRequest && (now - lastRequest.created_at) < COOLDOWN_SECONDS) {
    return res.status(429).json({ error: 'Please wait before sending another request' });
  }

  // Check if auto-block threshold reached
  const negativeHistory = db.prepare(`
    SELECT COUNT(*) as count FROM request_history
    WHERE from_user_id = ? AND to_user_id = ? AND outcome IN ('rejected', 'not_kept')
  `).get(fromUserId, toUserId);

  if (negativeHistory.count >= AUTO_BLOCK_THRESHOLD) {
    // Auto block
    db.prepare(`
      INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id, reason) VALUES (?, ?, 'auto')
    `).run(toUserId, fromUserId);
    return res.status(400).json({ error: 'Cannot send request' });
  }

  // Check pending request already exists
  const existing = db.prepare(`
    SELECT id FROM chat_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'
  `).get(fromUserId, toUserId);
  if (existing) return res.status(400).json({ error: 'Request already pending' });

  // Check if conversation already exists
  const existingConvo = db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
    JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
    WHERE c.type = 'direct'
  `).get(fromUserId, toUserId);
  if (existingConvo) return res.status(400).json({ error: 'Chat already exists' });

  const requestId = uuidv4();
  db.prepare(`
    INSERT INTO chat_requests (id, from_user_id, to_user_id) VALUES (?, ?, ?)
  `).run(requestId, fromUserId, toUserId);

  // Create notification
  db.prepare(`
    INSERT INTO notifications (id, user_id, type, data) VALUES (?, ?, 'chat_request', ?)
  `).run(uuidv4(), toUserId, JSON.stringify({ requestId, fromUserId }));

  res.json({ success: true, requestId });
});

// Get pending requests (received)
router.get('/pending', authMiddleware, (req, res) => {
  const requests = db.prepare(`
    SELECT cr.id, cr.from_user_id, cr.created_at,
           u.username, u.display_name, u.avatar_color
    FROM chat_requests cr
    JOIN users u ON u.id = cr.from_user_id
    WHERE cr.to_user_id = ? AND cr.status = 'pending'
    ORDER BY cr.created_at DESC
  `).all(req.user.id);

  res.json(requests.map(r => ({
    id: r.id,
    fromUserId: r.from_user_id,
    username: r.username,
    displayName: r.display_name,
    avatarColor: r.avatar_color,
    createdAt: r.created_at
  })));
});

// Accept request
router.post('/:requestId/accept', authMiddleware, (req, res) => {
  const request = db.prepare(`
    SELECT * FROM chat_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'
  `).get(req.params.requestId, req.user.id);

  if (!request) return res.status(404).json({ error: 'Request not found' });

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (24 * 60 * 60); // 24 hours

  // Create conversation
  const convoId = uuidv4();
  db.prepare(`
    INSERT INTO conversations (id, type, created_by, expires_at, is_permanent) VALUES (?, 'direct', ?, ?, 0)
  `).run(convoId, request.from_user_id, expiresAt);

  // Add both members
  db.prepare(`INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)`).run(convoId, request.from_user_id);
  db.prepare(`INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)`).run(convoId, req.user.id);

  // Update request status
  db.prepare(`UPDATE chat_requests SET status = 'accepted', responded_at = ? WHERE id = ?`).run(now, request.id);

  res.json({ success: true, conversationId: convoId, expiresAt });
});

// Decline request
router.post('/:requestId/decline', authMiddleware, (req, res) => {
  const request = db.prepare(`
    SELECT * FROM chat_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'
  `).get(req.params.requestId, req.user.id);

  if (!request) return res.status(404).json({ error: 'Request not found' });

  const now = Math.floor(Date.now() / 1000);
  db.prepare(`UPDATE chat_requests SET status = 'declined', responded_at = ? WHERE id = ?`).run(now, request.id);

  // Record in history
  db.prepare(`
    INSERT INTO request_history (id, from_user_id, to_user_id, outcome) VALUES (?, ?, ?, 'rejected')
  `).run(uuidv4(), request.from_user_id, request.to_user_id);

  // Check auto-block
  const count = db.prepare(`
    SELECT COUNT(*) as count FROM request_history
    WHERE from_user_id = ? AND to_user_id = ? AND outcome IN ('rejected', 'not_kept')
  `).get(request.from_user_id, request.to_user_id);

  if (count.count >= AUTO_BLOCK_THRESHOLD) {
    db.prepare(`INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id, reason) VALUES (?, ?, 'auto')`).run(req.user.id, request.from_user_id);
  }

  res.json({ success: true });
});

module.exports = router;
