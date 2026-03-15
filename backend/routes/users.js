const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

// Search user by exact username
router.get('/find/:username', authMiddleware, (req, res) => {
  const { username } = req.params;
  const searchUser = db.prepare(`
    SELECT id, username, display_name, avatar_color, public_key, 
           is_online, last_seen, privacy_online_status, privacy_last_seen, 
           privacy_discoverable, privacy_pfp
    FROM users WHERE username = ?
  `).get(username.toLowerCase());

  if (!searchUser) return res.status(404).json({ error: 'User not found' });

  // Check discoverability — but allow if already in a conversation together
  if (!searchUser.privacy_discoverable) {
    const sharedConvo = db.prepare(`
      SELECT 1 FROM conversation_members cm1
      JOIN conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
      WHERE cm1.user_id = ? AND cm2.user_id = ?
    `).get(req.user.id, searchUser.id);
    if (!sharedConvo) return res.status(404).json({ error: 'User not found' });
  }

  // Check if blocked
  const isBlocked = db.prepare(`
    SELECT 1 FROM blocked_users 
    WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
  `).get(req.user.id, searchUser.id, searchUser.id, req.user.id);

  if (isBlocked) return res.status(404).json({ error: 'User not found' });

  const response = {
    id: searchUser.id,
    username: searchUser.username,
    displayName: searchUser.display_name,
    avatarColor: searchUser.avatar_color,
    publicKey: searchUser.public_key,
    isOnline: searchUser.privacy_online_status === 'everyone' ? !!searchUser.is_online : null,
    lastSeen: searchUser.privacy_last_seen === 'everyone' ? searchUser.last_seen : null,
    showPfp: searchUser.privacy_pfp === 'everyone'
  };

  res.json(response);
});

// Get public key by userId — only works if you share a conversation (for encryption)
router.get('/key/:userId', authMiddleware, (req, res) => {
  const { userId } = req.params;

  // Must share a conversation — prevents harvesting keys of strangers
  const sharedConvo = db.prepare(`
    SELECT 1 FROM conversation_members cm1
    JOIN conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
    WHERE cm1.user_id = ? AND cm2.user_id = ?
  `).get(req.user.id, userId);

  if (!sharedConvo) return res.status(403).json({ error: 'Access denied' });

  const target = db.prepare('SELECT id, public_key FROM users WHERE id = ?').get(userId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  res.json({ userId: target.id, publicKey: target.public_key });
});

// Update profile
router.put('/profile', authMiddleware, (req, res) => {
  const { displayName } = req.body;
  if (!displayName) return res.status(400).json({ error: 'Display name required' });

  db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, req.user.id);
  res.json({ success: true, displayName });
});

// Change username
router.put('/username', authMiddleware, (req, res) => {
  const { username } = req.body;
  const user = req.user;

  if (user.username_changes >= 4) {
    return res.status(400).json({ error: 'Username change limit reached (4 max)' });
  }

  // Check cooldown (7 days)
  const cooldownDays = 7;
  const cooldownSeconds = cooldownDays * 24 * 60 * 60;
  const now = Math.floor(Date.now() / 1000);
  if (user.username_last_changed && (now - user.username_last_changed) < cooldownSeconds) {
    const daysLeft = Math.ceil((cooldownSeconds - (now - user.username_last_changed)) / 86400);
    return res.status(400).json({ error: `Username can be changed in ${daysLeft} day(s)` });
  }

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'Invalid username format' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username.toLowerCase(), user.id);
  if (existing) return res.status(400).json({ error: 'Username already taken' });

  db.prepare(`
    UPDATE users SET username = ?, username_changes = username_changes + 1, username_last_changed = ? WHERE id = ?
  `).run(username.toLowerCase(), now, user.id);

  res.json({ success: true, username: username.toLowerCase(), changesLeft: 4 - (user.username_changes + 1) });
});

