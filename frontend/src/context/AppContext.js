import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { clearKeyCache } from '../crypto/encryption';

const AppContext = createContext(null);

const API = axios.create({
  baseURL: process.env.NODE_ENV === 'production'
    ? '/api'
    : 'http://localhost:3001/api'
});

API.interceptors.request.use(config => {
  const token = localStorage.getItem('tko_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Retry once on 403 (rate limit) with a short delay
API.interceptors.response.use(
  response => response,
  async error => {
    const config = error.config;
    if (error.response?.status === 403 && !config._retried) {
      config._retried = true;
      await new Promise(r => setTimeout(r, 1500)); // wait 1.5s then retry
      return API(config);
    }
    return Promise.reject(error);
  }
);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [privateKeyB64, setPrivateKeyB64] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [activeConvoId, setActiveConvoId] = useState(null);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [appLocked, setAppLocked] = useState(false);
  const [unlockedChats, setUnlockedChats] = useState(new Set());
  const socketRef = useRef(null);

  // Init: check stored session
  useEffect(() => {
    const token = localStorage.getItem('tko_token');
    const storedUser = localStorage.getItem('tko_user');

    if (token && storedUser) {
      const u = JSON.parse(storedUser);

      // Load private key from localStorage (persists across browser closes)
      const storedKey = localStorage.getItem(`tko_privkey_${u.id}`);
      if (storedKey) {
        setPrivateKeyB64(storedKey);
      }

      if (u.appLockEnabled) setAppLocked(true);
      setUser(u);

      // Refresh publicKey from server if missing
      if (!u.publicKey) {
        API.get('/auth/me').then(res => {
          const updated = { ...u, ...res.data };
          setUser(updated);
          localStorage.setItem('tko_user', JSON.stringify(updated));
        }).catch(() => {});
      }
    }
    setIsLoading(false);
  }, []);

  // Connect socket when user is set
  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('tko_token');
    // In production (served from backend), connect to same origin
    // In dev (separate ports), connect to backend port 3001
    const socketUrl = process.env.NODE_ENV === 'production'
      ? window.location.origin
      : window.location.origin.replace(':3000', ':3001');
    const socket = io(socketUrl, {
      auth: { token }
    });

    socketRef.current = socket;

    socket.on('new_message', ({ conversationId, message }) => {
      setConversations(prev => prev.map(c =>
        c.id === conversationId ? { ...c, lastMessage: message, unreadCount: activeConvoId === conversationId ? 0 : (c.unreadCount || 0) + 1 } : c
      ));
    });

    socket.on('presence_update', ({ userId, isOnline, lastSeen }) => {
      setConversations(prev => prev.map(c => {
        if (c.otherUser?.id === userId) {
          return { ...c, otherUser: { ...c.otherUser, isOnline, lastSeen } };
        }
        return c;
      }));
    });

    socket.on('chat_request_received', (request) => {
      // Ensure request has all needed fields including id
      setPendingRequests(prev => {
        if (prev.find(r => r.id === request.id)) return prev;
        return [request, ...prev];
      });
    });

    socket.on('new_conversation', (convo) => {
      setConversations(prev => [convo, ...prev]);
    });

    socket.on('conversation_removed', ({ conversationId }) => {
      setConversations(prev => prev.filter(c => c.id !== conversationId));
    });

    return () => socket.disconnect();
  }, [user]);

  const login = useCallback(async (email, password) => {
    const res = await API.post('/auth/login', { email, password });
    const { token, user: u } = res.data;
    localStorage.setItem('tko_token', token);
    localStorage.setItem('tko_user', JSON.stringify(u));
    // Set token first so interceptor works immediately
    if (u.appLockEnabled) setAppLocked(true);
    setUser(u);
    return u;
  }, []);

  const register = useCallback(async (data) => {
    const res = await API.post('/auth/register', data);
    const { token, user: u } = res.data;
    localStorage.setItem('tko_token', token);
    localStorage.setItem('tko_user', JSON.stringify(u));
    // Small delay so token is fully stored before socket/API calls fire on mount
    await new Promise(r => setTimeout(r, 300));
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    try { await API.post('/auth/logout'); } catch {}
    const userId = JSON.parse(localStorage.getItem('tko_user') || '{}')?.id;
    localStorage.removeItem('tko_token');
    localStorage.removeItem('tko_user');
    if (userId) localStorage.removeItem(`tko_privkey_${userId}`);
    sessionStorage.removeItem('tko_private_key'); // clean up old key if exists
    clearKeyCache();
    setUser(null);
    setPrivateKeyB64(null);
    setConversations([]);
    setActiveConvoId(null);
    socketRef.current?.disconnect();
  }, []);

  const loadConversations = useCallback(async () => {
    const res = await API.get('/conversations');
    setConversations(res.data);
    return res.data;
  }, []);

  const loadPendingRequests = useCallback(async () => {
    const res = await API.get('/requests/pending');
    setPendingRequests(res.data);
    return res.data;
  }, []);

  const storePrivateKey = useCallback((key) => {
    setPrivateKeyB64(key);
    // Store in localStorage so it persists across browser closes
    // Safe — private key is a large random value, useless without encrypted messages
    const userId = JSON.parse(localStorage.getItem('tko_user') || '{}')?.id;
    if (userId) localStorage.setItem(`tko_privkey_${userId}`, key);
  }, []);

  const unlockChat = useCallback((chatId) => {
    setUnlockedChats(prev => new Set([...prev, chatId]));
  }, []);

  const updateUser = useCallback((updates) => {
    const updated = { ...user, ...updates };
    setUser(updated);
    localStorage.setItem('tko_user', JSON.stringify(updated));
  }, [user]);

  return (
    <AppContext.Provider value={{
      user, setUser: updateUser,
      privateKeyB64, storePrivateKey,
      conversations, setConversations, loadConversations,
      activeConvoId, setActiveConvoId,
      pendingRequests, setPendingRequests, loadPendingRequests,
      appLocked, setAppLocked,
      unlockedChats, unlockChat,
      isLoading,
      socket: socketRef,
      login, register, logout,
      API
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
export { API };
