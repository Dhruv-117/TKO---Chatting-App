const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const db = require('../db/database');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth');

// Email transporter — configure in .env
function getTransporter() {
  return nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

async function sendWelcomeEmail(toEmail, displayName) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return; // Skip if not configured
  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"TKO" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: 'Welcome to TKO 🌟',
      html: `
        <div style="font-family: sans-serif; background: #050709; color: #e2e8f4; padding: 40px; max-width: 500px; margin: 0 auto; border-radius: 16px;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="font-size: 42px; letter-spacing: 8px; color: #4070f4; margin: 0;">TKO</h1>
            <p style="color: #7a8fa8; font-size: 12px; letter-spacing: 3px; text-transform: uppercase; margin: 4px 0 0;">Texting Kept Ours</p>
          </div>
          <h2 style="color: #e2e8f4; font-size: 22px;">Hey ${displayName} 👋</h2>
          <p style="color: #7a8fa8; line-height: 1.7;">
            Welcome to TKO. Your account is ready and your messages are end-to-end encrypted from day one.
          </p>
          <p style="color: #7a8fa8; line-height: 1.7;">
            No one — not even the server — can read your conversations. That's the whole point.
          </p>
          <div style="background: #111927; border: 1px solid rgba(43,94,232,0.2); border-radius: 12px; padding: 20px; margin: 24px 0;">
            <p style="color: #4070f4; font-weight: 600; margin: 0 0 8px;">A reminder:</p>
            <p style="color: #7a8fa8; margin: 0; font-size: 13px; line-height: 1.6;">
              Your password encrypts your messages. If you forget it, your messages cannot be recovered. Keep it safe.
            </p>
          </div>
          <p style="color: #4a5a70; font-size: 12px; text-align: center; margin-top: 32px;">
            This is an automated message. Your conversations belong only to you.
          </p>
        </div>
      `,
    });
  } catch (err) {
    console.log('Email send failed (non-critical):', err.message);
  }
}

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, username, displayName, password, publicKey } = req.body;

    if (!email || !username || !displayName || !password) {
      return res.status(400).json({ error: 'All fields required' });
    }

    // Validate username format
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-20 chars, letters/numbers/underscore only' });
    }

    // Check existing
    const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existingEmail) return res.status(400).json({ error: 'Email already registered' });

    const existingUsername = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase());
    if (existingUsername) return res.status(400).json({ error: 'Username already taken' });

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = uuidv4();

    // Random avatar color from a set of nice colors
    const colors = ['#2B5EE8', '#1a9e4a', '#e84393', '#e87c2b', '#7c2be8', '#2be8d4'];
    const avatarColor = colors[Math.floor(Math.random() * colors.length)];

    db.prepare(`
      INSERT INTO users (id, email, username, display_name, password_hash, avatar_color, public_key)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, email.toLowerCase(), username.toLowerCase(), displayName, passwordHash, avatarColor, publicKey || null);

    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });

    // Send welcome email (non-blocking)
    sendWelcomeEmail(email.toLowerCase(), displayName);

    // Return same camelCase format as login
    const safeUser = {
      id: userId,
      email: email.toLowerCase(),
      username: username.toLowerCase(),
      displayName,
      avatarColor,
      publicKey: publicKey || null,
      usernameChanges: 0,
      privacyLastSeen: 'everyone',
      privacyOnlineStatus: 'everyone',
      privacyDiscoverable: 1,
      privacyPfp: 'everyone',
      appLockEnabled: 0,
    };

    res.json({ token, user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(400).json({ error: 'Invalid credentials' });

    // Update online status
    db.prepare('UPDATE users SET is_online = 1, last_seen = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), user.id);

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });

    const safeUser = {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.display_name,
      avatarColor: user.avatar_color,
      publicKey: user.public_key,
      usernameChanges: user.username_changes,
      privacyLastSeen: user.privacy_last_seen,
      privacyOnlineStatus: user.privacy_online_status,
      privacyDiscoverable: user.privacy_discoverable,
      privacyPfp: user.privacy_pfp,
      appLockEnabled: user.app_lock_enabled
    };

    res.json({ token, user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get current user
router.get('/me', authMiddleware, (req, res) => {
  const user = req.user;
  res.json({
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.display_name,
    avatarColor: user.avatar_color,
    publicKey: user.public_key,
    usernameChanges: user.username_changes,
    privacyLastSeen: user.privacy_last_seen,
    privacyOnlineStatus: user.privacy_online_status,
    privacyDiscoverable: user.privacy_discoverable,
    privacyPfp: user.privacy_pfp,
    appLockEnabled: user.app_lock_enabled
  });
});

// Update public key
router.post('/update-key', authMiddleware, (req, res) => {
  const { publicKey } = req.body;
  db.prepare('UPDATE users SET public_key = ? WHERE id = ?').run(publicKey, req.user.id);
  res.json({ success: true });
});

// Save encrypted private key to server
// Safe — it's encrypted with user's password, server cannot decrypt it
router.post('/save-key', authMiddleware, (req, res) => {
  const { encryptedPrivateKey } = req.body;
  if (!encryptedPrivateKey) return res.status(400).json({ error: 'No key provided' });
  db.prepare('UPDATE users SET encrypted_private_key = ? WHERE id = ?').run(
    JSON.stringify(encryptedPrivateKey), req.user.id
  );
  res.json({ success: true });
});

// Fetch encrypted private key — used when logging in from a new device
router.get('/my-key', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT encrypted_private_key FROM users WHERE id = ?').get(req.user.id);
  if (!user?.encrypted_private_key) return res.status(404).json({ error: 'No key stored' });
  try {
    res.json({ encryptedPrivateKey: JSON.parse(user.encrypted_private_key) });
  } catch {
    res.status(500).json({ error: 'Key data corrupted' });
  }
});

// Logout
router.post('/logout', authMiddleware, (req, res) => {
  db.prepare('UPDATE users SET is_online = 0, last_seen = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), req.user.id);
  res.json({ success: true });
});

module.exports = router;
