const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'tko.db');

const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initializeDatabase() {
  db.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_color TEXT DEFAULT '#2B5EE8',
      public_key TEXT,
      encrypted_private_key TEXT,
      username_changes INTEGER DEFAULT 0,
      username_last_changed INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      last_seen INTEGER DEFAULT (unixepoch()),
      is_online INTEGER DEFAULT 0,

      -- Privacy settings
      privacy_last_seen TEXT DEFAULT 'everyone',
      privacy_online_status TEXT DEFAULT 'everyone',
      privacy_discoverable INTEGER DEFAULT 1,
      privacy_pfp TEXT DEFAULT 'everyone',

      -- App lock
      app_lock_enabled INTEGER DEFAULT 0,
      app_lock_hash TEXT,
      chat_lock_enabled INTEGER DEFAULT 0
    );

    -- Chat requests table
    CREATE TABLE IF NOT EXISTS chat_requests (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL,
      to_user_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at INTEGER DEFAULT (unixepoch()),
      responded_at INTEGER,
      FOREIGN KEY (from_user_id) REFERENCES users(id),
      FOREIGN KEY (to_user_id) REFERENCES users(id)
    );

    -- Conversations table
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      type TEXT DEFAULT 'direct',
      name TEXT,
      avatar_color TEXT DEFAULT '#2B5EE8',
      created_by TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      expires_at INTEGER,
      is_permanent INTEGER DEFAULT 0,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    -- Conversation members
    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at INTEGER DEFAULT (unixepoch()),
      kept_chat INTEGER DEFAULT 0,
      kept_at INTEGER,
      is_muted INTEGER DEFAULT 0,
      chat_lock_enabled INTEGER DEFAULT 0,
      chat_lock_hash TEXT,
      note TEXT,
      PRIMARY KEY (conversation_id, user_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Messages table
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      encrypted_content TEXT NOT NULL,
      message_type TEXT DEFAULT 'text',
      media_url TEXT,
      media_name TEXT,
      media_size INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      is_deleted INTEGER DEFAULT 0,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (sender_id) REFERENCES users(id)
    );

    -- Message status table
    CREATE TABLE IF NOT EXISTS message_status (
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT DEFAULT 'delivered',
      updated_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (message_id, user_id),
      FOREIGN KEY (message_id) REFERENCES messages(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Blocked users
    CREATE TABLE IF NOT EXISTS blocked_users (
      blocker_id TEXT NOT NULL,
      blocked_id TEXT NOT NULL,
      blocked_at INTEGER DEFAULT (unixepoch()),
      reason TEXT DEFAULT 'auto',
      PRIMARY KEY (blocker_id, blocked_id),
      FOREIGN KEY (blocker_id) REFERENCES users(id),
      FOREIGN KEY (blocked_id) REFERENCES users(id)
    );

    -- Request history for cooldown/auto-block tracking
    CREATE TABLE IF NOT EXISTS request_history (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL,
      to_user_id TEXT NOT NULL,
      outcome TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (from_user_id) REFERENCES users(id),
      FOREIGN KEY (to_user_id) REFERENCES users(id)
    );

    -- Notifications
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT,
      is_read INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  console.log('✅ Database initialized');

  // Migrations — add new columns to existing databases safely
  const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!cols.includes('encrypted_private_key')) {
    db.exec('ALTER TABLE users ADD COLUMN encrypted_private_key TEXT');
    console.log('✅ Migration: added encrypted_private_key column');
  }

  const msgCols = db.prepare("PRAGMA table_info(messages)").all().map(c => c.name);
  if (!msgCols.includes('reply_to_id')) {
    db.exec('ALTER TABLE messages ADD COLUMN reply_to_id TEXT');
    console.log('✅ Migration: added reply_to_id column');
  }
  if (!msgCols.includes('hidden_by')) {
    db.exec('ALTER TABLE messages ADD COLUMN hidden_by TEXT');
    console.log('✅ Migration: added hidden_by column');
  }
}

initializeDatabase();

module.exports = db;
