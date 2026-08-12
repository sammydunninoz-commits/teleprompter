import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import DisplayWindow from './display/DisplayWindow'
import RemoteView from './remote/RemoteView'
import './index.css'

// Three surfaces share one bundle, chosen by query string:
//   ?display=<id>  → a talent prompter surface (follows the operator)
//   ?remote=<code> → a handheld transport remote (drives the operator)
//   otherwise      → the operator console
const params = new URLSearchParams(window.location.search)
const displayId = params.get('display')
const remoteCode = params.get('remote')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {displayId ? (
      <DisplayWindow displayId={displayId} />
    ) : remoteCode ? (
      <RemoteView code={remoteCode} />
    ) : (
      <App />
    )}
  </React.StrictMode>,
)
