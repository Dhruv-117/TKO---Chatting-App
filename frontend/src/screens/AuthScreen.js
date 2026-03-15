import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { generateKeyPair, encryptPrivateKey } from '../crypto/encryption';

/* ── Eye icon ── */
function Eye({ visible }) {
  return visible ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

/* ── Password field with toggle ── */
function PwdField({ label, hint, placeholder, value, onChange }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={labelStyle}>
        {label}
        {hint && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> {hint}</span>}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          type={show ? 'text' : 'password'}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          required
          style={{ width: '100%', paddingRight: 46, boxSizing: 'border-box' }}
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          style={{
            position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: show ? 'var(--accent-bright)' : 'var(--text-muted)',
            display: 'flex', alignItems: 'center', padding: 4,
          }}
          tabIndex={-1}
        >
          <Eye visible={show} />
        </button>
      </div>
    </div>
  );
}

const labelStyle = { color: 'var(--text-secondary)', fontSize: 12, fontWeight: 500, letterSpacing: '0.3px' };

/* ── TKO Logo SVG ── */
function TKOLogo() {
  return (
    <svg viewBox="0 0 100 100" width="76" height="76" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="bbl" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="#0d2a6e"/>
          <stop offset="100%" stopColor="#040d20"/>
        </radialGradient>
        <radialGradient id="glw" cx="50%" cy="40%" r="40%">
          <stop offset="0%" stopColor="#4070f4" stopOpacity="0.6"/>
          <stop offset="100%" stopColor="#2B5EE8" stopOpacity="0"/>
        </radialGradient>
        <filter id="sg">
          <feGaussianBlur stdDeviation="1.5" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <ellipse cx="50" cy="44" rx="42" ry="32" fill="none" stroke="#2B5EE8" strokeWidth="0.5" opacity="0.3"/>
      <ellipse cx="50" cy="44" rx="38" ry="28" fill="url(#bbl)" stroke="#2B5EE8" strokeWidth="2"/>
      <ellipse cx="50" cy="44" rx="32" ry="22" fill="url(#glw)" opacity="0.5"/>
      <path d="M34 68 L28 82 L46 72 Z" fill="#040d20" stroke="#2B5EE8" strokeWidth="1.8" strokeLinejoin="round"/>
      <ellipse cx="50" cy="44" rx="26" ry="12" fill="none" stroke="#2B5EE8" strokeWidth="0.8" strokeDasharray="4,5" opacity="0.45" transform="rotate(-15 50 44)"/>
      <path d="M50 26 L52.5 36 L63 36 L54.5 42 L57.5 52 L50 46 L42.5 52 L45.5 42 L37 36 L47.5 36 Z" fill="#c9a227" filter="url(#sg)"/>
      <circle cx="50" cy="38" r="4" fill="#f0c040" opacity="0.85"/>
      <circle cx="34" cy="35" r="1.4" fill="white" opacity="0.65"/>
      <circle cx="67" cy="40" r="1.1" fill="white" opacity="0.5"/>
      <circle cx="58" cy="28" r="0.9" fill="white" opacity="0.55"/>
    </svg>
  );
}

