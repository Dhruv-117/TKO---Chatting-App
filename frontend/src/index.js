import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Global error boundary — shows error on screen instead of black
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error: error.message + '\n' + (error.stack || '') };
  }
  render() {
    if (this.state.error) {
      return React.createElement('div', {
        style: {
          position: 'fixed', inset: 0,
          background: '#050709', color: '#f87171',
          padding: 20, fontFamily: 'monospace',
          fontSize: 12, overflow: 'auto',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }
      }, '❌ TKO Error — please screenshot this and report:\n\n' + this.state.error);
    }
    return this.props.children;
  }
}

// Catch unhandled promise rejections — only show for fatal errors, not API 403s
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || String(e.reason) || '';
  // Ignore rate limit errors and axios 4xx — these are non-fatal
  if (msg.includes('403') || msg.includes('429') || msg.includes('401') ||
      msg.includes('Request failed with status code 4')) {
    console.warn('Non-fatal API error (suppressed):', msg);
    e.preventDefault();
    return;
  }
  const div = document.getElementById('root');
  if (div && !div.querySelector('[data-tko-error]')) {
    div.innerHTML = `<div data-tko-error="1" style="position:fixed;inset:0;background:#050709;color:#f87171;padding:20px;font-family:monospace;font-size:12px;overflow:auto;white-space:pre-wrap;word-break:break-all">❌ TKO Error:\n\n${e.reason?.stack || msg}</div>`;
  }
});

const rootEl = document.getElementById('root');
const root = ReactDOM.createRoot(rootEl);
root.render(
  React.createElement(ErrorBoundary, null,
    React.createElement(App)
  )
);

// PWA service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