// Update privacy settings
router.put('/privacy', authMiddleware, (req, res) => {
  const { privacyLastSeen, privacyOnlineStatus, privacyDiscoverable, privacyPfp } = req.body;

  const updates = [];
  const values = [];

  if (privacyLastSeen !== undefined) { updates.push('privacy_last_seen = ?'); values.push(privacyLastSeen); }
  if (privacyOnlineStatus !== undefined) { updates.push('privacy_online_status = ?'); values.push(privacyOnlineStatus); }
  if (privacyDiscoverable !== undefined) { updates.push('privacy_discoverable = ?'); values.push(privacyDiscoverable ? 1 : 0); }
  if (privacyPfp !== undefined) { updates.push('privacy_pfp = ?'); values.push(privacyPfp); }

  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  values.push(req.user.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ success: true });
});

// Set app lock
router.put('/app-lock', authMiddleware, async (req, res) => {
  const { enabled, password } = req.body;

  if (enabled && password) {
    const hash = await bcrypt.hash(password, 10);
    db.prepare('UPDATE users SET app_lock_enabled = 1, app_lock_hash = ? WHERE id = ?').run(hash, req.user.id);
  } else {
    db.prepare('UPDATE users SET app_lock_enabled = 0, app_lock_hash = NULL WHERE id = ?').run(req.user.id);
  }

  res.json({ success: true });
});

// Verify app lock password
router.post('/app-lock/verify', authMiddleware, async (req, res) => {
  const { password } = req.body;
  const user = db.prepare('SELECT app_lock_hash FROM users WHERE id = ?').get(req.user.id);
  const valid = await bcrypt.compare(password, user.app_lock_hash || '');
  res.json({ valid });
});

// Get blocked users
router.get('/blocked', authMiddleware, (req, res) => {
  const blocked = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_color, b.blocked_at, b.reason
    FROM blocked_users b
    JOIN users u ON u.id = b.blocked_id
    WHERE b.blocker_id = ?
    ORDER BY b.blocked_at DESC
  `).all(req.user.id);

  res.json(blocked.map(u => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatarColor: u.avatar_color,
    blockedAt: u.blocked_at,
    reason: u.reason
  })));
});

// Unblock user
router.delete('/blocked/:userId', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').run(req.user.id, req.params.userId);
  res.json({ success: true });
});

// Delete account — removes everything
router.delete('/account', authMiddleware, async (req, res) => {
  const { password } = req.body;
  const userId = req.user.id;

  // Verify password before deleting
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(400).json({ error: 'Incorrect password' });

  // Find all conversations this user is in
  const convos = db.prepare('SELECT conversation_id FROM conversation_members WHERE user_id = ?').all(userId);

  // For each direct conversation — delete it entirely
  // For each group — just remove the user (keep group for others)
  for (const { conversation_id } of convos) {
    const convo = db.prepare('SELECT type FROM conversations WHERE id = ?').get(conversation_id);
    if (!convo) continue;

    if (convo.type === 'direct') {
      // Delete all messages and the whole conversation
      db.prepare('DELETE FROM message_status WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)').run(conversation_id);
      db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversation_id);
      db.prepare('DELETE FROM conversation_members WHERE conversation_id = ?').run(conversation_id);
      db.prepare('DELETE FROM conversations WHERE id = ?').run(conversation_id);
    } else {
      // Group — just remove user from it
      db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(conversation_id, userId);
    }
  }

  // Delete all user data
  db.prepare('DELETE FROM message_status WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM messages WHERE sender_id = ?').run(userId);
  db.prepare('DELETE FROM chat_requests WHERE from_user_id = ? OR to_user_id = ?').run(userId, userId);
  db.prepare('DELETE FROM request_history WHERE from_user_id = ? OR to_user_id = ?').run(userId, userId);
  db.prepare('DELETE FROM blocked_users WHERE blocker_id = ? OR blocked_id = ?').run(userId, userId);
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);

  res.json({ success: true });
});

module.exports = router;
