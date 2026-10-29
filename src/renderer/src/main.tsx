import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { applyTheme, getStoredTheme } from './lib/theme'

// Apply the saved palette before the first paint so there is no theme flash.
applyTheme(getStoredTheme())

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
