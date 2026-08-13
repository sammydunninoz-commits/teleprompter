import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import DisplayWindow from './display/DisplayWindow'
import RemoteView from './remote/RemoteView'
import type { BrokerId } from './remote/relay'
import { installUpdateHandling } from './lib/appUpdate'
import { ErrorBoundary } from './lib/ErrorBoundary'
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

// Stale-bundle self-heal runs on the operator/remote — but NEVER on the talent
// display, where an automatic reload is a blank screen mid-recording.
installUpdateHandling(!displayId)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {displayId ? (
      // The talent display is recording-critical: a self-recovering boundary keeps
      // it from ever white-screening on a stray render/message error.
      <ErrorBoundary surface="display">
        <DisplayWindow displayId={displayId} />
      </ErrorBoundary>
    ) : remoteCode ? (
      <ErrorBoundary surface="remote">
        <RemoteView code={remoteCode} brokerId={brokerId} />
      </ErrorBoundary>
    ) : (
      <ErrorBoundary surface="operator">
        <App />
      </ErrorBoundary>
    )}
  </React.StrictMode>,
)
