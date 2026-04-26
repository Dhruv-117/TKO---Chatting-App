const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authMiddleware } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Media storage
const MEDIA_DIR = path.join(__dirname, '..', 'media');
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: MEDIA_DIR,
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB

// Get all conversations for user
router.get('/', authMiddleware, (req, res) => {
  const now = Math.floor(Date.now() / 1000);

  // Auto-expire conversations
  const expiredConvos = db.prepare(`
    SELECT id FROM conversations WHERE expires_at IS NOT NULL AND expires_at < ? AND is_permanent = 0
  `).all(now);

  for (const convo of expiredConvos) {
    // Record not_kept in history
    const members = db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?').all(convo.id);
    if (members.length === 2) {
      db.prepare(`
        INSERT INTO request_history (id, from_user_id, to_user_id, outcome) VALUES (?, ?, ?, 'not_kept')
      `).run(uuidv4(), members[0].user_id, members[1].user_id);
    }
    // Delete conversation and messages
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(convo.id);
    db.prepare('DELETE FROM conversation_members WHERE conversation_id = ?').run(convo.id);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(convo.id);
  }

  const conversations = db.prepare(`
    SELECT c.id, c.type, c.name, c.avatar_color, c.created_at, c.expires_at, c.is_permanent,
           cm.role, cm.is_muted, cm.kept_chat, cm.note, cm.chat_lock_enabled
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
    ORDER BY c.created_at DESC
  `).all(req.user.id);

  const result = conversations.map(convo => {
    // Get last message
    const lastMsg = db.prepare(`
      SELECT m.id, m.encrypted_content, m.message_type, m.created_at, u.display_name as sender_name
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = ? AND m.is_deleted = 0
      ORDER BY m.created_at DESC LIMIT 1
    `).get(convo.id);

    // Get unread count
    const unread = db.prepare(`
      SELECT COUNT(*) as count FROM messages m
      LEFT JOIN message_status ms ON ms.message_id = m.id AND ms.user_id = ?
      WHERE m.conversation_id = ? AND m.sender_id != ? AND (ms.status IS NULL OR ms.status != 'read')
      AND m.is_deleted = 0
    `).get(req.user.id, convo.id, req.user.id);

    // For direct chats, get other user info
    let otherUser = null;
    if (convo.type === 'direct') {
      const other = db.prepare(`
        SELECT u.id, u.username, u.display_name, u.avatar_color, u.is_online, u.last_seen,
               u.public_key, u.privacy_online_status, u.privacy_last_seen, u.privacy_pfp
        FROM conversation_members cm
        JOIN users u ON u.id = cm.user_id
        WHERE cm.conversation_id = ? AND cm.user_id != ?
      `).get(convo.id, req.user.id);
      if (other) {
        otherUser = {
          id: other.id,
          username: other.username,
          displayName: other.display_name,
          avatarColor: other.avatar_color,
          publicKey: other.public_key,
          isOnline: other.privacy_online_status === 'everyone' ? !!other.is_online : null,
          lastSeen: other.privacy_last_seen === 'everyone' ? other.last_seen : null,
          showPfp: other.privacy_pfp === 'everyone'
        };
      }
    }

    // Get members count for groups
    let memberCount = null;
    if (convo.type === 'group') {
      const mc = db.prepare('SELECT COUNT(*) as count FROM conversation_members WHERE conversation_id = ?').get(convo.id);
      memberCount = mc.count;
    }

    return {
      id: convo.id,
      type: convo.type,
      name: convo.name,
      avatarColor: convo.avatar_color,
      createdAt: convo.created_at,
      expiresAt: convo.expires_at,
      isPermanent: !!convo.is_permanent,
      role: convo.role,
      isMuted: !!convo.is_muted,
      keptChat: !!convo.kept_chat,
      note: convo.note,
      chatLockEnabled: !!convo.chat_lock_enabled,
      otherUser,
      memberCount,
      lastMessage: lastMsg ? {
        id: lastMsg.id,
        encryptedContent: lastMsg.encrypted_content,
        type: lastMsg.message_type,
        createdAt: lastMsg.created_at,
        senderName: lastMsg.sender_name
      } : null,
      unreadCount: unread.count
    };
  });

  res.json(result);
});

// Create group
router.post('/group', authMiddleware, (req, res) => {
  const { name, memberIds } = req.body;
  if (!name) return res.status(400).json({ error: 'Group name required' });

  const convoId = uuidv4();
  const colors = ['#2B5EE8', '#1a9e4a', '#e84393', '#e87c2b', '#7c2be8'];
  const avatarColor = colors[Math.floor(Math.random() * colors.length)];

  db.prepare(`
    INSERT INTO conversations (id, type, name, avatar_color, created_by, is_permanent) VALUES (?, 'group', ?, ?, ?, 1)
  `).run(convoId, name, avatarColor, req.user.id);

  // Add creator as admin
  db.prepare(`INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, 'admin')`).run(convoId, req.user.id);

  // Add members
  if (memberIds && Array.isArray(memberIds)) {
    for (const memberId of memberIds) {
      if (memberId !== req.user.id) {
        db.prepare(`INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, 'member')`).run(convoId, memberId);
      }
    }
  }

  res.json({ success: true, conversationId: convoId });
});

