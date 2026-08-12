import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect } from 'react'
import { buildExtensions } from './extensions'
import { useStore } from '../store/useStore'
import EditorToolbar from './EditorToolbar'
import { applyQuestionDetection } from './detectQuestions'

/**
 * Edit-mode surface: the full TipTap editor. It is the source of truth while
 * editing; every change flows into the store as JSON (which bumps docVersion
 * and broadcasts to any display windows for live editing).
 */
export default function EditorPane() {
  const setDoc = useStore((s) => s.setDoc)
  const initialDoc = useStore.getState().doc

  const editor = useEditor({
    extensions: buildExtensions(),
    content: initialDoc,
    editorProps: {
      attributes: {
        class: 'prompter-doc focus:outline-none px-6 py-4 text-lg leading-relaxed',
      },
    },
    onUpdate: ({ editor }) => {
      setDoc(editor.getJSON())
    },
  })

  // Allow external content loads (import / project open) to replace the doc.
  useEffect(() => {
    if (!editor) return
    if (import.meta.env.DEV) {
      ;(window as unknown as { __editor: typeof editor }).__editor = editor
    }
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ html?: string; detectQuestions?: boolean }>).detail
      if (detail?.html != null) {
        editor.commands.setContent(detail.html)
        // Imported documents: auto-mark question lines as question blocks.
        if (detail.detectQuestions) {
          const n = applyQuestionDetection(editor)
          if (n > 0) flashImportInfo(n)
        }
      } else {
        editor.commands.setContent(useStore.getState().doc)
      }
      // setContent's emitUpdate is unreliable across TipTap versions, so push the
      // new document into the store explicitly (bumps docVersion + broadcasts to
      // any display windows).
      setDoc(editor.getJSON())
    }
    window.addEventListener('autocue:setcontent', handler as EventListener)
    return () => window.removeEventListener('autocue:setcontent', handler as EventListener)
  }, [editor])

  if (!editor) return null

  return (
    <div className="flex h-full flex-col">
      <EditorToolbar editor={editor} />
      <div className="thin-scroll flex-1 overflow-auto bg-panel">
        <div className="mx-auto max-w-3xl">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}

let flashTimer: number | undefined
function flashImportInfo(count: number) {
  let el = document.getElementById('autocue-flash')
  if (!el) {
    el = document.createElement('div')
    el.id = 'autocue-flash'
    el.style.cssText =
      'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#1c1c1c;border:1px solid #2a2a2a;color:#e5e5e5;padding:8px 16px;border-radius:8px;font-size:14px;z-index:9999;transition:opacity .3s'
    document.body.appendChild(el)
  }
  el.textContent = `Imported — ${count} question${count === 1 ? '' : 's'} auto-detected`
  el.style.opacity = '1'
  window.clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => {
    if (el) el.style.opacity = '0'
  }, 2200)
}
