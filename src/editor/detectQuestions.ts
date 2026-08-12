import type { Editor } from '@tiptap/react'

/**
 * After importing a document, auto-convert paragraphs that look like interview
 * questions into `question` blocks (so they get the question styling / colour and
 * the voice coast-through behaviour) — matching what the operator would do by
 * hand with the "Q" button.
 *
 * Heuristics (kept deliberately conservative so reading lines aren't misfired):
 *  - the line ends with a question mark, OR
 *  - the line starts with a "Q:" / "Q." / "Q)" / "Question:" marker.
 * A leading marker is stripped, since the question block renders its own "Q:".
 *
 * Returns the number of paragraphs converted.
 */
const MARKER = /^\s*(Q|Question)\s*[:.)-]\s+/i

export function applyQuestionDetection(editor: Editor): number {
  const { state } = editor
  const qType = state.schema.nodes.question
  if (!qType) return 0

  interface Hit {
    pos: number
    markerLen: number
  }
  const hits: Hit[] = []

  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return
    const text = node.textContent
    const trimmed = text.trim()
    if (!trimmed) return
    const marker = MARKER.exec(text)
    const isQuestion = trimmed.endsWith('?') || !!marker
    if (isQuestion) hits.push({ pos, markerLen: marker ? marker[0].length : 0 })
  })

  if (hits.length === 0) return 0

  const tr = state.tr
  // Process last→first so earlier positions stay valid as we edit.
  for (let i = hits.length - 1; i >= 0; i--) {
    const { pos, markerLen } = hits[i]
    if (markerLen > 0) {
      // Delete the leading marker text (block content starts at pos + 1).
      tr.delete(pos + 1, pos + 1 + markerLen)
    }
    tr.setNodeMarkup(pos, qType)
  }
  editor.view.dispatch(tr)
  return hits.length
}