// Get messages in conversation
router.get('/:id/messages', authMiddleware, (req, res) => {
  const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  const messages = db.prepare(`
    SELECT m.id, m.sender_id, m.encrypted_content, m.message_type, m.media_url, m.media_name, m.media_size, m.created_at,
           m.reply_to_id, m.hidden_by,
           u.display_name as sender_name, u.avatar_color as sender_color, u.username as sender_username
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ? AND m.is_deleted = 0
    ORDER BY m.created_at ASC
  `).all(req.params.id);

  // Mark as read
  for (const msg of messages) {
    if (msg.sender_id !== req.user.id) {
      db.prepare(`
        INSERT OR REPLACE INTO message_status (message_id, user_id, status) VALUES (?, ?, 'read')
      `).run(msg.id, req.user.id);
    }
  }

  // Filter hidden messages and attach reply previews
  const userId = req.user.id;
  const result = messages
    .filter(m => {
      if (!m.hidden_by) return true;
      try { return !JSON.parse(m.hidden_by).includes(userId); } catch { return true; }
    })
    .map(m => {
      let replyPreview = null;
      if (m.reply_to_id) {
        const replied = messages.find(r => r.id === m.reply_to_id);
        if (replied) replyPreview = {
          encryptedContent: replied.encrypted_content,
          type: replied.message_type,
          senderName: replied.sender_name,
        };
      }
      return {
        id: m.id,
        senderId: m.sender_id,
        senderName: m.sender_name,
        senderColor: m.sender_color,
        senderUsername: m.sender_username,
        encryptedContent: m.encrypted_content,
        type: m.message_type,
        mediaUrl: m.media_url,
        mediaName: m.media_name,
        mediaSize: m.media_size,
        createdAt: m.created_at,
        replyToId: m.reply_to_id,
        replyPreview,
      };
    });

  res.json(result);
});

// Send message
router.post('/:id/messages', authMiddleware, (req, res) => {
  const { encryptedContent, type, replyToId } = req.body;
  const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  const msgId = uuidv4();
  db.prepare(`
    INSERT INTO messages (id, conversation_id, sender_id, encrypted_content, message_type, reply_to_id) VALUES (?, ?, ?, ?, ?, ?)
  `).run(msgId, req.params.id, req.user.id, encryptedContent, type || 'text', replyToId || null);

  const msg = db.prepare(`
    SELECT m.*, u.display_name as sender_name, u.avatar_color as sender_color, u.username as sender_username
    FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?
  `).get(msgId);

  // Get reply preview if replying
  let replyPreview = null;
  if (replyToId) {
    const replied = db.prepare(`
      SELECT m.encrypted_content, m.message_type, u.display_name as sender_name
      FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?
    `).get(replyToId);
    if (replied) replyPreview = { encryptedContent: replied.encrypted_content, type: replied.message_type, senderName: replied.sender_name };
  }

  res.json({
    id: msg.id,
    senderId: msg.sender_id,
    senderName: msg.sender_name,
    senderColor: msg.sender_color,
    senderUsername: msg.sender_username,
    encryptedContent: msg.encrypted_content,
    type: msg.message_type,
    replyToId: replyToId || null,
    replyPreview,
    createdAt: msg.created_at
  });
});

// Delete message
router.delete('/:id/messages/:msgId', authMiddleware, (req, res) => {
  const { deleteFor } = req.body; // 'me' or 'everyone'
  const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?').get(req.params.msgId, req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });

  const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  if (deleteFor === 'everyone') {
    // Only sender can delete for everyone
    if (msg.sender_id !== req.user.id) return res.status(403).json({ error: 'Only sender can delete for everyone' });
    db.prepare('UPDATE messages SET is_deleted = 1, encrypted_content = ? WHERE id = ?').run('', req.params.msgId);
  } else {
    // Delete for me — store in a hidden_by field
    const existing = msg.hidden_by ? JSON.parse(msg.hidden_by) : [];
    if (!existing.includes(req.user.id)) existing.push(req.user.id);
    db.prepare('UPDATE messages SET hidden_by = ? WHERE id = ?').run(JSON.stringify(existing), req.params.msgId);
  }

  res.json({ success: true, deleteFor });
});

// Upload media
router.post('/:id/media', authMiddleware, upload.single('file'), (req, res) => {
  const member = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  if (!req.file) return res.status(400).json({ error: 'No file' });

  const msgId = uuidv4();
  const mediaUrl = `/media/${req.file.filename}`;
  const fileType = req.file.mimetype.startsWith('image') ? 'image' :
                   req.file.mimetype.startsWith('video') ? 'video' :
                   req.file.mimetype.startsWith('audio') ? 'audio' : 'file';

  db.prepare(`
    INSERT INTO messages (id, conversation_id, sender_id, encrypted_content, message_type, media_url, media_name, media_size)
    VALUES (?, ?, ?, '', ?, ?, ?, ?)
  `).run(msgId, req.params.id, req.user.id, fileType, mediaUrl, req.file.originalname, req.file.size);

  const msg = db.prepare(`
    SELECT m.*, u.display_name as sender_name, u.avatar_color as sender_color, u.username as sender_username
    FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?
  `).get(msgId);

  res.json({
    id: msg.id,
    senderId: msg.sender_id,
    senderName: msg.sender_name,
    senderColor: msg.sender_color,
    encryptedContent: '',
    type: msg.message_type,
    mediaUrl: msg.media_url,
    mediaName: msg.media_name,
    mediaSize: msg.media_size,
    createdAt: msg.created_at
  });
});

