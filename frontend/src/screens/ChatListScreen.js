import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { formatDistanceToNow } from 'date-fns';

export default function ChatListScreen({ onOpenChat, onOpenSettings, onNewChat }) {
  const { user, conversations, loadConversations, pendingRequests, loadPendingRequests, setActiveConvoId } = useApp();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('chats'); // chats | groups
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([loadConversations(), loadPendingRequests()]).finally(() => setLoading(false));
  }, []);

  const filtered = conversations
    .filter(c => tab === 'chats' ? c.type === 'direct' : c.type === 'group')
    .filter(c => {
      const name = c.type === 'direct' ? c.otherUser?.displayName : c.name;
      return name?.toLowerCase().includes(search.toLowerCase());
    });

  const getInitials = (name) => name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';

  const formatTime = (ts) => {
    if (!ts) return '';
    const date = new Date(ts * 1000);
    const now = new Date();
    const diff = now - date;
    if (diff < 60000) return 'now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const formatExpiry = (expiresAt) => {
    if (!expiresAt) return null;
    const secs = expiresAt - Math.floor(Date.now() / 1000);
    if (secs <= 0) return null;
    if (secs < 3600) return `${Math.ceil(secs / 60)} min left`;
    return `${Math.ceil(secs / 3600)} hrs left`;
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.tkoText}>TKO</span>
        <div style={styles.headerRight}>
          {pendingRequests.length > 0 && (
            <button className="btn-icon" style={{ position: 'relative' }} onClick={() => onNewChat('requests')}>
              <span>🔔</span>
              <span style={styles.notifBadge}>{pendingRequests.length}</span>
            </button>
          )}
          <button className="btn-icon" onClick={() => onNewChat('new')}>
            <span style={{ fontSize: 20 }}>✏️</span>
          </button>
          <button style={styles.avatarBtn} onClick={onOpenSettings}>
            <div className="avatar avatar-sm" style={{ background: user?.avatarColor || 'var(--accent)' }}>
              {getInitials(user?.displayName)}
            </div>
          </button>
        </div>
      </div>

      {/* Search */}
      <div style={styles.searchWrap}>
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={styles.search}
        />
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        <button style={{ ...styles.tab, ...(tab === 'chats' ? styles.tabActive : {}) }} onClick={() => setTab('chats')}>
          Chats
        </button>
        <button style={{ ...styles.tab, ...(tab === 'groups' ? styles.tabActive : {}) }} onClick={() => setTab('groups')}>
          Groups
        </button>
      </div>

      {/* Chat list */}
      <div style={styles.list}>
        {loading ? (
          <div style={styles.empty}>
            <div style={{ animation: 'pulse 1.5s ease infinite', color: 'var(--text-muted)' }}>Loading...</div>
          </div>
        ) : filtered.length === 0 ? (
          <div style={styles.empty}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💬</div>
            <div style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>No {tab} yet</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              {tab === 'chats' ? 'Start a new chat with the ✏️ button' : 'Create a group with the ✏️ button'}
            </div>
          </div>
        ) : (
          filtered.map((convo, i) => {
            const name = convo.type === 'direct' ? convo.otherUser?.displayName : convo.name;
            const color = convo.type === 'direct' ? convo.otherUser?.avatarColor : convo.avatarColor;
            const isOnline = convo.type === 'direct' && convo.otherUser?.isOnline;
            const expiry = !convo.isPermanent && convo.expiresAt ? formatExpiry(convo.expiresAt) : null;

            return (
              <button key={convo.id} style={styles.chatItem} onClick={() => { setActiveConvoId(convo.id); onOpenChat(convo); }}
                className="fade-in" onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div style={{ position: 'relative' }}>
                  <div className="avatar avatar-md" style={{ background: color || 'var(--accent)' }}>
                    {getInitials(name)}
                    {isOnline && <div className="online-dot" />}
                  </div>
                </div>
                <div style={styles.chatInfo}>
                  <div style={styles.chatTop}>
                    <span style={styles.chatName}>{name}</span>
                    <div style={styles.chatMeta}>
                      {expiry && <span style={styles.expiryTag}>{expiry}</span>}
                      <span style={styles.chatTime}>{formatTime(convo.lastMessage?.createdAt)}</span>
                    </div>
                  </div>
                  <div style={styles.chatBottom}>
                    <span style={styles.chatPreview}>
                      {convo.chatLockEnabled ? '🔒 Locked' : (convo.lastMessage ? (convo.lastMessage.type !== 'text' ? `📎 ${convo.lastMessage.type}` : '🔐 Encrypted message') : 'No messages yet')}
                    </span>
                    {convo.unreadCount > 0 && <span className="badge">{convo.unreadCount}</span>}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--bg-panel)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 16px 12px',
    borderBottom: '1px solid var(--divider)',
  },
  tkoText: {
    fontFamily: 'var(--font-display)',
    fontSize: '28px',
    fontWeight: '700',
    color: 'var(--accent-bright)',
    letterSpacing: '4px',
    textShadow: '0 0 20px var(--accent-glow)',
  },
  headerRight: { display: 'flex', alignItems: 'center', gap: '4px' },
  avatarBtn: { background: 'transparent', borderRadius: '50%', padding: 2 },
  notifBadge: {
    position: 'absolute',
    top: 2, right: 2,
    background: 'var(--danger)',
    color: 'white',
    fontSize: 9,
    width: 14, height: 14,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrap: { padding: '8px 12px' },
  search: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-full)',
    padding: '9px 16px',
    fontSize: 13,
  },
  tabs: {
    display: 'flex',
    padding: '4px 12px 0',
    gap: 4,
    borderBottom: '1px solid var(--divider)',
  },
  tab: {
    background: 'transparent',
    color: 'var(--text-muted)',
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: '500',
    borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
    transition: 'all 0.18s ease',
  },
  tabActive: {
    color: 'var(--accent-bright)',
    background: 'var(--accent-pulse)',
    borderBottom: '2px solid var(--accent)',
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: '4px 0',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    padding: 40,
    textAlign: 'center',
  },
  chatItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 16px',
    width: '100%',
    background: 'transparent',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    transition: 'background 0.15s ease',
    textAlign: 'left',
  },
  chatInfo: { flex: 1, minWidth: 0 },
  chatTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },
  chatName: {
    fontWeight: '500',
    fontSize: 14,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  chatMeta: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 },
  chatTime: { color: 'var(--text-muted)', fontSize: 11 },
  expiryTag: {
    background: 'rgba(201,162,39,0.15)',
    color: 'var(--gold)',
    fontSize: 10,
    padding: '2px 6px',
    borderRadius: 'var(--radius-full)',
    border: '1px solid var(--gold-dim)',
  },
  chatBottom: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chatPreview: {
    color: 'var(--text-muted)',
    fontSize: 12,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  },
};
