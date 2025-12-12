import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

const container = document.getElementById('root')
const root = createRoot(container)
root.render(<App />)
try { console.log('render-start') } catch (_e) {}

if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
} else if ('serviceWorker' in navigator) {
  try {
    const fn = navigator.serviceWorker.getRegistrations
    if (typeof fn === 'function') {
      fn.call(navigator.serviceWorker).then(rs => {
        try { rs.forEach(r => r.unregister()) } catch (_) {}
      }).catch(() => {})
    }
  } catch (_) {}
}
