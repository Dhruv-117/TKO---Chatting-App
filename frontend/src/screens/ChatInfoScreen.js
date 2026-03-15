import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';

export default function ChatInfoScreen({ conversation, onBack, onChatDeleted }) {
  const { user, API, setConversations } = useApp();
  const [members, setMembers] = useState([]);
  const [note, setNote] = useState(conversation.note || '');
  const [lockEnabled, setLockEnabled] = useState(conversation.chatLockEnabled || false);
  const [lockPassword, setLockPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [showKeep, setShowKeep] = useState(!conversation.isPermanent && !conversation.keptChat);
  const [keptByMe, setKeptByMe] = useState(conversation.keptChat || false);
  const [groupSearch, setGroupSearch] = useState('');
  const [foundUser, setFoundUser] = useState(null);

  const isGroup = conversation.type === 'group';
  const myRole = members.find(m => m.id === user.id)?.role || 'member';
  const getInitials = (name) => name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';

  useEffect(() => {
    if (isGroup) loadMembers();
  }, []);

  const loadMembers = async () => {
    const res = await API.get(`/conversations/${conversation.id}/members`);
    setMembers(res.data);
  };

  const saveNote = async () => {
    try {
      await API.put(`/conversations/${conversation.id}/note`, { note });
      setMsg('Note saved');
      setConversations(prev => prev.map(c => c.id === conversation.id ? { ...c, note } : c));
    } catch { setError('Failed to save note'); }
  };

  const keepChat = async () => {
    try {
      const res = await API.post(`/conversations/${conversation.id}/keep`);
      setKeptByMe(true);
      if (res.data.isPermanent) {
        setMsg('Chat is now permanent! Both users kept it.');
        setShowKeep(false);
        setConversations(prev => prev.map(c => c.id === conversation.id ? { ...c, isPermanent: true, keptChat: true } : c));
      } else {
        setMsg('You kept this chat. Waiting for the other person.');
        setConversations(prev => prev.map(c => c.id === conversation.id ? { ...c, keptChat: true } : c));
      }
    } catch { setError('Failed'); }
  };

  const toggleMute = async () => {
    const newMuted = !conversation.isMuted;
    await API.put(`/conversations/${conversation.id}/mute`, { muted: newMuted });
    setConversations(prev => prev.map(c => c.id === conversation.id ? { ...c, isMuted: newMuted } : c));
    setMsg(newMuted ? 'Chat muted' : 'Chat unmuted');
  };

  const toggleLock = async () => {
    if (!lockEnabled && !lockPassword) { setError('Enter a password to enable lock'); return; }
    try {
      await API.put(`/conversations/${conversation.id}/lock`, { enabled: !lockEnabled, password: lockPassword });
      setLockEnabled(!lockEnabled);
      setConversations(prev => prev.map(c => c.id === conversation.id ? { ...c, chatLockEnabled: !lockEnabled } : c));
      setMsg(lockEnabled ? 'Chat lock removed' : 'Chat locked');
      setLockPassword('');
    } catch { setError('Failed'); }
  };

  const deleteChat = async () => {
    if (!window.confirm(isGroup && myRole === 'admin' ? 'Delete group for everyone?' : 'Delete this chat?')) return;
    try {
      await API.delete(`/conversations/${conversation.id}`);
      setConversations(prev => prev.filter(c => c.id !== conversation.id));
      onChatDeleted();
    } catch { setError('Failed to delete'); }
  };

  const searchUser = async () => {
    try {
      const res = await API.get(`/users/find/${groupSearch}`);
      setFoundUser(res.data);
    } catch { setError('User not found'); }
  };

  const addMember = async () => {
    if (!foundUser) return;
    try {
      await API.post(`/conversations/${conversation.id}/members`, { userId: foundUser.id });
      setFoundUser(null); setGroupSearch('');
      loadMembers();
      setMsg('Member added');
    } catch (err) { setError(err.response?.data?.error || 'Failed'); }
  };

  const removeMember = async (memberId) => {
    if (!window.confirm('Remove this member?')) return;
    try {
      await API.delete(`/conversations/${conversation.id}/members/${memberId}`);
      loadMembers();
    } catch { setError('Failed'); }
  };

  const changeRole = async (memberId, newRole) => {
    try {
      await API.put(`/conversations/${conversation.id}/members/${memberId}/role`, { role: newRole });
      loadMembers();
      setMsg('Role updated');
    } catch { setError('Failed'); }
  };

  const otherUser = conversation.otherUser;
  const headerName = isGroup ? conversation.name : otherUser?.displayName;
  const headerColor = isGroup ? conversation.avatarColor : otherUser?.avatarColor;

  const formatExpiry = () => {
    if (!conversation.expiresAt) return null;
    const secs = conversation.expiresAt - Math.floor(Date.now() / 1000);
    if (secs <= 0) return 'Expired';
    if (secs < 3600) return `${Math.ceil(secs / 60)} minutes left`;
    return `${Math.ceil(secs / 3600)} hours left`;
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button className="btn-icon" onClick={onBack}><span style={{ fontSize: 20 }}>←</span></button>
        <span style={styles.title}>Info</span>
      </div>

      <div style={styles.content}>
        {msg && <div style={styles.success}>{msg}</div>}
        {error && <div style={styles.error}>{error}</div>}

        {/* Profile section */}
        <div style={styles.profileSection}>
          <div className="avatar avatar-xl" style={{ background: headerColor }}>{getInitials(headerName)}</div>
          <div style={styles.profileName}>{headerName}</div>
          {!isGroup && <div style={styles.profileHandle}>@{otherUser?.username}</div>}
          {isGroup && <div style={styles.profileHandle}>{members.length} members</div>}
        </div>

        {/* 24hr window notice */}
        {!conversation.isPermanent && (
          <div style={styles.expiryCard}>
            <div style={styles.expiryTitle}>⏱ {formatExpiry()}</div>
            <p style={styles.expiryDesc}>
              {keptByMe
                ? "You've kept this chat. Waiting for the other person to also keep it."
                : "This chat will be deleted unless both of you tap 'Keep this chat' before the timer runs out."}
            </p>
            {showKeep && !keptByMe && (
              <button className="btn-primary" style={{ width: '100%', marginTop: 10 }} onClick={keepChat}>
                Keep this chat
              </button>
            )}
          </div>
        )}

        {/* Note */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Private Note</div>
          <p style={styles.sectionHint}>Only you can see this. A reminder about this {isGroup ? 'group' : 'person'}.</p>
          <textarea placeholder="Add a note..." value={note} onChange={e => setNote(e.target.value)}
            style={{ ...styles.textarea, resize: 'none' }} rows={3} />
          <button className="btn-ghost" style={{ alignSelf: 'flex-end', padding: '7px 16px', fontSize: 13 }} onClick={saveNote}>Save Note</button>
        </div>

        {/* Group members */}
        {isGroup && (
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Members</div>
            {(myRole === 'admin' || myRole === 'co-admin') && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input type="text" placeholder="@username to add" value={groupSearch} onChange={e => setGroupSearch(e.target.value.toLowerCase())} style={{ flex: 1 }} />
                <button className="btn-primary" style={{ padding: '9px 14px', fontSize: 13 }} onClick={searchUser}>Find</button>
              </div>
            )}
            {foundUser && (
              <div style={styles.memberRow}>
                <div className="avatar avatar-sm" style={{ background: foundUser.avatarColor }}>{getInitials(foundUser.displayName)}</div>
                <span style={{ flex: 1, fontSize: 13 }}>{foundUser.displayName}</span>
                <button className="btn-primary" style={{ padding: '6px 12px', fontSize: 12 }} onClick={addMember}>Add</button>
              </div>
            )}
            {members.map(m => (
              <div key={m.id} style={styles.memberRow}>
                <div className="avatar avatar-sm" style={{ background: m.avatarColor }}>{getInitials(m.displayName)}</div>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{m.displayName}</span>
                  {m.id === user.id && <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>(you)</span>}
                </div>
                <span style={{ ...styles.roleBadge, background: m.role === 'admin' ? 'rgba(43,94,232,0.2)' : m.role === 'co-admin' ? 'rgba(201,162,39,0.15)' : 'transparent', color: m.role === 'admin' ? 'var(--accent-bright)' : m.role === 'co-admin' ? 'var(--gold)' : 'var(--text-muted)' }}>
                  {m.role}
                </span>
                {myRole === 'admin' && m.id !== user.id && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    {m.role === 'member' && <button style={styles.roleBtn} onClick={() => changeRole(m.id, 'co-admin')}>+Co-admin</button>}
                    {m.role === 'co-admin' && <button style={styles.roleBtn} onClick={() => changeRole(m.id, 'member')}>-Co-admin</button>}
                    <button className="btn-icon" style={{ color: 'var(--danger)', fontSize: 14 }} onClick={() => removeMember(m.id)}>✕</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div style={styles.actions}>
          <button style={styles.actionBtn} onClick={toggleMute}>
            <span>{conversation.isMuted ? '🔔' : '🔇'}</span>
            {conversation.isMuted ? 'Unmute' : 'Mute'} Notifications
          </button>

          <div style={styles.lockSection}>
            <div style={styles.lockRow}>
              <span>🔒 Chat Lock</span>
              <button style={{ ...styles.toggleSlider, background: lockEnabled ? 'var(--accent)' : 'var(--bg-active)' }}
                onClick={() => setLockEnabled(v => !v)}>
                <div style={{ ...styles.sliderDot, transform: lockEnabled ? 'translateX(20px)' : 'translateX(2px)' }} />
              </button>
            </div>
            {lockEnabled && (
              <input type="password" placeholder={conversation.chatLockEnabled ? "New password (or leave to keep)" : "Set lock password"}
                value={lockPassword} onChange={e => setLockPassword(e.target.value)} style={{ marginTop: 10 }} />
            )}
            {(lockEnabled !== conversation.chatLockEnabled || lockPassword) && (
              <button className="btn-primary" style={{ width: '100%', padding: 10, marginTop: 10, fontSize: 13 }} onClick={toggleLock}>
                {lockEnabled ? 'Enable Lock' : 'Remove Lock'}
              </button>
            )}
          </div>

          <button style={styles.deleteBtn} onClick={deleteChat}>
            🗑 {isGroup && myRole === 'admin' ? 'Delete Group' : isGroup ? 'Leave Group' : 'Delete Chat'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-panel)' },
  header: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--divider)' },
  title: { fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, letterSpacing: 0.5 },
  content: { flex: 1, overflowY: 'auto', padding: 16 },
  success: { background: 'rgba(34,197,94,0.1)', color: '#4ade80', padding: '10px 14px', borderRadius: 'var(--radius-md)', fontSize: 13, marginBottom: 12 },
  error: { background: 'rgba(239,68,68,0.1)', color: '#f87171', padding: '10px 14px', borderRadius: 'var(--radius-md)', fontSize: 13, marginBottom: 12 },
  profileSection: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 16px', gap: 8 },
  profileName: { fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, letterSpacing: 0.3 },
  profileHandle: { color: 'var(--text-muted)', fontSize: 13 },
  expiryCard: { background: 'rgba(201,162,39,0.08)', border: '1px solid var(--gold-dim)', borderRadius: 'var(--radius-lg)', padding: 16, marginBottom: 16 },
  expiryTitle: { color: 'var(--gold)', fontWeight: 600, fontSize: 14, marginBottom: 6 },
  expiryDesc: { color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5 },
  section: { display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16, marginBottom: 12 },
  sectionTitle: { fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' },
  sectionHint: { color: 'var(--text-muted)', fontSize: 12 },
  textarea: { background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'var(--font-body)' },
  memberRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--divider)' },
  roleBadge: { padding: '2px 8px', borderRadius: 'var(--radius-full)', fontSize: 11, fontWeight: 500 },
  roleBtn: { background: 'var(--bg-hover)', color: 'var(--text-secondary)', padding: '4px 8px', borderRadius: 'var(--radius-sm)', fontSize: 11, cursor: 'pointer', border: '1px solid var(--border)' },
  actions: { display: 'flex', flexDirection: 'column', gap: 8 },
  actionBtn: { display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', color: 'var(--text-primary)', fontSize: 14, cursor: 'pointer', textAlign: 'left' },
  lockSection: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16 },
  lockRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-primary)', fontSize: 14 },
  toggleSlider: { width: 44, height: 24, borderRadius: 'var(--radius-full)', position: 'relative', transition: 'background 0.2s', border: 'none', cursor: 'pointer', flexShrink: 0 },
  sliderDot: { width: 20, height: 20, background: 'white', borderRadius: '50%', position: 'absolute', top: 2, transition: 'transform 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' },
  deleteBtn: { padding: '13px 16px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius-lg)', color: 'var(--danger)', fontSize: 14, cursor: 'pointer', textAlign: 'left' },
};
