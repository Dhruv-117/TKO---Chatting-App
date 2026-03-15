import React, { useState } from 'react';
import { useApp } from '../context/AppContext';

export default function AppLockScreen() {
  const { API, setAppLocked } = useApp();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const unlock = async () => {
    if (!password) return;
    setLoading(true); setError('');
    try {
      const res = await API.post('/users/app-lock/verify', { password });
      if (res.data.valid) {
        setAppLocked(false);
      } else {
        setError('Incorrect password');
        setPassword('');
      }
    } catch { setError('Error verifying password'); }
    finally { setLoading(false); }
  };

  return (
    <div style={styles.container}>
      <div className="stars-bg">
        {[...Array(10)].map((_, i) => (
          <div key={i} className="star" style={{
            width: Math.random() * 2 + 1 + 'px', height: Math.random() * 2 + 1 + 'px',
            left: Math.random() * 100 + '%', top: Math.random() * 100 + '%',
            animationDelay: Math.random() * 4 + 's', opacity: Math.random() * 0.5 + 0.2
          }} />
        ))}
      </div>
      <div style={styles.card} className="fade-in">
        <div style={styles.lockIcon}>🔒</div>
        <div style={styles.tko}>TKO</div>
        <div style={styles.sub}>App is locked</div>
        {error && <div style={styles.error}>{error}</div>}
        <input
          type="password"
          placeholder="Enter app password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && unlock()}
          style={styles.input}
          autoFocus
        />
        <button className="btn-primary" style={{ width: '100%', padding: 13 }} onClick={unlock} disabled={loading}>
          {loading ? 'Verifying...' : 'Unlock'}
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: {
    height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--bg-void)', padding: 20, position: 'relative',
  },
  card: {
    background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)',
    padding: '40px 32px', width: '100%', maxWidth: 360, textAlign: 'center',
    boxShadow: '0 0 60px rgba(43,94,232,0.1), var(--shadow-lg)', position: 'relative', zIndex: 1,
    display: 'flex', flexDirection: 'column', gap: 14,
  },
  lockIcon: { fontSize: 48 },
  tko: {
    fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 700,
    color: 'var(--accent-bright)', letterSpacing: 6, textShadow: '0 0 20px var(--accent-glow)',
  },
  sub: { color: 'var(--text-muted)', fontSize: 13, marginTop: -8 },
  error: {
    background: 'rgba(239,68,68,0.1)', color: '#f87171',
    padding: '10px 14px', borderRadius: 'var(--radius-md)', fontSize: 13,
  },
  input: { textAlign: 'center', letterSpacing: 4 },
};
