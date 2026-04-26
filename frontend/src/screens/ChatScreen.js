import React, { useState, useEffect, useRef } from 'react';
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
  const [lockPassword, setLockPassword] = useState('');
  const [lockError, setLockError] = useState('');
  const [expiryDisplay, setExpiryDisplay] = useState('');
  const [recipientPublicKey, setRecipientPublicKey] = useState(conversation.otherUser?.publicKey || null);
  const [replyTo, setReplyTo] = useState(null); // { id, senderName, text }
  const [msgMenu, setMsgMenu] = useState(null); // { msgId, isMine, x, y }
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);
  const messagesContainerRef = useRef(null);

  const isLocked = conversation.chatLockEnabled && !unlockedChats.has(conversation.id);
  const otherUser = conversation.otherUser;
  const isGroup = conversation.type === 'group';

  useEffect(() => {
    if (!isLocked) {
      if (isGroup) { loadGroupMembers(); loadMessages(privateKeyB64); }
      else { fetchRecipientKeyThenLoad(); }
    }
  }, [conversation.id, isLocked]);

  useEffect(() => {
    const key = privateKeyB64 || sessionStorage.getItem('tko_private_key');
    if (key && messages.length > 0) redecryptAll(key);
  }, [privateKeyB64, messages.length]);

  // Close msg menu on outside click
  useEffect(() => {
    const handler = () => setMsgMenu(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const redecryptAll = async (keyB64) => {
    const userId = user?.id;
    const key = keyB64 || (userId && localStorage.getItem(`tko_privkey_${userId}`)) || sessionStorage.getItem('tko_private_key');
    if (!key) return;
    const decrypted = {};
    for (const msg of messages) {
      if (msg.encryptedContent) decrypted[msg.id] = await decryptMessage(msg.encryptedContent, key, user.id);
    }
    setDecryptedMessages(prev => ({ ...prev, ...decrypted }));
  };

  const fetchRecipientKeyThenLoad = async () => {
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
          c.id === conversation.id ? { ...c, otherUser: { ...c.otherUser, publicKey: res.data.publicKey } } : c
        ));
      }
    } catch (e) { console.error('Could not fetch recipient public key:', e); }
  };

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

  useEffect(() => {
    const s = socket.current;
    if (!s) return;
    const handleNewMsg = async ({ conversationId, message }) => {
      if (conversationId !== conversation.id) return;
      setMessages(prev => { if (prev.find(m => m.id === message.id)) return prev; return [...prev, message]; });
      const key = privateKeyB64 || localStorage.getItem(`tko_privkey_${user.id}`) || sessionStorage.getItem('tko_private_key');
      if (message.encryptedContent && key) {
        const decrypted = await decryptMessage(message.encryptedContent, key, user.id);
        setDecryptedMessages(prev => ({ ...prev, [message.id]: decrypted }));
      }
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    };
    const handleTyping = ({ userId: tid, conversationId, isTyping }) => {
      if (conversationId !== conversation.id || tid === user.id) return;
      setTypingUsers(prev => { const n = new Set(prev); isTyping ? n.add(tid) : n.delete(tid); return n; });
    };
    const handleMsgDeleted = ({ messageId, deleteFor }) => {
      if (deleteFor === 'everyone') setMessages(prev => prev.filter(m => m.id !== messageId));
      else if (deleteFor === 'me') setMessages(prev => prev.filter(m => m.id !== messageId));
    };
    s.on('new_message', handleNewMsg);
    s.on('user_typing', handleTyping);
    s.on('message_deleted', handleMsgDeleted);
    return () => { s.off('new_message', handleNewMsg); s.off('user_typing', handleTyping); s.off('message_deleted', handleMsgDeleted); };
  }, [conversation.id, privateKeyB64]);

  const loadMessages = async (keyB64) => {
    setLoading(true);
    const userId = user?.id;
    const key = keyB64 || privateKeyB64 || (userId && localStorage.getItem(`tko_privkey_${userId}`)) || sessionStorage.getItem('tko_private_key');
    try {
      const res = await API.get(`/conversations/${conversation.id}/messages`);
      setMessages(res.data);
      if (key) {
        const decrypted = {};
        for (const msg of res.data) {
          if (msg.encryptedContent) decrypted[msg.id] = await decryptMessage(msg.encryptedContent, key, user.id);
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
    const currentReplyTo = replyTo;
    setReplyTo(null);

    try {
      let myPublicKey = user.publicKey;
      if (!myPublicKey) {
        try { const me = await API.get('/auth/me'); myPublicKey = me.data.publicKey; setUser({ publicKey: myPublicKey }); } catch {}
      }

      let encrypted;
      if (isGroup) {
        const keys = {};
        for (const m of groupMembers) { if (m.publicKey) keys[m.id] = m.publicKey; }
        if (myPublicKey) keys[user.id] = myPublicKey;
        encrypted = await encryptForRecipients(text, keys);
      } else {
        if (!recipientPublicKey) {
          try {
            const res = await API.get(`/users/key/${otherUser.id}`);
            if (res.data?.publicKey) setRecipientPublicKey(res.data.publicKey);
            else { alert('Could not get recipient key. Try again.'); setInput(text); return; }
          } catch { alert('Could not reach server. Try again.'); setInput(text); return; }
        }
        const keys = { [otherUser.id]: recipientPublicKey };
        if (myPublicKey) keys[user.id] = myPublicKey;
        encrypted = await encryptForRecipients(text, keys);
      }

      const res = await API.post(`/conversations/${conversation.id}/messages`, {
        encryptedContent: encrypted, type: 'text',
        replyToId: currentReplyTo?.id || null,
      });

      const msg = { ...res.data, replyPreview: currentReplyTo ? { senderName: currentReplyTo.senderName, decryptedText: currentReplyTo.text } : null };
      setMessages(prev => [...prev, msg]);
      setDecryptedMessages(prev => ({ ...prev, [msg.id]: text }));
      socket.current?.emit('send_message', { conversationId: conversation.id, message: msg });
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e) { console.error('Send failed:', e); setInput(text); }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await API.post(`/conversations/${conversation.id}/media`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      const msg = res.data;
      setMessages(prev => [...prev, msg]);
      socket.current?.emit('send_message', { conversationId: conversation.id, message: msg });
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e) { console.error(e); }
  };

  const handleTyping = (val) => {
    setInput(val);
    socket.current?.emit('typing', { conversationId: conversation.id, isTyping: true });
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => socket.current?.emit('typing', { conversationId: conversation.id, isTyping: false }), 2000);
  };

  const verifyLock = async () => {
    setLockError('');
    try {
      const res = await API.post(`/conversations/${conversation.id}/lock/verify`, { password: lockPassword });
      if (res.data.valid) { unlockChat(conversation.id); loadMessages(); if (isGroup) loadGroupMembers(); }
      else setLockError('Incorrect password');
    } catch { setLockError('Error verifying password'); }
  };

  const deleteMessage = async (msgId, deleteFor) => {
    setMsgMenu(null);
    try {
      await API.delete(`/conversations/${conversation.id}/messages/${msgId}`, { data: { deleteFor } });
      if (deleteFor === 'everyone') {
        socket.current?.emit('message_deleted_broadcast', { conversationId: conversation.id, messageId: msgId, deleteFor });
      }
      setMessages(prev => prev.filter(m => m.id !== msgId));
      setDecryptedMessages(prev => { const n = { ...prev }; delete n[msgId]; return n; });
    } catch (e) { console.error(e); }
  };

  const handleLongPress = (e, msg, isMine) => {
    e.preventDefault();
    e.stopPropagation();
    setMsgMenu({ msgId: msg.id, isMine, msg });
  };

  const getInitials = (name) => name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
  const formatTime = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const headerName = isGroup ? conversation.name : otherUser?.displayName;
  const headerColor = isGroup ? conversation.avatarColor : otherUser?.avatarColor;
  const headerStatus = isGroup
    ? `${conversation.memberCount || groupMembers.length} members`
    : otherUser?.isOnline ? 'Online' : otherUser?.lastSeen ? `Last seen ${formatDistanceToNow(otherUser.lastSeen * 1000)}` : '';

  // Lock screen
  if (isLocked) {
    return (
      <div style={S.container}>
        <div style={S.header}>
          <button className="btn-icon" onClick={onBack}><span>←</span></button>
          <div style={S.headerInfo}>
            <div className="avatar avatar-sm" style={{ background: headerColor }}>{getInitials(headerName)}</div>
            <span style={S.headerName}>{headerName}</span>
          </div>
        </div>
        <div style={S.lockScreen}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginBottom: 8 }}>Chat Locked</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>Enter password to unlock</div>
          {lockError && <div style={S.lockError}>{lockError}</div>}
          <input type="password" placeholder="Enter chat password" value={lockPassword}
            onChange={e => setLockPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && verifyLock()}
            style={{ maxWidth: 280, marginBottom: 12 }} />
          <button className="btn-primary" style={{ maxWidth: 280, width: '100%' }} onClick={verifyLock}>Unlock</button>
          <button className="btn-ghost" style={{ maxWidth: 280, width: '100%', marginTop: 8 }} onClick={onBack}>Back</button>
        </div>
      </div>
    );
  }

  return (
    <div style={S.container} onClick={() => setMsgMenu(null)}>

      {/* Header — sticky at top always */}
      <div style={S.header}>
        <button className="btn-icon" onClick={onBack}><span style={{ fontSize: 20 }}>←</span></button>
        <button style={S.headerInfo} onClick={onOpenInfo}>
          <div className="avatar avatar-sm" style={{ background: headerColor }}>
            {getInitials(headerName)}
            {!isGroup && otherUser?.isOnline && <div className="online-dot" />}
          </div>
          <div>
            <div style={S.headerName}>{headerName}</div>
            {headerStatus && <div style={S.headerStatus}>{headerStatus}</div>}
          </div>
        </button>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {expiryDisplay && !conversation.keptChat && <span style={S.expiryChip}>{expiryDisplay}</span>}
          <button className="btn-icon" onClick={onOpenInfo}><span>⋮</span></button>
        </div>
      </div>

      {/* Messages — scrollable middle */}
      <div style={S.messages} ref={messagesContainerRef}>
        {loading ? (
          <div style={S.loadingMsg}>Loading messages...</div>
        ) : messages.length === 0 ? (
          <div style={S.emptyMsg}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔐</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Messages are end-to-end encrypted</div>
          </div>
        ) : (
          messages.map((msg, i) => {
            const isMine = msg.senderId === user.id;
            const decrypted = decryptedMessages[msg.id];
            const showAvatar = isGroup && !isMine && (i === 0 || messages[i-1]?.senderId !== msg.senderId);
            const showName = isGroup && !isMine && showAvatar;
            const replyPreviewText = msg.replyPreview
              ? (decryptedMessages[msg.replyToId] || msg.replyPreview?.decryptedText || (msg.replyPreview?.type !== 'text' ? `📎 ${msg.replyPreview.type}` : '🔐'))
              : null;

            return (
              <div key={msg.id} style={{ ...S.msgRow, justifyContent: isMine ? 'flex-end' : 'flex-start' }} className="fade-in">
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
                  {showName && <div style={{ ...S.senderName, color: msg.senderColor || 'var(--accent)' }}>{msg.senderName}</div>}
                  <div
                    style={{ ...S.bubble, background: isMine ? 'var(--accent-dim)' : 'var(--bg-card)', borderRadius: isMine ? '16px 16px 4px 16px' : '16px 16px 16px 4px', border: isMine ? 'none' : '1px solid var(--border)' }}
                    onContextMenu={e => handleLongPress(e, msg, isMine)}
                    onTouchStart={(() => { let t; return (e) => { t = setTimeout(() => handleLongPress(e.touches[0], msg, isMine), 500); }; })()}
                    onTouchEnd={() => clearTimeout()}
                  >
                    {/* Reply preview */}
                    {msg.replyToId && replyPreviewText !== null && (
                      <div style={S.replyPreview}>
                        <div style={S.replyBar} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={S.replyName}>{msg.replyPreview?.senderName}</div>
                          <div style={S.replyText}>{replyPreviewText}</div>
                        </div>
                      </div>
                    )}

                    {/* Message content */}
                    {msg.type === 'text' && (
                      <span style={{ fontSize: 14, lineHeight: 1.5 }}>
                        {decrypted || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>🔐 Encrypted</span>}
                      </span>
                    )}
                    {msg.type === 'image' && <img src={`${msg.mediaUrl}?t=${localStorage.getItem('tko_token')}`} alt="img" style={{ maxWidth: '100%', borderRadius: 10, display: 'block' }} onError={e => e.target.style.display='none'} />}
                    {msg.type === 'video' && <video controls style={{ maxWidth: '100%', borderRadius: 10 }}><source src={`${msg.mediaUrl}?t=${localStorage.getItem('tko_token')}`} /></video>}
                    {msg.type === 'audio' && <audio controls style={{ width: '100%' }}><source src={`${msg.mediaUrl}?t=${localStorage.getItem('tko_token')}`} /></audio>}
                    {msg.type === 'file' && <a href={`${msg.mediaUrl}?t=${localStorage.getItem('tko_token')}`} download={msg.mediaName} style={{ color: 'var(--accent-bright)', fontSize: 13 }}>📎 {msg.mediaName}</a>}

                    <div style={S.msgMeta}>
                      <span style={S.msgTime}>{formatTime(msg.createdAt)}</span>
                      {isMine && <span style={{ color: 'var(--accent-bright)', fontSize: 11 }}>✓✓</span>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}

        {typingUsers.size > 0 && (
          <div style={{ ...S.msgRow, justifyContent: 'flex-start' }}>
            <div style={{ ...S.bubble, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>typing...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply bar — shows above input when replying */}
      {replyTo && (
        <div style={S.replyBar2}>
          <div style={S.replyBarInner}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: 'var(--accent-bright)', fontSize: 11, fontWeight: 600, marginBottom: 2 }}>
                Replying to {replyTo.senderName}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {replyTo.text}
              </div>
            </div>
            <button className="btn-icon" style={{ fontSize: 16, flexShrink: 0 }} onClick={() => setReplyTo(null)}>✕</button>
          </div>
        </div>
      )}

      {/* Input bar — sticky at bottom always */}
      <div style={S.inputBar}>
        <button className="btn-icon" onClick={() => fileInputRef.current?.click()}>
          <span style={{ fontSize: 20 }}>📎</span>
        </button>
        <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*,video/*,audio/*,.pdf,.doc,.docx" onChange={handleFileUpload} />
        <input
          type="text" placeholder="Message..." value={input}
          onChange={e => handleTyping(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
          style={S.msgInput}
        />
        <button style={{ ...S.sendBtn, background: input.trim() ? 'var(--accent)' : 'var(--bg-card)', color: input.trim() ? 'white' : 'var(--text-muted)' }}
          onClick={sendMessage} disabled={!input.trim()}>
          {input.trim() ? '➤' : '🎤'}
        </button>
      </div>

      {/* Message context menu */}
      {msgMenu && (
        <div style={S.menuOverlay} onClick={() => setMsgMenu(null)}>
          <div style={S.contextMenu} onClick={e => e.stopPropagation()}>
            <button style={S.menuItem} onClick={() => {
              const decrypted = decryptedMessages[msgMenu.msgId];
              setReplyTo({ id: msgMenu.msgId, senderName: msgMenu.msg.senderId === user.id ? 'You' : (msgMenu.msg.senderName || otherUser?.displayName), text: decrypted || (msgMenu.msg.type !== 'text' ? `📎 ${msgMenu.msg.type}` : '🔐') });
              setMsgMenu(null);
            }}>
              💬 Reply
            </button>
            <div style={S.menuDivider} />
            <button style={{ ...S.menuItem, color: 'var(--danger)' }} onClick={() => deleteMessage(msgMenu.msgId, 'me')}>
              🗑 Delete for me
            </button>
            {msgMenu.isMine && (
              <button style={{ ...S.menuItem, color: 'var(--danger)' }} onClick={() => deleteMessage(msgMenu.msgId, 'everyone')}>
                🗑 Delete for everyone
              </button>
            )}
          </div>
        </div>
      )}
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

const S = {
  container: { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-deep)', overflow: 'hidden', position: 'relative' },
  header: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '12px',
    background: 'var(--bg-panel)', borderBottom: '1px solid var(--divider)',
    boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
    flexShrink: 0, // never shrink — always visible
    zIndex: 10,
  },
  headerInfo: { display: 'flex', alignItems: 'center', gap: 10, flex: 1, background: 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'left' },
  headerName: { fontWeight: '600', fontSize: 15, color: 'var(--text-primary)', fontFamily: 'var(--font-body)' },
  headerStatus: { fontSize: 11, color: 'var(--online)' },
  expiryChip: { background: 'rgba(201,162,39,0.12)', color: 'var(--gold)', fontSize: 11, padding: '4px 10px', borderRadius: 'var(--radius-full)', border: '1px solid var(--gold-dim)', whiteSpace: 'nowrap' },
  messages: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '16px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    minHeight: 0, // critical — makes flex child scrollable
  },
  msgRow: { display: 'flex', alignItems: 'flex-end', gap: 8 },
  bubble: { padding: '10px 14px', maxWidth: '100%', wordBreak: 'break-word', cursor: 'pointer', userSelect: 'none' },
  senderName: { fontSize: 11, fontWeight: '600', marginBottom: 3, paddingLeft: 2 },
  msgMeta: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 4 },
  msgTime: { color: 'rgba(255,255,255,0.3)', fontSize: 10 },
  loadingMsg: { color: 'var(--text-muted)', textAlign: 'center', padding: 40 },
  emptyMsg: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: 40, textAlign: 'center' },
  replyPreview: { display: 'flex', gap: 8, background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: '6px 8px', marginBottom: 8, maxWidth: '100%' },
  replyBar: { width: 3, background: 'var(--accent-bright)', borderRadius: 2, flexShrink: 0 },
  replyName: { color: 'var(--accent-bright)', fontSize: 11, fontWeight: 600, marginBottom: 1 },
  replyText: { color: 'var(--text-muted)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 },
  replyBar2: { background: 'var(--bg-panel)', borderTop: '1px solid var(--border)', flexShrink: 0 },
  replyBarInner: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px' },
  inputBar: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--bg-panel)', borderTop: '1px solid var(--divider)', flexShrink: 0, zIndex: 10 },
  msgInput: { flex: 1, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-full)', padding: '10px 16px', fontSize: 14 },
  sendBtn: { width: 40, height: 40, borderRadius: '50%', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.18s ease' },
  lockScreen: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, textAlign: 'center' },
  lockError: { background: 'rgba(239,68,68,0.1)', color: '#f87171', padding: '8px 16px', borderRadius: 'var(--radius-md)', fontSize: 13, marginBottom: 12 },
  menuOverlay: { position: 'absolute', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)' },
  contextMenu: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', minWidth: 200, boxShadow: 'var(--shadow-lg)' },
  menuItem: { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', width: '100%', background: 'transparent', color: 'var(--text-primary)', fontSize: 14, cursor: 'pointer', textAlign: 'left', transition: 'background 0.15s' },
  menuDivider: { height: 1, background: 'var(--divider)' },
};
