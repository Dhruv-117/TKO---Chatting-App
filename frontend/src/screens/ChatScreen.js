import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { decryptMessage, encryptForRecipients } from '../crypto/encryption';

export default function ChatScreen({ conversation, onBack, onOpenInfo }) {
  const { user, setUser, privateKeyB64, API, socket, unlockedChats, unlockChat, setConversations } = useApp();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [decryptedMessages, setDecryptedMessages] = useState({});
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [groupMembers, setGroupMembers] = useState([]);
  const [showLockModal, setShowLockModal] = useState(false);
  const [lockPassword, setLockPassword] = useState('');
  const [lockError, setLockError] = useState('');
  const [expiryDisplay, setExpiryDisplay] = useState('');
  const [recipientPublicKey, setRecipientPublicKey] = useState(conversation.otherUser?.publicKey || null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);

  const isLocked = conversation.chatLockEnabled && !unlockedChats.has(conversation.id);
  const otherUser = conversation.otherUser;
  const isGroup = conversation.type === 'group';

  useEffect(() => {
    if (!isLocked) {
      if (isGroup) {
        // Group: load members and messages in parallel
        loadGroupMembers();
        loadMessages(privateKeyB64);
      } else {
        // Direct: fetch recipient key FIRST, then load and decrypt messages
        fetchRecipientKeyThenLoad();
      }
    }
  }, [conversation.id, isLocked]);

  // Re-decrypt when private key arrives (covers re-login race condition)
  useEffect(() => {
    const key = privateKeyB64 || sessionStorage.getItem('tko_private_key');
    if (key && messages.length > 0) {
      redecryptAll(key);
    }
  }, [privateKeyB64, messages.length]);

  const redecryptAll = async (keyB64) => {
    const userId = user?.id;
    const key = keyB64
      || (userId && localStorage.getItem(`tko_privkey_${userId}`))
      || sessionStorage.getItem('tko_private_key');
    if (!key) return;
    const decrypted = {};
    for (const msg of messages) {
      if (msg.encryptedContent) {
        decrypted[msg.id] = await decryptMessage(msg.encryptedContent, key, user.id);
      }
    }
    setDecryptedMessages(prev => ({ ...prev, ...decrypted }));
  };

  const fetchRecipientKeyThenLoad = async () => {
    // Fetch key first so it's ready before messages are decrypted
    await fetchRecipientKey();
    await loadMessages(privateKeyB64);
  };

  const fetchRecipientKey = async () => {
    if (!otherUser?.id) return;
    try {
      const res = await API.get(`/users/key/${otherUser.id}`);
      if (res.data?.publicKey) {
        setRecipientPublicKey(res.data.publicKey);
        setConversations(prev => prev.map(c =>
          c.id === conversation.id
            ? { ...c, otherUser: { ...c.otherUser, publicKey: res.data.publicKey } }
            : c
        ));
      }
    } catch (e) {
      console.error('Could not fetch recipient public key:', e);
    }
  };

  // Expiry countdown
  useEffect(() => {
    if (!conversation.expiresAt || conversation.isPermanent) return;
    const update = () => {
      const secs = conversation.expiresAt - Math.floor(Date.now() / 1000);
      if (secs <= 0) { setExpiryDisplay(''); return; }
      if (secs < 3600) setExpiryDisplay(`${Math.ceil(secs / 60)} min left`);
      else setExpiryDisplay(`${Math.ceil(secs / 3600)} hrs left`);
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [conversation.expiresAt, conversation.isPermanent]);

  // Socket events
  useEffect(() => {
    const s = socket.current;
    if (!s) return;

    const handleNewMsg = async ({ conversationId, message }) => {
      if (conversationId !== conversation.id) return;
      setMessages(prev => {
        if (prev.find(m => m.id === message.id)) return prev;
        return [...prev, message];
      });
      if (message.encryptedContent && privateKeyB64) {
        const decrypted = await decryptMessage(message.encryptedContent, privateKeyB64, user.id);
        setDecryptedMessages(prev => ({ ...prev, [message.id]: decrypted }));
      }
    };

    const handleTyping = ({ userId: tid, conversationId, isTyping }) => {
      if (conversationId !== conversation.id || tid === user.id) return;
      setTypingUsers(prev => {
        const next = new Set(prev);
        isTyping ? next.add(tid) : next.delete(tid);
        return next;
      });
    };

    s.on('new_message', handleNewMsg);
    s.on('user_typing', handleTyping);
    return () => { s.off('new_message', handleNewMsg); s.off('user_typing', handleTyping); };
  }, [conversation.id, privateKeyB64]);

  const loadMessages = async (keyB64) => {
    setLoading(true);
    // Get key from: passed param → React state → localStorage (survives browser close)
    const userId = user?.id;
    const key = keyB64
      || privateKeyB64
      || (userId && localStorage.getItem(`tko_privkey_${userId}`))
      || sessionStorage.getItem('tko_private_key'); // legacy fallback
    try {
      const res = await API.get(`/conversations/${conversation.id}/messages`);
      setMessages(res.data);
      if (key) {
        const decrypted = {};
        for (const msg of res.data) {
          if (msg.encryptedContent) {
            decrypted[msg.id] = await decryptMessage(msg.encryptedContent, key, user.id);
          }
        }
        setDecryptedMessages(decrypted);
      }
    } finally {
      setLoading(false);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  };

  const loadGroupMembers = async () => {
    const res = await API.get(`/conversations/${conversation.id}/members`);
    setGroupMembers(res.data);
  };

  const sendMessage = async () => {
    if (!input.trim()) return;
    const text = input.trim();
    setInput('');

    try {
      let encrypted;

      // Safety: fetch own public key if missing (happens after register before re-login)
      let myPublicKey = user.publicKey;
      if (!myPublicKey) {
        try {
          const me = await API.get('/auth/me');
          myPublicKey = me.data.publicKey;
          // Update stored user
          setConversations && setUser && setUser({ publicKey: myPublicKey });
        } catch {}
      }

      if (isGroup) {
        const keys = {};
        for (const m of groupMembers) {
          if (m.publicKey) keys[m.id] = m.publicKey;
        }
        if (myPublicKey) keys[user.id] = myPublicKey;
        encrypted = await encryptForRecipients(text, keys);

      } else {
        if (!recipientPublicKey) {
          try {
            const res = await API.get(`/users/key/${otherUser.id}`);
            if (res.data?.publicKey) setRecipientPublicKey(res.data.publicKey);
            else { alert('Could not get recipient key. Try again.'); setInput(text); return; }
          } catch {
            alert('Could not reach server. Try again.');
            setInput(text); return;
          }
        }
        const keys = {
          [otherUser.id]: recipientPublicKey,
        };
        if (myPublicKey) keys[user.id] = myPublicKey;
        encrypted = await encryptForRecipients(text, keys);
      }

      const res = await API.post(`/conversations/${conversation.id}/messages`, {
        encryptedContent: encrypted,
        type: 'text'
      });

      const msg = res.data;
      setMessages(prev => [...prev, msg]);
      setDecryptedMessages(prev => ({ ...prev, [msg.id]: text }));
      socket.current?.emit('send_message', { conversationId: conversation.id, message: msg });
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e) {
      console.error('Send failed:', e);
      setInput(text);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await API.post(`/conversations/${conversation.id}/media`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const msg = res.data;
      setMessages(prev => [...prev, msg]);
      socket.current?.emit('send_message', { conversationId: conversation.id, message: msg });
    } catch (e) { console.error(e); }
  };

  const handleTyping = (val) => {
    setInput(val);
    socket.current?.emit('typing', { conversationId: conversation.id, isTyping: true });
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.current?.emit('typing', { conversationId: conversation.id, isTyping: false });
    }, 2000);
  };

  const verifyLock = async () => {
    setLockError('');
    try {
      const res = await API.post(`/conversations/${conversation.id}/lock/verify`, { password: lockPassword });
      if (res.data.valid) {
        unlockChat(conversation.id);
        setShowLockModal(false);
        loadMessages();
        if (isGroup) loadGroupMembers();
      } else {
        setLockError('Incorrect password');
      }
    } catch { setLockError('Error verifying password'); }
  };

  const getInitials = (name) => name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
  const formatTime = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const getStatusTick = (msg) => msg.senderId === user.id ? '✓✓' : '';

  const headerName = isGroup ? conversation.name : otherUser?.displayName;
  const headerColor = isGroup ? conversation.avatarColor : otherUser?.avatarColor;
  const headerStatus = isGroup
    ? `${conversation.memberCount || groupMembers.length} members`
    : otherUser?.isOnline ? 'Online' : otherUser?.lastSeen ? `Last seen ${formatDistanceToNow(otherUser.lastSeen * 1000)}` : '';

  // Chat lock modal
  if (isLocked) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <button className="btn-icon" onClick={onBack}><span>←</span></button>
          <div style={styles.headerInfo}>
            <div className="avatar avatar-sm" style={{ background: headerColor }}>{getInitials(headerName)}</div>
            <span style={styles.headerName}>{headerName}</span>
          </div>
        </div>
        <div style={styles.lockScreen}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginBottom: 8 }}>Chat Locked</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>Enter password to unlock</div>
          {lockError && <div style={styles.lockError}>{lockError}</div>}
          <input type="password" placeholder="Enter chat password" value={lockPassword}
            onChange={e => setLockPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && verifyLock()}
            style={{ maxWidth: 280, marginBottom: 12 }} />
          <button className="btn-primary" style={{ maxWidth: 280, width: '100%' }} onClick={verifyLock}>Unlock</button>
          <button className="btn-ghost" style={{ maxWidth: 280, width: '100%', marginTop: 8 }} onClick={onBack}>Back</button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <button className="btn-icon" onClick={onBack}><span style={{ fontSize: 20 }}>←</span></button>
        <button style={styles.headerInfo} onClick={onOpenInfo}>
          <div className="avatar avatar-sm" style={{ background: headerColor }}>
            {getInitials(headerName)}
            {!isGroup && otherUser?.isOnline && <div className="online-dot" />}
          </div>
          <div>
            <div style={styles.headerName}>{headerName}</div>
            {headerStatus && <div style={styles.headerStatus}>{headerStatus}</div>}
          </div>
        </button>
        <div style={{ display: 'flex', gap: 4 }}>
          {expiryDisplay && !conversation.keptChat && (
            <span style={styles.expiryChip}>{expiryDisplay}</span>
          )}
          <button className="btn-icon" onClick={onOpenInfo}><span>⋮</span></button>
        </div>
      </div>

      {/* Messages */}
      <div style={styles.messages}>
        {loading ? (
          <div style={styles.loadingMsg}>Loading messages...</div>
        ) : messages.length === 0 ? (
          <div style={styles.emptyMsg}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔐</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Messages are end-to-end encrypted</div>
          </div>
        ) : (
          messages.map((msg, i) => {
            const isMine = msg.senderId === user.id;
            const decrypted = decryptedMessages[msg.id];
            const showAvatar = isGroup && !isMine && (i === 0 || messages[i-1]?.senderId !== msg.senderId);
            const showName = isGroup && !isMine && showAvatar;

            return (
              <div key={msg.id} style={{ ...styles.msgRow, justifyContent: isMine ? 'flex-end' : 'flex-start' }}
                className="fade-in">
                {isGroup && !isMine && (
                  <div style={{ width: 28, flexShrink: 0, alignSelf: 'flex-end' }}>
                    {showAvatar && (
                      <div className="avatar" style={{ width: 28, height: 28, fontSize: 10, background: msg.senderColor || 'var(--accent)', flexShrink: 0 }}>
                        {getInitials(msg.senderName)}
                      </div>
                    )}
                  </div>
                )}
                <div style={{ maxWidth: '72%' }}>
                  {showName && <div style={{ ...styles.senderName, color: msg.senderColor || 'var(--accent)' }}>{msg.senderName}</div>}
                  <div style={{ ...styles.bubble, background: isMine ? 'var(--accent-dim)' : 'var(--bg-card)', borderRadius: isMine ? '16px 16px 4px 16px' : '16px 16px 16px 4px', border: isMine ? 'none' : '1px solid var(--border)' }}>
                    {msg.type === 'text' && (
                      <span style={{ fontSize: 14, lineHeight: 1.5 }}>
                        {decrypted || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>🔐 Encrypted</span>}
                      </span>
                    )}
                    {msg.type === 'image' && (
                      <img src={`${msg.mediaUrl}?t=${localStorage.getItem('tko_token')}`}
                        alt="img"
                        style={{ maxWidth: '100%', borderRadius: 10, display: 'block' }}
                        onError={e => e.target.style.display='none'}
                      />
                    )}
                    {msg.type === 'video' && (
                      <video controls style={{ maxWidth: '100%', borderRadius: 10 }}>
                        <source src={`${msg.mediaUrl}?t=${localStorage.getItem('tko_token')}`} />
                      </video>
                    )}
                    {msg.type === 'audio' && (
                      <audio controls style={{ width: '100%' }}>
                        <source src={`${msg.mediaUrl}?t=${localStorage.getItem('tko_token')}`} />
                      </audio>
                    )}
                    {msg.type === 'file' && (
                      <a href={`${msg.mediaUrl}?t=${localStorage.getItem('tko_token')}`}
                        download={msg.mediaName}
                        style={{ color: 'var(--accent-bright)', fontSize: 13 }}>
                        📎 {msg.mediaName}
                      </a>
                    )}
                    <div style={styles.msgMeta}>
                      <span style={styles.msgTime}>{formatTime(msg.createdAt)}</span>
                      {isMine && <span style={{ color: 'var(--accent-bright)', fontSize: 11 }}>✓✓</span>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}

        {typingUsers.size > 0 && (
          <div style={{ ...styles.msgRow, justifyContent: 'flex-start' }}>
            <div style={{ ...styles.bubble, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>typing<span style={{ animation: 'pulse 1s infinite' }}>...</span></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div style={styles.inputBar}>
        <button className="btn-icon" onClick={() => fileInputRef.current?.click()}>
          <span style={{ fontSize: 20 }}>📎</span>
        </button>
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
          onChange={handleFileUpload}
        />
        <input
          type="text"
          placeholder="Message..."
          value={input}
          onChange={e => handleTyping(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
          style={styles.msgInput}
        />
        <button
          style={{ ...styles.sendBtn, background: input.trim() ? 'var(--accent)' : 'var(--bg-card)', color: input.trim() ? 'white' : 'var(--text-muted)' }}
          onClick={sendMessage}
          disabled={!input.trim()}>
          {input.trim() ? '➤' : '🎤'}
        </button>
      </div>
    </div>
  );
}

function formatDistanceToNow(ms) {
  const diff = Date.now() - ms;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
  return `${Math.floor(diff/86400000)}d ago`;
}

const styles = {
  container: { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-deep)', overflow: 'hidden' },
  header: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px',
    background: 'var(--bg-panel)', borderBottom: '1px solid var(--divider)',
    boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
  },
  headerInfo: { display: 'flex', alignItems: 'center', gap: 10, flex: 1, background: 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'left' },
  headerName: { fontWeight: '600', fontSize: 15, color: 'var(--text-primary)', fontFamily: 'var(--font-body)' },
  headerStatus: { fontSize: 11, color: 'var(--online)' },
  expiryChip: {
    background: 'rgba(201,162,39,0.12)', color: 'var(--gold)', fontSize: 11,
    padding: '4px 10px', borderRadius: 'var(--radius-full)', border: '1px solid var(--gold-dim)',
    whiteSpace: 'nowrap', alignSelf: 'center',
  },
  messages: { flex: 1, overflowY: 'auto', padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 6 },
  msgRow: { display: 'flex', alignItems: 'flex-end', gap: 8 },
  bubble: { padding: '10px 14px', maxWidth: '100%', wordBreak: 'break-word' },
  senderName: { fontSize: 11, fontWeight: '600', marginBottom: 3, paddingLeft: 2 },
  msgMeta: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 4 },
  msgTime: { color: 'rgba(255,255,255,0.3)', fontSize: 10 },
  loadingMsg: { color: 'var(--text-muted)', textAlign: 'center', padding: 40 },
  emptyMsg: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: 40, textAlign: 'center' },
  inputBar: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
    background: 'var(--bg-panel)', borderTop: '1px solid var(--divider)',
  },
  msgInput: {
    flex: 1, background: 'var(--bg-card)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-full)', padding: '10px 16px', fontSize: 14,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: '50%', fontSize: 16,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, transition: 'all 0.18s ease',
  },
  lockScreen: {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', padding: 40, textAlign: 'center',
  },
  lockError: {
    background: 'rgba(239,68,68,0.1)', color: '#f87171', padding: '8px 16px',
    borderRadius: 'var(--radius-md)', fontSize: 13, marginBottom: 12,
  },
};
