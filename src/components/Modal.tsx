import { useEffect, useRef, useState } from 'react'

/**
 * In-app dialogs, styled as a prompter panel rather than a browser alert.
 *
 * Native confirm()/prompt() steal focus at the OS level and look nothing like
 * the app — bad on set, where the operator is working fast on a dark screen.
 * These render inside the app, trap Enter/Escape, and autofocus the field.
 */

export interface ConfirmSpec {
  kind: 'confirm'
  title: string
  body?: string
  /** Label for the affirmative button. */
  confirmLabel?: string
  /** Style the affirmative button as destructive. */
  danger?: boolean
}

export interface PromptSpec {
  kind: 'prompt'
  title: string
  body?: string
  label: string
  initial?: string
  confirmLabel?: string
}

export type DialogSpec = ConfirmSpec | PromptSpec

/**
 * Resolves to the entered string (prompt), `true` (confirm), or null if the
 * operator backed out. Callers `await` it, so call sites read like the native
 * dialogs they replace.
 */
export type DialogResult = string | true | null

export default function Modal({
  spec,
  onClose,
}: {
  spec: DialogSpec
  onClose: (result: DialogResult) => void
}) {
  const [value, setValue] = useState(spec.kind === 'prompt' ? (spec.initial ?? '') : '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // Escape always cancels. Bound on the window so it works wherever focus sits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const trimmed = value.trim()
  const canSubmit = spec.kind === 'confirm' || trimmed.length > 0

  function submit() {
    if (!canSubmit) return
    onClose(spec.kind === 'prompt' ? trimmed : true)
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-6"
      // Click-outside cancels, matching the Escape affordance.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose(null)
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={spec.title}
        className="w-full max-w-sm rounded-lg border border-edge bg-panelalt shadow-2xl"
      >
        <div className="border-b border-edge px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-100">{spec.title}</h2>
        </div>

        <div className="flex flex-col gap-3 px-4 py-4">
          {spec.body && <p className="text-xs leading-relaxed text-neutral-400">{spec.body}</p>}

          {spec.kind === 'prompt' && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-neutral-500">{spec.label}</span>
              <input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    submit()
                  }
                }}
                className="rounded border border-edge bg-panel px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-accent"
              />
            </label>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-edge px-4 py-3">
          <button
            onClick={() => onClose(null)}
            className="rounded border border-edge px-3 py-1.5 text-sm text-neutral-300 hover:bg-edge"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className={`rounded px-3 py-1.5 text-sm text-white disabled:opacity-40 ${
              spec.kind === 'confirm' && spec.danger
                ? 'bg-red-600 hover:brightness-110'
                : 'bg-accent hover:brightness-110'
            }`}
          >
            {spec.confirmLabel ?? (spec.kind === 'prompt' ? 'OK' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
