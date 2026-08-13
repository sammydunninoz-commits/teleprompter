import { useEffect } from 'react'
import { WPM_STEP, type TransportCommand } from '../scroll/commands'

/**
 * Keyboard transport (Feature 2). Manual control always takes priority over any
 * automatic (voice) movement. Ignored while typing in an input/editor.
 *
 * The hook emits COMMANDS rather than touching the store, so the same bindings
 * serve both windows: the operator applies them directly, while a display window
 * sends them up the control channel. Operators habitually leave focus on the
 * talent window, where nothing used to respond at all.
 */
export function useKeyboardTransport(
  enabled: boolean,
  dispatch: (cmd: TransportCommand) => void,
  opts: { allowBlackout?: boolean } = {},
) {
  const { allowBlackout = true } = opts
  useEffect(() => {
    if (!enabled) return
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (
        target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA'
      )
        return

      // Shift takes a bigger bite out of the speed, for when a read is badly
      // off pace rather than drifting.
      const step = e.shiftKey ? WPM_STEP * 4 : WPM_STEP

      switch (e.key) {
        case ' ':
          e.preventDefault()
          dispatch({ type: 'toggle' })
          break
        case 'ArrowUp':
          e.preventDefault()
          dispatch({ type: 'wpm-step', delta: step })
          break
        case 'ArrowDown':
          e.preventDefault()
          dispatch({ type: 'wpm-step', delta: -step })
          break
        case 'ArrowRight':
          e.preventDefault()
          dispatch({ type: 'nudge', delta: 120 })
          break
        case 'ArrowLeft':
          e.preventDefault()
          dispatch({ type: 'nudge', delta: -120 })
          break
        case 'PageUp':
          e.preventDefault()
          dispatch({ type: 'prev-paragraph' })
          break
        case 'Home':
          e.preventDefault()
          dispatch({ type: 'top' })
          break
        case 'b':
        case 'B':
          // Not honoured from the talent display: operators habitually leave focus
          // on that window, and a stray 'b' there would black out every screen and
          // look like a fault mid-take. Blackout stays an operator-console action.
          if (!allowBlackout) break
          e.preventDefault()
          dispatch({ type: 'blackout-toggle' })
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, dispatch, allowBlackout])
}
