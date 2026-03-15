import React, { useState } from 'react';
import { useApp } from '../context/AppContext';

export default function NewChatScreen({ initialTab = 'new', onBack, onChatOpened }) {
  const { API, pendingRequests, setPendingRequests, setConversations, conversations, socket, user } = useApp();
  const [tab, setTab] = useState(initialTab); // new | group | requests
  const [username, setUsername] = useState('');
  const [foundUser, setFoundUser] = useState(null);
  const [searchError, setSearchError] = useState('');
  const [searching, setSearching] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [groupFoundUser, setGroupFoundUser] = useState(null);
  const [groupMembers, setGroupMembers] = useState([]);
  const [groupError, setGroupError] = useState('');
  const [loading, setLoading] = useState(false);

  const getInitials = (name) => name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';

  const searchUser = async () => {
    if (!username.trim()) return;
    setSearching(true); setSearchError(''); setFoundUser(null); setRequestSent(false);
    try {
      const res = await API.get(`/users/find/${username.trim()}`);
      setFoundUser(res.data);
    } catch (err) {
      setSearchError(err.response?.data?.error || 'User not found');
    } finally { setSearching(false); }
  };

  const sendRequest = async () => {
    if (!foundUser) return;
    setLoading(true);
    try {
      const res = await API.post('/requests', { toUserId: foundUser.id });
      setRequestSent(true);
      socket.current?.emit('chat_request_sent', {
        toUserId: foundUser.id,
        requestData: {
          id: res?.data?.requestId,
          fromUserId: user.id,
          displayName: user.displayName,
          username: user.username,
          avatarColor: user.avatarColor
        }
      });
    } catch (err) {
      setSearchError(err.response?.data?.error || 'Failed to send request');
    } finally { setLoading(false); }
  };

  const acceptRequest = async (requestId, fromUserId) => {
    if (!requestId) { alert('Invalid request ID. Please refresh and try again.'); return; }
    try {
      const res = await API.post(`/requests/${requestId}/accept`);
      const acceptedReq = pendingRequests.find(r => r.id === requestId);
      setPendingRequests(prev => prev.filter(r => r.id !== requestId));

      // Fetch full user info including publicKey — needed for encryption
      let otherUserFull = null;
      try {
        const userRes = await API.get(`/users/find/${acceptedReq?.username}`);
        otherUserFull = {
          id: userRes.data.id,
          displayName: userRes.data.displayName,
          username: userRes.data.username,
          avatarColor: userRes.data.avatarColor,
          publicKey: userRes.data.publicKey,
          isOnline: userRes.data.isOnline,
          lastSeen: userRes.data.lastSeen,
        };
      } catch {
        // fallback without publicKey — will show error on send
        otherUserFull = acceptedReq ? {
          id: acceptedReq.fromUserId,
          displayName: acceptedReq.displayName,
          username: acceptedReq.username,
          avatarColor: acceptedReq.avatarColor,
        } : null;
      }

      const newConvo = {
        id: res.data.conversationId,
        type: 'direct',
        expiresAt: res.data.expiresAt,
        isPermanent: false,
        keptChat: false,
        otherUser: otherUserFull,
        unreadCount: 0,
      };
      setConversations(prev => [newConvo, ...prev]);
      socket.current?.emit('request_accepted', { toUserId: fromUserId, conversationData: newConvo });
      onChatOpened(newConvo);
    } catch (err) { alert(err.response?.data?.error || 'Failed to accept'); }
  };

  const declineRequest = async (requestId) => {
    try {
      await API.post(`/requests/${requestId}/decline`);
      setPendingRequests(prev => prev.filter(r => r.id !== requestId));
    } catch {}
  };

  const searchGroupUser = async () => {
    if (!groupSearch.trim()) return;
    setGroupError(''); setGroupFoundUser(null);
    try {
      const res = await API.get(`/users/find/${groupSearch.trim()}`);
      if (groupMembers.find(m => m.id === res.data.id)) { setGroupError('Already added'); return; }
      setGroupFoundUser(res.data);
    } catch { setGroupError('User not found'); }
  };

  const addToGroup = () => {
    if (!groupFoundUser) return;
    setGroupMembers(prev => [...prev, groupFoundUser]);
    setGroupFoundUser(null);
    setGroupSearch('');
  };

  const createGroup = async () => {
    if (!groupName.trim() || groupMembers.length === 0) { setGroupError('Add a name and at least one member'); return; }
    setLoading(true);
    try {
      const res = await API.post('/conversations/group', { name: groupName, memberIds: groupMembers.map(m => m.id) });
      const newConvo = { id: res.data.conversationId, type: 'group', name: groupName, isPermanent: true, memberCount: groupMembers.length + 1, unreadCount: 0 };
      setConversations(prev => [newConvo, ...prev]);
      onChatOpened(newConvo);
    } catch (err) { setGroupError(err.response?.data?.error || 'Failed to create group'); }
    finally { setLoading(false); }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button className="btn-icon" onClick={onBack}><span style={{ fontSize: 20 }}>←</span></button>
        <span style={styles.title}>New Conversation</span>
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        {['new', 'group', 'requests'].map(t => (
          <button key={t} style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}) }} onClick={() => setTab(t)}>
            {t === 'new' ? 'New Chat' : t === 'group' ? 'New Group' : `Requests${pendingRequests.length > 0 ? ` (${pendingRequests.length})` : ''}`}
          </button>
        ))}
      </div>

      <div style={styles.content}>
        {/* NEW CHAT */}
        {tab === 'new' && (
          <div style={styles.section} className="fade-in">
            <p style={styles.hint}>Enter the exact username of the person you want to message.</p>
            <div style={styles.row}>
              <input type="text" placeholder="@username" value={username} onChange={e => setUsername(e.target.value.toLowerCase())}
                onKeyDown={e => e.key === 'Enter' && searchUser()} />
              <button className="btn-primary" style={{ whiteSpace: 'nowrap', padding: '10px 20px' }} onClick={searchUser} disabled={searching}>
                {searching ? '...' : 'Find'}
              </button>
            </div>
            {searchError && <div style={styles.error}>{searchError}</div>}
            {foundUser && (
              <div style={styles.userCard} className="fade-in">
                <div className="avatar avatar-md" style={{ background: foundUser.avatarColor }}>{getInitials(foundUser.displayName)}</div>
                <div style={{ flex: 1 }}>
                  <div style={styles.userName}>{foundUser.displayName}</div>
                  <div style={styles.userHandle}>@{foundUser.username}</div>
                </div>
                {requestSent ? (
                  <span style={styles.sentBadge}>Request sent ✓</span>
                ) : (
                  <button className="btn-primary" style={{ padding: '8px 16px', fontSize: 13 }} onClick={sendRequest} disabled={loading}>
                    Send Request
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* NEW GROUP */}
        {tab === 'group' && (
          <div style={styles.section} className="fade-in">
            <div style={styles.field}>
              <label style={styles.label}>Group Name</label>
              <input type="text" placeholder="My Group" value={groupName} onChange={e => setGroupName(e.target.value)} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Add Members</label>
              <div style={styles.row}>
                <input type="text" placeholder="@username" value={groupSearch} onChange={e => setGroupSearch(e.target.value.toLowerCase())}
                  onKeyDown={e => e.key === 'Enter' && searchGroupUser()} />
                <button className="btn-primary" style={{ whiteSpace: 'nowrap', padding: '10px 20px' }} onClick={searchGroupUser}>Find</button>
              </div>
            </div>
            {groupError && <div style={styles.error}>{groupError}</div>}
            {groupFoundUser && (
              <div style={styles.userCard} className="fade-in">
                <div className="avatar avatar-sm" style={{ background: groupFoundUser.avatarColor }}>{getInitials(groupFoundUser.displayName)}</div>
                <div style={{ flex: 1 }}>
                  <div style={styles.userName}>{groupFoundUser.displayName}</div>
                  <div style={styles.userHandle}>@{groupFoundUser.username}</div>
                </div>
                <button className="btn-primary" style={{ padding: '7px 14px', fontSize: 13 }} onClick={addToGroup}>Add</button>
              </div>
            )}
            {groupMembers.length > 0 && (
              <div style={styles.membersList}>
                <div style={styles.label}>Members ({groupMembers.length})</div>
                {groupMembers.map(m => (
                  <div key={m.id} style={styles.memberItem}>
                    <div className="avatar avatar-sm" style={{ background: m.avatarColor }}>{getInitials(m.displayName)}</div>
                    <span style={{ flex: 1, fontSize: 13 }}>{m.displayName}</span>
                    <button className="btn-icon" onClick={() => setGroupMembers(prev => prev.filter(x => x.id !== m.id))}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <button className="btn-primary" style={{ width: '100%', padding: 13, marginTop: 16 }} onClick={createGroup} disabled={loading || !groupName.trim() || groupMembers.length === 0}>
              {loading ? 'Creating...' : 'Create Group'}
            </button>
          </div>
        )}

        {/* REQUESTS */}
        {tab === 'requests' && (
          <div style={styles.section} className="fade-in">
            {pendingRequests.length === 0 ? (
              <div style={styles.empty}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>📭</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No pending requests</div>
              </div>
            ) : (
              pendingRequests.map(req => (
                <div key={req.id} style={styles.requestCard} className="fade-in">
                  <div className="avatar avatar-md" style={{ background: req.avatarColor }}>{getInitials(req.displayName)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={styles.userName}>{req.displayName}</div>
                    <div style={styles.userHandle}>@{req.username}</div>
                  </div>
                  <div style={styles.reqActions}>
                    <button className="btn-primary" style={{ padding: '7px 14px', fontSize: 13 }} onClick={() => acceptRequest(req.id, req.fromUserId)}>Accept</button>
                    <button className="btn-ghost" style={{ padding: '7px 14px', fontSize: 13 }} onClick={() => declineRequest(req.id)}>Decline</button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-panel)' },
  header: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--divider)' },
  title: { fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, letterSpacing: 0.5 },
  tabs: { display: 'flex', padding: '4px 12px 0', borderBottom: '1px solid var(--divider)', gap: 4 },
  tab: { background: 'transparent', color: 'var(--text-muted)', padding: '8px 14px', fontSize: 13, fontWeight: 500, borderRadius: 'var(--radius-md) var(--radius-md) 0 0', transition: 'all 0.18s' },
  tabActive: { color: 'var(--accent-bright)', background: 'var(--accent-pulse)', borderBottom: '2px solid var(--accent)' },
  content: { flex: 1, overflowY: 'auto', padding: '20px 16px' },
  section: { display: 'flex', flexDirection: 'column', gap: 12 },
  hint: { color: 'var(--text-muted)', fontSize: 13 },
  row: { display: 'flex', gap: 8 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { color: 'var(--text-secondary)', fontSize: 12, fontWeight: 500, letterSpacing: 0.3 },
  error: { background: 'rgba(239,68,68,0.1)', color: '#f87171', padding: '10px 14px', borderRadius: 'var(--radius-md)', fontSize: 13 },
  userCard: { display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px' },
  requestCard: { display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', marginBottom: 8 },
  userName: { fontWeight: 500, fontSize: 14 },
  userHandle: { color: 'var(--text-muted)', fontSize: 12 },
  sentBadge: { color: 'var(--online)', fontSize: 13, fontWeight: 500 },
  reqActions: { display: 'flex', gap: 8 },
  membersList: { display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 12 },
  memberItem: { display: 'flex', alignItems: 'center', gap: 10 },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, textAlign: 'center' },
};
