import { Component, type ReactNode } from 'react'

type Surface = 'display' | 'operator' | 'remote'

interface Props {
  surface: Surface
  children: ReactNode
}

interface State {
  hasError: boolean
  /** Bumped on every recovery so children fully re-mount (clearing bad state). */
  resetKey: number
  /** Consecutive failures without a clean stretch — drives back-off. */
  fails: number
}

/**
 * Catches render/effect errors so a single glitch can't leave a dead screen —
 * which, on the talent display, would end a recording with no way back.
 *
 * Instead of React's default (unmount the whole tree → blank #root), this catches
 * the error and AUTO-RECOVERS by re-mounting the subtree a moment later. Because
 * the doc/config live in the store (which survives), the display re-renders its
 * content and re-subscribes on its own. The display's fallback is solid black —
 * the prompter's own background — never a white crash page, so even the brief
 * recovery window is unobtrusive on camera. A short back-off prevents a hot crash
 * loop if something is persistently broken.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, resetKey: 0, fails: 0 }
  private timer: number | undefined

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    // Surface it for debugging without taking the screen down.
    console.error(`[autocue] ${this.props.surface} recovered from a render error:`, error)
    const fails = this.state.fails + 1
    // Recover quickly at first; back off if it keeps failing, so we never spin.
    const delay = Math.min(5000, 400 * fails)
    this.setState({ fails })
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      this.setState((s) => ({ hasError: false, resetKey: s.resetKey + 1 }))
    }, delay)
  }

  componentWillUnmount() {
    window.clearTimeout(this.timer)
  }

  render() {
    if (this.state.hasError) {
      // Display: match the prompter background (black), no text — never a white
      // page in front of the camera. Operator/remote: a quiet notice while it
      // re-mounts (they're not on camera, so a hint is helpful).
      if (this.props.surface === 'display') {
        return <div style={{ position: 'fixed', inset: 0, background: '#000' }} />
      }
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#0a0a0a',
            color: '#9ca3af',
            font: '14px system-ui, sans-serif',
          }}
        >
          Recovering…
        </div>
      )
    }
    // Keying by resetKey forces a full re-mount of the subtree on recovery.
    return <div key={this.state.resetKey} style={{ height: '100%' }}>{this.props.children}</div>
  }
}
