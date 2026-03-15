# TKO — Texting Kept Ours

> A private, end-to-end encrypted messaging app you host yourself. No third parties. No ads. No one else can read your chats — not even the server.

---

## Why TKO?

Most messaging apps ask you to trust a company you've never met. TKO is different — you run the server yourself, on your own machine. Your messages are encrypted before they leave your device and can only be decrypted by the person you're talking to. The server is yours, the data is yours, the trust is yours.

---

## Features

- 🔐 **End-to-end encryption** — RSA-2048 + AES-256-GCM hybrid encryption via Web Crypto API
- 💬 **1-on-1 and group chats** — with admin, co-admin, and member roles
- 📎 **Media sharing** — photos, videos, audio, files
- 🔔 **Chat requests** — accept or decline before anyone can message you
- ⏱ **24-hour auto-delete window** — new chats are deleted unless both users choose to keep them
- 🚫 **Auto-block** — after 2 rejections, the user is automatically blocked
- 👁 **Privacy controls** — hide your last seen, online status, profile photo, and discoverability
- 🔒 **App lock & chat lock** — password protection at the app level and per individual chat
- 📝 **Per-chat private notes** — only you can see them
- 🔇 **Mute** — per chat and per group
- 📱 **PWA** — installable on Android and iOS home screens like a native app
- ⚡ **Real-time** — typing indicators, online status, message delivery ticks

---

## How the encryption works

- On registration, a **RSA-2048 key pair** is generated on your device using the browser's Web Crypto API
- Your **public key** is stored on the server
- Your **private key** is encrypted with your password (PBKDF2 + AES-GCM) and stored only on your device
- Messages use **hybrid encryption** — AES-256 encrypts the content, RSA encrypts the AES key for each recipient
- The server only ever stores encrypted blobs — it has no ability to read your messages
- **Your password is your key.** If you lose it, messages cannot be recovered

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React, PWA |
| Backend | Node.js, Express |
| Real-time | Socket.io |
| Encryption | Web Crypto API (built into browsers) |
| Database | SQLite (via better-sqlite3) |
| Auth | JWT + bcrypt |

---

## Self-Hosting Guide

### Requirements

- Node.js v18+
- npm

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/tko.git
cd tko

# 2. Set up the backend
cd backend
npm install
copy .env.example .env    # Windows
# cp .env.example .env    # Mac/Linux

# Open .env and set a strong JWT_SECRET

# 3. Build the frontend
cd ../frontend
npm install
npm run build

# 4. Start the server
cd ../backend
npm start
```

Open `http://localhost:3001` — TKO is running.

---

### Sharing with friends outside your network

TKO works great with [ngrok](https://ngrok.com) for exposing your local server:

```bash
ngrok http 3001
```

Share the generated `https://` URL. That single URL serves both the app and the API.

Friends can install it as a PWA:
- **Android** — Chrome menu → Add to Home Screen
- **iPhone** — Safari Share → Add to Home Screen

---

## Project Structure

```
tko/
├── backend/
│   ├── server.js          # Express + Socket.io server
│   ├── db/database.js     # SQLite schema and init
│   ├── routes/
│   │   ├── auth.js        # Register, login, logout
│   │   ├── users.js       # Profile, privacy, app lock
│   │   ├── requests.js    # Chat requests, cooldowns, auto-block
│   │   └── conversations.js # Messages, groups, media, chat lock
│   └── middleware/auth.js # JWT middleware
│
└── frontend/
    ├── public/            # PWA manifest, service worker
    └── src/
        ├── crypto/        # Web Crypto API E2E encryption
        ├── context/       # Global app state + socket
        └── screens/       # All UI screens
```

---

## Important Notes

- This is a **self-hosted** app — you are responsible for your own server security
- Keep your `.env` file private and never commit it to git
- The `backend/media/` and `backend/tko.db` folders contain user data — keep them backed up and secure
- For production use, consider setting up HTTPS directly instead of relying on ngrok

---

## License

MIT — use it, modify it, host it, share it. Just don't sell it as your own closed-source product.

---

*Built because your conversations should belong to you.*
