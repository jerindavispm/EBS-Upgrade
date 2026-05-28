import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App, { ErrorBoundary, showToast } from './App'
import './index.css'

// Kill any service worker + clear caches. Stale SWs were serving old code after
// navigating back from the EBS tracker. Runs on every app load — belt & suspenders.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then(regs => { regs.forEach(r => r.unregister()) })
    .catch(() => {})
  if (window.caches) {
    caches.keys()
      .then(keys => keys.forEach(k => caches.delete(k)))
      .catch(() => {})
  }
}

// Global safety nets — surface unhandled rejections + uncaught errors so they
// stop being silent. Throttle to once per 3s so a runaway loop doesn't spam.
let _lastErrorAt = 0
function reportGlobal(label, detail) {
  const now = Date.now()
  if (now - _lastErrorAt < 3000) return
  _lastErrorAt = now
  console.error('[global]', label, detail)
  try { showToast(`${label}: ${(detail && detail.message) || detail || 'unknown error'}`, 'error') } catch {}
}
window.addEventListener('unhandledrejection', (e) => reportGlobal('Unhandled rejection', e.reason))
window.addEventListener('error', (e) => reportGlobal('Runtime error', e.error || e.message))

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </React.StrictMode>
)