// Keep chat (prevent 24hr deletion)
router.post('/:id/keep', authMiddleware, (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    UPDATE conversation_members SET kept_chat = 1, kept_at = ? WHERE conversation_id = ? AND user_id = ?
  `).run(now, req.params.id, req.user.id);

  // Check if both kept
  const members = db.prepare('SELECT kept_chat FROM conversation_members WHERE conversation_id = ?').all(req.params.id);
  const bothKept = members.every(m => m.kept_chat === 1);

  if (bothKept) {
    db.prepare('UPDATE conversations SET is_permanent = 1, expires_at = NULL WHERE id = ?').run(req.params.id);
  }

  res.json({ success: true, isPermanent: bothKept });
});

// Mute/unmute conversation
router.put('/:id/mute', authMiddleware, (req, res) => {
  const { muted } = req.body;
  db.prepare('UPDATE conversation_members SET is_muted = ? WHERE conversation_id = ? AND user_id = ?').run(muted ? 1 : 0, req.params.id, req.user.id);
  res.json({ success: true });
});

// Delete conversation
router.delete('/:id', authMiddleware, (req, res) => {
  const member = db.prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  const convo = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);

  if (convo.type === 'group' && member.role !== 'admin') {
    // Just leave the group
    db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  } else {
    // Delete everything
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(req.params.id);
    db.prepare('DELETE FROM conversation_members WHERE conversation_id = ?').run(req.params.id);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);
  }

  res.json({ success: true });
});

// Set/remove chat lock
router.put('/:id/lock', authMiddleware, async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { enabled, password } = req.body;

  if (enabled && password) {
    const hash = await bcrypt.hash(password, 10);
    db.prepare('UPDATE conversation_members SET chat_lock_enabled = 1, chat_lock_hash = ? WHERE conversation_id = ? AND user_id = ?').run(hash, req.params.id, req.user.id);
  } else {
    db.prepare('UPDATE conversation_members SET chat_lock_enabled = 0, chat_lock_hash = NULL WHERE conversation_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  }
  res.json({ success: true });
});

// Verify chat lock
router.post('/:id/lock/verify', authMiddleware, async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { password } = req.body;
  const member = db.prepare('SELECT chat_lock_hash FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  const valid = await bcrypt.compare(password, member?.chat_lock_hash || '');
  res.json({ valid });
});

// Set note
router.put('/:id/note', authMiddleware, (req, res) => {
  const { note } = req.body;
  db.prepare('UPDATE conversation_members SET note = ? WHERE conversation_id = ? AND user_id = ?').run(note || null, req.params.id, req.user.id);
  res.json({ success: true });
});

// Get group members
router.get('/:id/members', authMiddleware, (req, res) => {
  const member = db.prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Access denied' });

  const members = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_color, u.is_online, u.last_seen, cm.role, cm.joined_at
    FROM conversation_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = ?
    ORDER BY cm.role ASC, cm.joined_at ASC
  `).all(req.params.id);

  res.json(members.map(m => ({
    id: m.id,
    username: m.username,
    displayName: m.display_name,
    avatarColor: m.avatar_color,
    isOnline: !!m.is_online,
    lastSeen: m.last_seen,
    role: m.role,
    joinedAt: m.joined_at
  })));
});

// Add member to group (admin or co-admin)
router.post('/:id/members', authMiddleware, (req, res) => {
  const { userId } = req.body;
  const member = db.prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!member || (member.role !== 'admin' && member.role !== 'co-admin')) {
    return res.status(403).json({ error: 'Only admin or co-admin can add members' });
  }

  db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, \'member\')').run(req.params.id, userId);
  res.json({ success: true });
});

// Remove member (admin only)
router.delete('/:id/members/:userId', authMiddleware, (req, res) => {
  const member = db.prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!member || member.role !== 'admin') {
    return res.status(403).json({ error: 'Only admin can remove members' });
  }

  db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(req.params.id, req.params.userId);
  res.json({ success: true });
});

// Change member role (admin only)
router.put('/:id/members/:userId/role', authMiddleware, (req, res) => {
  const { role } = req.body;
  const member = db.prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!member || member.role !== 'admin') {
    return res.status(403).json({ error: 'Only admin can change roles' });
  }

  if (!['member', 'co-admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

  db.prepare('UPDATE conversation_members SET role = ? WHERE conversation_id = ? AND user_id = ?').run(role, req.params.id, req.params.userId);
  res.json({ success: true });
});

module.exports = router;
