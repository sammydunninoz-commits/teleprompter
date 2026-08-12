import { useCallback, useRef, useState } from 'react'
import Modal, { type DialogResult, type DialogSpec } from './Modal'

/**
 * Awaitable in-app dialogs.
 *
 * Gives call sites the same straight-line shape the native dialogs had —
 * `if (!(await ask({ kind: 'confirm', … }))) return` — without the browser
 * chrome. Render `dialog` somewhere in the component that owns the hook.
 */
export function useDialog() {
  const [spec, setSpec] = useState<DialogSpec | null>(null)
  const resolveRef = useRef<((r: DialogResult) => void) | null>(null)

  const ask = useCallback((next: DialogSpec) => {
    // A second ask() while one is open would strand the first promise, so
    // settle it as cancelled before taking over.
    resolveRef.current?.(null)
    setSpec(next)
    return new Promise<DialogResult>((resolve) => {
      resolveRef.current = resolve
    })
  }, [])

  const close = useCallback((result: DialogResult) => {
    setSpec(null)
    const resolve = resolveRef.current
    resolveRef.current = null
    resolve?.(result)
  }, [])

  const dialog = spec ? <Modal spec={spec} onClose={close} /> : null

  return { dialog, ask }
}
