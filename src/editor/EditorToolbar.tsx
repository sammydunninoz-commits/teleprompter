import type { Editor } from '@tiptap/react'
import { useRef } from 'react'
import { importFile } from '../io/import'

interface Props {
  editor: Editor
}

const HIGHLIGHT_COLORS = ['#fde047', '#86efac', '#93c5fd', '#f9a8d4', '#fdba74']
const QUESTION_COLORS = ['#fbbf24', '#f87171', '#34d399', '#60a5fa', '#c084fc']

export default function EditorToolbar({ editor }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)

  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const html = await importFile(file)
      window.dispatchEvent(
        new CustomEvent('autocue:setcontent', { detail: { html, detectQuestions: true } }),
      )
    } catch (err) {
      alert(`Import failed: ${(err as Error).message}`)
    } finally {
      e.target.value = ''
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-edge bg-panelalt px-3 py-2 text-sm">
      <Btn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
        <b>B</b>
      </Btn>
      <Btn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <i>I</i>
      </Btn>
      <Sep />
      <Btn
        active={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H
      </Btn>
      <Btn
        active={editor.isActive('question')}
        onClick={() => editor.chain().focus().toggleQuestion().run()}
        title="Mark as question (auto-holds during roll)"
      >
        Q
      </Btn>
      <Btn
        active={editor.isActive('note')}
        onClick={() => editor.chain().focus().toggleNote().run()}
        title="Director note (never shown on talent display)"
      >
        Note
      </Btn>

      {/* Per-question colour — only shown when the cursor is in a question block */}
      {editor.isActive('question') && (
        <span className="ml-1 flex items-center gap-1 rounded bg-panel px-1.5 py-0.5">
          <span className="text-xs text-neutral-500">Q colour</span>
          {QUESTION_COLORS.map((c) => {
            const active = editor.isActive('question', { color: c })
            return (
              <button
                key={c}
                className={`h-5 w-5 rounded-full border ${
                  active ? 'border-white' : 'border-edge'
                }`}
                style={{ background: c }}
                title={`Question colour ${c}`}
                onClick={() => editor.chain().focus().updateAttributes('question', { color: c }).run()}
              />
            )
          })}
          <input
            type="color"
            className="h-5 w-6 cursor-pointer rounded border border-edge bg-transparent p-0"
            title="Custom question colour"
            value={(editor.getAttributes('question').color as string) || '#fbbf24'}
            onChange={(e) =>
              editor.chain().focus().updateAttributes('question', { color: e.target.value }).run()
            }
          />
          <button
            className="rounded px-1 text-xs text-neutral-400 hover:bg-edge"
            title="Reset to project default colour"
            onClick={() => editor.chain().focus().updateAttributes('question', { color: null }).run()}
          >
            ✕
          </button>
        </span>
      )}

      <Sep />
      <span className="px-1 text-xs text-neutral-500">Highlight:</span>
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c}
          className="h-6 w-6 rounded border border-edge"
          style={{ background: c }}
          title={`Highlight ${c}`}
          onClick={() => editor.chain().focus().setPtHighlight({ color: c }).run()}
        />
      ))}
      <Btn
        onClick={() => editor.chain().focus().setPtHighlight({ color: null, bold: true }).run()}
        title="Highlight by bold (no colour)"
      >
        A+
      </Btn>
      <Btn
        onClick={() => editor.chain().focus().unsetPtHighlight().run()}
        title="Remove highlight"
      >
        ✕
      </Btn>

      {/* Pronunciation hint — shown when the selection is highlighted */}
      {editor.isActive('ptHighlight') && (
        <input
          type="text"
          placeholder="say: e.g. NEE-tzsche"
          className="w-36 rounded border border-edge bg-panel px-2 py-1 text-xs"
          title="Phonetic hint shown small above the word on the prompter"
          value={(editor.getAttributes('ptHighlight').pronunciation as string) || ''}
          onChange={(e) =>
            editor
              .chain()
              .focus()
              .updateAttributes('ptHighlight', { pronunciation: e.target.value || null })
              .run()
          }
        />
      )}
      <Sep />
      <Btn onClick={() => editor.chain().focus().undo().run()}>↶</Btn>
      <Btn onClick={() => editor.chain().focus().redo().run()}>↷</Btn>

      <div className="ml-auto">
        <button
          className="rounded bg-accent px-3 py-1 font-medium text-white hover:brightness-110"
          onClick={() => fileRef.current?.click()}
        >
          Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".docx,.pdf,.txt,.md,.markdown"
          className="hidden"
          onChange={onImport}
        />
      </div>
    </div>
  )
}

function Btn({
  children,
  active,
  onClick,
  title,
}: {
  children: React.ReactNode
  active?: boolean
  onClick: () => void
  title?: string
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`min-w-[2rem] rounded px-2 py-1 hover:bg-edge ${
        active ? 'bg-accent text-white' : 'text-neutral-200'
      }`}
    >
      {children}
    </button>
  )
}

function Sep() {
  return <span className="mx-1 h-5 w-px bg-edge" />
}
