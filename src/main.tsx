import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import DisplayWindow from './display/DisplayWindow'
import './index.css'

// A window opened with ?display=<id> is a talent prompter surface, not the
// operator UI. Everything else is the operator console.
const displayId = new URLSearchParams(window.location.search).get('display')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {displayId ? <DisplayWindow displayId={displayId} /> : <App />}
  </React.StrictMode>,
)
