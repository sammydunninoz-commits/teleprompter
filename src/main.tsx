import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import DisplayWindow from './display/DisplayWindow'
import RemoteView from './remote/RemoteView'
import type { BrokerId } from './remote/relay'
import './index.css'

// Three surfaces share one bundle, chosen by query string:
//   ?display=<id>  → a talent prompter surface (follows the operator)
//   ?remote=<code> → a handheld transport remote (drives the operator)
//   otherwise      → the operator console
const params = new URLSearchParams(window.location.search)
const displayId = params.get('display')
const remoteCode = params.get('remote')
// Which relay the console landed on; see remoteUrlFor.
const brokerId = (params.get('b') ?? undefined) as BrokerId | undefined

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {displayId ? (
      <DisplayWindow displayId={displayId} />
    ) : remoteCode ? (
      <RemoteView code={remoteCode} brokerId={brokerId} />
    ) : (
      <App />
    )}
  </React.StrictMode>,
)
