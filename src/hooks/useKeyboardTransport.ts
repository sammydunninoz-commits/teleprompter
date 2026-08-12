import { useEffect } from 'react'
import { useStore } from '../store/useStore'
import { offsetAt, nowMs } from '../scroll/transport'

/**
 * Keyboard transport (Feature 2). Manual control always takes priority over any
 * automatic (future voice) movement. Ignored while typing in an input/editor.
 */
export function useKeyboardTransport(enabled: boolean) {
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

      const s = useStore.getState()
      const current = offsetAt(s.transport, nowMs())

      switch (e.key) {
        case ' ':
          e.preventDefault()
          s.togglePlay(current)
          break
        case 'ArrowUp':
          e.preventDefault()
          s.setWpm(Math.min(700, s.settings.wpm + 5))
          break
        case 'ArrowDown':
          e.preventDefault()
          s.setWpm(Math.max(20, s.settings.wpm - 5))
          break
        case 'ArrowRight':
          e.preventDefault()
          s.scrubTo(current + 120)
          break
        case 'ArrowLeft':
          e.preventDefault()
          s.scrubTo(Math.max(0, current - 120))
          break
        case 'Home':
          e.preventDefault()
          s.scrubTo(0)
          break
        case 'b':
        case 'B': {
          e.preventDefault()
          // Toggle blackout across every display (operator preview + windows).
          const anyOn = s.displays.some((d) => d.blackout)
          s.blackoutAll(!anyOn)
          break
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
