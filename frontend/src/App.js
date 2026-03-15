import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import AuthScreen from './screens/AuthScreen';
import AppLockScreen from './screens/AppLockScreen';
import ChatListScreen from './screens/ChatListScreen';
import ChatScreen from './screens/ChatScreen';
import ChatInfoScreen from './screens/ChatInfoScreen';
import NewChatScreen from './screens/NewChatScreen';
import SettingsScreen from './screens/SettingsScreen';
import './index.css';

function SplashScreen() {
  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#050709',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 12,
    }}>
      <svg viewBox="0 0 100 100" width="72" height="72" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="s_bbl" cx="50%" cy="45%" r="55%">
            <stop offset="0%" stopColor="#0d2a6e"/>
            <stop offset="100%" stopColor="#040d20"/>
          </radialGradient>
        </defs>
        <ellipse cx="50" cy="44" rx="38" ry="28" fill="url(#s_bbl)" stroke="#2B5EE8" strokeWidth="2"/>
        <path d="M34 68 L28 82 L46 72 Z" fill="#040d20" stroke="#2B5EE8" strokeWidth="1.8" strokeLinejoin="round"/>
        <path d="M50 26 L52.5 36 L63 36 L54.5 42 L57.5 52 L50 46 L42.5 52 L45.5 42 L37 36 L47.5 36 Z" fill="#c9a227"/>
        <circle cx="50" cy="38" r="4" fill="#f0c040" opacity="0.85"/>
      </svg>
      <div style={{
        fontFamily: "'Rajdhani', 'Arial Black', sans-serif",
        fontSize: 36, fontWeight: 700,
        color: '#4070f4', letterSpacing: 6,
        textShadow: '0 0 20px rgba(43,94,232,0.5)',
      }}>TKO</div>
      <div style={{
        color: '#4a5a70', fontSize: 11,
        letterSpacing: 3, textTransform: 'uppercase',
      }}>Loading...</div>
    </div>
  );
}

function AppRouter() {
  const { user, appLocked, isLoading } = useApp();
  const [screen, setScreen] = useState('list');
  const [activeConvo, setActiveConvo] = useState(null);
  const [newChatTab, setNewChatTab] = useState('new');

  // Show splash while checking stored session
  if (isLoading) return <SplashScreen />;
  if (!user) return <AuthScreen />;
  if (appLocked) return <AppLockScreen />;

  const openChat = (convo) => { setActiveConvo(convo); setScreen('chat'); };
  const openNewChat = (tab = 'new') => { setNewChatTab(tab); setScreen('newChat'); };

  return (
    <div style={styles.appShell}>
      <div style={{ ...styles.panel, display: screen === 'list' ? 'flex' : 'none' }}>
        <ChatListScreen
          onOpenChat={openChat}
          onOpenSettings={() => setScreen('settings')}
          onNewChat={openNewChat}
        />
      </div>
      <div style={{ ...styles.panel, display: screen === 'chat' ? 'flex' : 'none' }}>
        {activeConvo && (
          <ChatScreen
            conversation={activeConvo}
            onBack={() => setScreen('list')}
            onOpenInfo={() => setScreen('chatInfo')}
          />
        )}
      </div>
      <div style={{ ...styles.panel, display: screen === 'chatInfo' ? 'flex' : 'none' }}>
        {activeConvo && (
          <ChatInfoScreen
            conversation={activeConvo}
            onBack={() => setScreen('chat')}
            onChatDeleted={() => { setActiveConvo(null); setScreen('list'); }}
          />
        )}
      </div>
      <div style={{ ...styles.panel, display: screen === 'newChat' ? 'flex' : 'none' }}>
        <NewChatScreen
          initialTab={newChatTab}
          onBack={() => setScreen('list')}
          onChatOpened={(convo) => { setActiveConvo(convo); setScreen('chat'); }}
        />
      </div>
      <div style={{ ...styles.panel, display: screen === 'settings' ? 'flex' : 'none' }}>
        <SettingsScreen onBack={() => setScreen('list')} />
      </div>
    </div>
  );
}

const styles = {
  appShell: {
    width: '100%',
    height: '100dvh',        /* dynamic viewport — no black bar on mobile */
    maxWidth: 480,
    margin: '0 auto',
    position: 'relative',
    background: 'var(--bg-void)',
    overflow: 'hidden',
  },
  panel: {
    position: 'absolute',
    inset: 0,
    flexDirection: 'column',
    overflow: 'hidden',
  },
};

export default function App() {
  return (
    <AppProvider>
      <AppRouter />
    </AppProvider>
  );
}
