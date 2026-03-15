import React, { useState } from 'react';
import { useApp } from '../context/AppContext';

export default function SettingsScreen({ onBack }) {
  const { user, setUser, logout, API, socket, conversations } = useApp();
  const [section, setSection] = useState('main');
  const [form, setForm] = useState({ displayName: user.displayName, username: user.username });
  const [privacy, setPrivacy] = useState({
    privacyLastSeen: user.privacyLastSeen || 'everyone',
    privacyOnlineStatus: user.privacyOnlineStatus || 'everyone',
    privacyDiscoverable: user.privacyDiscoverable !== false,
    privacyPfp: user.privacyPfp || 'everyone',
  });
  const [security, setSecurity] = useState({ password: '', confirmPassword: '', appLock: user.appLockEnabled || false });
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const saveProfile = async () => {
    setError(''); setMsg('');
    setLoading(true);
    try {
      if (form.displayName !== user.displayName) {
        await API.put('/users/profile', { displayName: form.displayName });
        setUser({ displayName: form.displayName });
      }
      if (form.username !== user.username) {
        const res = await API.put('/users/username', { username: form.username });
        setUser({ username: res.data.username, usernameChanges: (user.usernameChanges || 0) + 1 });
      }
      setMsg('Profile updated!');
    } catch (err) { setError(err.response?.data?.error || 'Failed'); }
    finally { setLoading(false); }
  };

  const savePrivacy = async () => {
    setError(''); setMsg('');
    try {
      await API.put('/users/privacy', privacy);
      setUser({ ...privacy });
      setMsg('Privacy settings saved!');
    } catch { setError('Failed to save privacy settings'); }
  };

  const saveAppLock = async () => {
    if (security.appLock && security.password !== security.confirmPassword) { setError('Passwords do not match'); return; }
    if (security.appLock && security.password.length < 4) { setError('Password too short'); return; }
    try {
      await API.put('/users/app-lock', { enabled: security.appLock, password: security.password });
      setUser({ appLockEnabled: security.appLock });
      setMsg('App lock updated!');
    } catch { setError('Failed'); }
  };

  const loadBlocked = async () => {
    const res = await API.get('/users/blocked');
    setBlockedUsers(res.data);
    setSection('blocked');
  };

  const deleteAccount = async () => {
    if (!deletePassword) { setDeleteError('Enter your password to confirm'); return; }
    setDeleting(true); setDeleteError('');
    try {
      // Get conversation IDs before deleting so we can notify others
      const convoIds = conversations.map(c => c.id);
      await API.delete('/users/account', { data: { password: deletePassword } });
      // Notify others their chat with us is gone
      socket.current?.emit('account_deleted', { conversationIds: convoIds });
      // Clear everything locally
      logout();
    } catch (err) {
      setDeleteError(err.response?.data?.error || 'Failed to delete account');
    } finally { setDeleting(false); }
  };

  const unblock = async (userId) => {
    await API.delete(`/users/blocked/${userId}`);
    setBlockedUsers(prev => prev.filter(u => u.id !== userId));
  };

  const getInitials = (name) => name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
  const usernameChangesLeft = 4 - (user.usernameChanges || 0);

  const PrivacySelect = ({ label, value, onChange }) => (
    <div style={styles.privacyRow}>
      <span style={styles.privacyLabel}>{label}</span>
      <div style={styles.toggle}>
        {['everyone', 'nobody'].map(opt => (
          <button key={opt} style={{ ...styles.toggleBtn, ...(value === opt ? styles.toggleActive : {}) }} onClick={() => onChange(opt)}>
            {opt === 'everyone' ? 'Everyone' : 'Nobody'}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button className="btn-icon" onClick={section === 'main' ? onBack : () => { setSection('main'); setMsg(''); setError(''); }}>
          <span style={{ fontSize: 20 }}>←</span>
        </button>
        <span style={styles.title}>
          {section === 'main' ? 'Settings' : section === 'profile' ? 'Profile' : section === 'privacy' ? 'Privacy' : section === 'security' ? 'Security' : 'Blocked Users'}
        </span>
      </div>

      <div style={styles.content}>
        {msg && <div style={styles.success}>{msg}</div>}
        {error && <div style={styles.error}>{error}</div>}

        {/* MAIN */}
        {section === 'main' && (
          <div className="fade-in">
            {/* Profile card */}
            <div style={styles.profileCard}>
              <div className="avatar avatar-xl" style={{ background: user.avatarColor }}>{getInitials(user.displayName)}</div>
              <div>
                <div style={styles.profileName}>{user.displayName}</div>
                <div style={styles.profileHandle}>@{user.username}</div>
                <div style={styles.profileEmail}>{user.email}</div>
              </div>
            </div>

            <div style={styles.menuList}>
              {[
                { icon: '👤', label: 'Profile', sub: 'Display name, username', action: () => setSection('profile') },
                { icon: '🔒', label: 'Privacy', sub: 'Who can see your info', action: () => setSection('privacy') },
                { icon: '🛡️', label: 'Security', sub: 'App lock, chat lock', action: () => setSection('security') },
                { icon: '🚫', label: 'Blocked Users', sub: 'Manage blocked accounts', action: loadBlocked },
              ].map(item => (
                <button key={item.label} style={styles.menuItem} onClick={item.action}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={styles.menuIcon}>{item.icon}</span>
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <div style={styles.menuLabel}>{item.label}</div>
                    <div style={styles.menuSub}>{item.sub}</div>
                  </div>
                  <span style={{ color: 'var(--text-muted)' }}>›</span>
                </button>
              ))}
            </div>

            <button style={styles.logoutBtn} onClick={logout}>Sign Out</button>
            <button style={styles.deleteAccountBtn} onClick={() => setShowDeleteModal(true)}>
              🗑 Delete Account
            </button>
          </div>
        )}

        {/* Delete account confirmation modal */}
        {showDeleteModal && (
          <div style={styles.modalOverlay} onClick={() => setShowDeleteModal(false)}>
            <div style={styles.modal} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 36, textAlign: 'center', marginBottom: 12 }}>⚠️</div>
              <div style={styles.modalTitle}>Delete Account</div>
              <p style={styles.modalDesc}>
                This is permanent and cannot be undone. All your messages, chats and data will be deleted forever. Anyone you were chatting with will lose that conversation too.
              </p>
              {deleteError && <div style={styles.error}>{deleteError}</div>}
              <div style={{ marginBottom: 12 }}>
                <label style={styles.label}>Enter your password to confirm</label>
                <input
                  type="password"
                  placeholder="Your password"
                  value={deletePassword}
                  onChange={e => setDeletePassword(e.target.value)}
                  style={{ marginTop: 6 }}
                  autoFocus
                />
              </div>
              <button
                style={{ ...styles.deleteAccountBtn, width: '100%', padding: 12, marginBottom: 8 }}
                onClick={deleteAccount}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Yes, delete my account'}
              </button>
              <button className="btn-ghost" style={{ width: '100%', padding: 11 }} onClick={() => { setShowDeleteModal(false); setDeletePassword(''); setDeleteError(''); }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* PROFILE */}
        {section === 'profile' && (
          <div style={styles.form} className="fade-in">
            <div style={styles.field}>
              <label style={styles.label}>Display Name</label>
              <input type="text" value={form.displayName} onChange={e => set('displayName', e.target.value)} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>
                Username
                <span style={{ marginLeft: 8, color: usernameChangesLeft > 0 ? 'var(--text-muted)' : 'var(--danger)', fontSize: 11 }}>
                  {usernameChangesLeft > 0 ? `${usernameChangesLeft} changes left` : 'Locked forever'}
                </span>
              </label>
              <input type="text" value={form.username} onChange={e => set('username', e.target.value.toLowerCase())}
                disabled={usernameChangesLeft <= 0} />
            </div>
            <button className="btn-primary" style={{ width: '100%', padding: 12 }} onClick={saveProfile} disabled={loading}>
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}

        {/* PRIVACY */}
        {section === 'privacy' && (
          <div className="fade-in">
            <p style={styles.sectionHint}>Control who can see your information.</p>
            <div style={styles.privacySection}>
              <PrivacySelect label="Last Seen" value={privacy.privacyLastSeen} onChange={v => setPrivacy(p => ({ ...p, privacyLastSeen: v }))} />
              <PrivacySelect label="Online Status" value={privacy.privacyOnlineStatus} onChange={v => setPrivacy(p => ({ ...p, privacyOnlineStatus: v }))} />
              <PrivacySelect label="Profile Photo" value={privacy.privacyPfp} onChange={v => setPrivacy(p => ({ ...p, privacyPfp: v }))} />
            </div>

            <div style={styles.discoverRow}>
              <div>
                <div style={styles.privacyLabel}>Discoverability</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>Allow others to find you by username</div>
              </div>
              <button style={{ ...styles.toggleSlider, background: privacy.privacyDiscoverable ? 'var(--accent)' : 'var(--bg-active)' }}
                onClick={() => setPrivacy(p => ({ ...p, privacyDiscoverable: !p.privacyDiscoverable }))}>
                <div style={{ ...styles.sliderDot, transform: privacy.privacyDiscoverable ? 'translateX(20px)' : 'translateX(2px)' }} />
              </button>
            </div>

            <button className="btn-primary" style={{ width: '100%', padding: 12, marginTop: 20 }} onClick={savePrivacy}>Save Privacy Settings</button>
          </div>
        )}

        {/* SECURITY */}
        {section === 'security' && (
          <div className="fade-in">
            <div style={styles.securityCard}>
              <div style={styles.secRow}>
                <div>
                  <div style={styles.privacyLabel}>App Lock</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>Require password to open TKO</div>
                </div>
                <button style={{ ...styles.toggleSlider, background: security.appLock ? 'var(--accent)' : 'var(--bg-active)' }}
                  onClick={() => setSecurity(s => ({ ...s, appLock: !s.appLock }))}>
                  <div style={{ ...styles.sliderDot, transform: security.appLock ? 'translateX(20px)' : 'translateX(2px)' }} />
                </button>
              </div>
              {security.appLock && (
                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input type="password" placeholder="New app lock password" value={security.password}
                    onChange={e => setSecurity(s => ({ ...s, password: e.target.value }))} />
                  <input type="password" placeholder="Confirm password" value={security.confirmPassword}
                    onChange={e => setSecurity(s => ({ ...s, confirmPassword: e.target.value }))} />
                </div>
              )}
              <button className="btn-primary" style={{ width: '100%', padding: 11, marginTop: 16 }} onClick={saveAppLock}>
                {security.appLock ? 'Set App Lock' : 'Disable App Lock'}
              </button>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 12 }}>
              💡 Chat lock can be set individually per chat in that chat's settings.
            </p>
          </div>
        )}

        {/* BLOCKED */}
        {section === 'blocked' && (
          <div className="fade-in">
            {blockedUsers.length === 0 ? (
              <div style={styles.empty}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No blocked users</div>
              </div>
            ) : (
              blockedUsers.map(u => (
                <div key={u.id} style={styles.blockedItem}>
                  <div className="avatar avatar-sm" style={{ background: u.avatarColor }}>{getInitials(u.displayName)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{u.displayName}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>@{u.username} · {u.reason === 'auto' ? 'Auto-blocked' : 'Blocked'}</div>
                  </div>
                  <button className="btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => unblock(u.id)}>Unblock</button>
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
  content: { flex: 1, overflowY: 'auto', padding: '16px' },
  success: { background: 'rgba(34,197,94,0.1)', color: '#4ade80', padding: '10px 14px', borderRadius: 'var(--radius-md)', fontSize: 13, marginBottom: 12 },
  error: { background: 'rgba(239,68,68,0.1)', color: '#f87171', padding: '10px 14px', borderRadius: 'var(--radius-md)', fontSize: 13, marginBottom: 12 },
  profileCard: { display: 'flex', alignItems: 'center', gap: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px', marginBottom: 20 },
  profileName: { fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, letterSpacing: 0.3 },
  profileHandle: { color: 'var(--accent-bright)', fontSize: 13, marginTop: 2 },
  profileEmail: { color: 'var(--text-muted)', fontSize: 12, marginTop: 2 },
  menuList: { display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 20 },
  menuItem: { display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: 'transparent', color: 'inherit', width: '100%', cursor: 'pointer', transition: 'background 0.15s', borderBottom: '1px solid var(--divider)' },
  menuIcon: { fontSize: 20, width: 28, textAlign: 'center' },
  menuLabel: { fontWeight: 500, fontSize: 14, textAlign: 'left' },
  menuSub: { color: 'var(--text-muted)', fontSize: 12, textAlign: 'left' },
  logoutBtn: { width: '100%', background: 'rgba(239,68,68,0.08)', color: 'var(--danger)', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(239,68,68,0.2)', fontSize: 14, fontWeight: 500, cursor: 'pointer', marginBottom: 8 },
  deleteAccountBtn: { width: '100%', background: 'rgba(239,68,68,0.15)', color: '#ff6b6b', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(239,68,68,0.35)', fontSize: 14, fontWeight: 500, cursor: 'pointer' },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20, backdropFilter: 'blur(4px)' },
  modal: { background: 'var(--bg-card)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-xl)', padding: 24, width: '100%', maxWidth: 360 },
  modalTitle: { fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, textAlign: 'center', marginBottom: 10, color: 'var(--danger)' },
  modalDesc: { color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, marginBottom: 16, textAlign: 'center' },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { color: 'var(--text-secondary)', fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center' },
  sectionHint: { color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 },
  privacySection: { display: 'flex', flexDirection: 'column', gap: 2, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 12 },
  privacyRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--divider)' },
  privacyLabel: { fontWeight: 500, fontSize: 14 },
  toggle: { display: 'flex', background: 'var(--bg-deep)', borderRadius: 'var(--radius-full)', padding: 2, gap: 2 },
  toggleBtn: { background: 'transparent', color: 'var(--text-muted)', padding: '5px 12px', borderRadius: 'var(--radius-full)', fontSize: 12, fontWeight: 500, transition: 'all 0.15s' },
  toggleActive: { background: 'var(--accent)', color: 'white' },
  discoverRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', marginBottom: 12 },
  toggleSlider: { width: 44, height: 24, borderRadius: 'var(--radius-full)', position: 'relative', transition: 'background 0.2s', border: 'none', cursor: 'pointer', flexShrink: 0 },
  sliderDot: { width: 20, height: 20, background: 'white', borderRadius: '50%', position: 'absolute', top: 2, transition: 'transform 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' },
  securityCard: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px' },
  secRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  blockedItem: { display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '12px 14px', marginBottom: 8 },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, textAlign: 'center' },
};