/* ── Main component ── */
export default function AuthScreen() {
  const [mode, setMode] = useState('welcome');
  const [form, setForm] = useState({ email: '', username: '', displayName: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, register, storePrivateKey, API } = useApp();

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const goBack = () => { setMode('welcome'); setError(''); };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const u = await login(form.email, form.password);

      // Try localStorage first (same device), then fetch from server (new device)
      let encryptedKeyData = null;
      const localKey = localStorage.getItem(`tko_key_${u.id}`);
      if (localKey) {
        encryptedKeyData = JSON.parse(localKey);
      } else {
        // New device — fetch encrypted key from server
        try {
          const keyRes = await API.get('/auth/my-key');
          encryptedKeyData = keyRes.data.encryptedPrivateKey;
          // Cache locally for next time
          localStorage.setItem(`tko_key_${u.id}`, JSON.stringify(encryptedKeyData));
        } catch {
          setError('Could not retrieve your encryption key. Try again.');
          setLoading(false);
          return;
        }
      }

      try {
        const { decryptPrivateKey } = await import('../crypto/encryption');
        const privKey = await decryptPrivateKey(encryptedKeyData, form.password);
        // Store in localStorage so it survives browser close
        localStorage.setItem(`tko_privkey_${u.id}`, privKey);
        sessionStorage.setItem('tko_private_key', privKey); // legacy compat
        storePrivateKey(privKey);
      } catch {
        setError('Incorrect password or corrupted key');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally { setLoading(false); }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirmPassword) { setError('Passwords do not match'); return; }
    if (form.password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setLoading(true);
    try {
      const keys = await generateKeyPair();
      const encKey = await encryptPrivateKey(keys.privateKeyB64, form.password);
      const u = await register({
        email: form.email, username: form.username,
        displayName: form.displayName, password: form.password,
        publicKey: keys.publicKeyB64
      });
      // Save to localStorage (this device)
      localStorage.setItem(`tko_key_${u.id}`, JSON.stringify(encKey));
      // Save to server (all future devices)
      try {
        await API.post('/auth/save-key', { encryptedPrivateKey: encKey });
      } catch { console.warn('Could not save key to server — only stored locally'); }
      // Store raw private key in localStorage so it survives browser close
      localStorage.setItem(`tko_privkey_${u.id}`, keys.privateKeyB64);
      sessionStorage.setItem('tko_private_key', keys.privateKeyB64); // legacy compat
      storePrivateKey(keys.privateKeyB64);
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed');
    } finally { setLoading(false); }
  };

  return (
    /* Full-height scroll container — key fix: no overflow:hidden, real scroll */
    <div style={{
      minHeight: '100%', height: '100%',
      background: 'var(--bg-void)',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      position: 'relative',
    }}>
      {/* Stars */}
      <div className="stars-bg">
        {[...Array(12)].map((_, i) => (
          <div key={i} className="star" style={{
            width: Math.random() * 3 + 1 + 'px', height: Math.random() * 3 + 1 + 'px',
            left: Math.random() * 100 + '%', top: Math.random() * 100 + '%',
            animationDelay: Math.random() * 4 + 's',
            animationDuration: (Math.random() * 3 + 3) + 's',
            opacity: Math.random() * 0.5 + 0.2,
          }} />
        ))}
      </div>

      {/* Card — centred but scrollable past it */}
      <div style={{
        position: 'relative', zIndex: 1,
        display: 'flex', justifyContent: 'center',
        padding: '32px 20px 60px',
      }}>
        <div style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl)',
          padding: '32px 26px',
          width: '100%', maxWidth: 380,
          boxShadow: '0 0 60px rgba(43,94,232,0.1), var(--shadow-lg)',
        }} className="fade-in">

          {/* Logo */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 24, gap: 4 }}>
            <TKOLogo />
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 38, fontWeight: 700, color: 'var(--accent-bright)', letterSpacing: 6, lineHeight: 1, textShadow: '0 0 30px var(--accent-glow)', marginTop: 4 }}>TKO</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 10, letterSpacing: 3, textTransform: 'uppercase' }}>Texting Kept Ours</div>
          </div>

          {/* WELCOME */}
          {mode === 'welcome' && (
            <div className="fade-in">
              <p style={{ color: 'var(--text-secondary)', textAlign: 'center', fontSize: 14, marginBottom: 22, letterSpacing: '0.3px' }}>
                Your conversations. Only yours.
              </p>
              <button className="btn-primary" style={{ width: '100%', padding: 13 }} onClick={() => setMode('login')}>
                Sign In
              </button>
              <button className="btn-ghost" style={{ width: '100%', padding: 13, marginTop: 10 }} onClick={() => setMode('register')}>
                Create Account
              </button>
            </div>
          )}

          {/* LOGIN */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }} className="fade-in">
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, letterSpacing: 0.5, marginBottom: 2 }}>Welcome back</h2>
              {error && <div style={errStyle}>{error}</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={labelStyle}>Email</label>
                <input type="email" placeholder="your@email.com" value={form.email} onChange={e => set('email', e.target.value)} required />
              </div>
              <PwdField label="Password" placeholder="••••••••" value={form.password} onChange={e => set('password', e.target.value)} />
              <button type="submit" className="btn-primary" style={{ width: '100%', padding: 13 }} disabled={loading}>
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
              <button type="button" style={backBtnStyle} onClick={goBack}>← Back</button>
            </form>
          )}

          {/* REGISTER */}
          {mode === 'register' && (
            <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 13 }} className="fade-in">
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, letterSpacing: 0.5, marginBottom: 2 }}>Create account</h2>
              {error && <div style={errStyle}>{error}</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={labelStyle}>Display Name</label>
                <input type="text" placeholder="How others see you" value={form.displayName} onChange={e => set('displayName', e.target.value)} required />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={labelStyle}>Username <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(used to find you)</span></label>
                <input type="text" placeholder="username (3-20 chars)" value={form.username}
                  onChange={e => set('username', e.target.value.toLowerCase())}
                  pattern="[a-zA-Z0-9_]{3,20}" required />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={labelStyle}>Email <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(private, login only)</span></label>
                <input type="email" placeholder="your@email.com" value={form.email} onChange={e => set('email', e.target.value)} required />
              </div>
              <PwdField label="Password" hint="(min 8 chars)" placeholder="Min 8 characters" value={form.password} onChange={e => set('password', e.target.value)} />
              <PwdField label="Confirm Password" placeholder="Re-enter password" value={form.confirmPassword} onChange={e => set('confirmPassword', e.target.value)} />
              <div style={{ background: 'var(--accent-pulse)', border: '1px solid var(--border)', color: 'var(--text-secondary)', padding: '10px 14px', borderRadius: 'var(--radius-md)', fontSize: 12, lineHeight: 1.5 }}>
                🔑 Your password encrypts your messages. It cannot be recovered if lost.
              </div>
              <button type="submit" className="btn-primary" style={{ width: '100%', padding: 13 }} disabled={loading}>
                {loading ? 'Creating account...' : 'Create Account'}
              </button>
              <button type="button" style={backBtnStyle} onClick={goBack}>← Back</button>
            </form>
          )}

        </div>
      </div>
    </div>
  );
}

const errStyle = {
  background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
  color: '#f87171', padding: '10px 14px', borderRadius: 'var(--radius-md)', fontSize: 13,
};
const backBtnStyle = {
  background: 'transparent', color: 'var(--text-muted)',
  fontSize: 13, padding: 8, textAlign: 'center', width: '100%', cursor: 'pointer',
};
