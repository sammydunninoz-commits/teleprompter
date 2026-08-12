import type { JSONContent } from '@tiptap/core'

export interface RenderOpts {
  /** Talent displays set false to hide question blocks. */
  showQuestions: boolean
  /** Director-only. Notes are ALSO hard-filtered when false — see below. */
  showNotes: boolean
  questionColor: string
}

/**
 * Render a script document to HTML with per-word spans.
 *
 * Every word gets `data-wid="<blockId>#<index>"` — the stable address the
 * scroll anchor and (later) the voice aligner reference. Note blocks are only
 * ever emitted when `showNotes` is true; talent displays pass false, so a
 * director note cannot reach a talent surface even by mistake.
 */
export function renderDocToHtml(doc: JSONContent, opts: RenderOpts): string {
  const out: string[] = []
  let blockFallback = 0
  const blocks = doc.content ?? []
  for (const block of blocks) {
    const blockId = (block.attrs?.blockId as string) || `b${blockFallback}`
    blockFallback++
    renderBlock(block, blockId, opts, out)
  }
  return out.join('')
}

function renderBlock(block: JSONContent, blockId: string, opts: RenderOpts, out: string[]) {
  const type = block.type
  if (type === 'note') {
    if (!opts.showNotes) return // hard filter — never leaks to talent
    out.push(`<div class="pt-note" data-block-id="${blockId}">`)
    renderInline(block.content, blockId, out)
    out.push('</div>')
    return
  }
  if (type === 'question') {
    if (!opts.showQuestions) return
    const color = (block.attrs?.color as string) || opts.questionColor
    out.push(
      `<div class="pt-question" data-block-id="${blockId}" style="--question-color:${escapeAttr(
        color,
      )}">`,
    )
    renderInline(block.content, blockId, out)
    out.push('</div>')
    return
  }
  if (type === 'heading') {
    const level = (block.attrs?.level as number) || 2
    out.push(`<p class="pt-heading" data-block-id="${blockId}" style="font-weight:700">`)
    renderInline(block.content, blockId, out)
    out.push('</p>')
    void level
    return
  }
  // paragraph (and anything else with inline content) — default reading text
  out.push(`<p data-block-id="${blockId}">`)
  renderInline(block.content, blockId, out)
  out.push('</p>')
}

function renderInline(content: JSONContent[] | undefined, blockId: string, out: string[]) {
  let wordIdx = 0
  if (!content || content.length === 0) {
    out.push('&nbsp;')
    return
  }
  for (const inline of content) {
    if (inline.type !== 'text' || !inline.text) continue
    const marks = inline.marks ?? []
    const styleInfo = marksToStyle(marks)
    // Split on whitespace but keep the spaces so wrapping/line length is natural.
    const parts = inline.text.split(/(\s+)/)
    for (const part of parts) {
      if (part.length === 0) continue
      if (/^\s+$/.test(part)) {
        out.push(' ')
        continue
      }
      const wid = `${blockId}#${wordIdx++}`
      out.push(
        `<span class="word${styleInfo.cls}" data-wid="${wid}"${styleInfo.style}${styleInfo.pron}>` +
          escapeHtml(part) +
          '</span>',
      )
    }
  }
}

function marksToStyle(marks: { type: string; attrs?: Record<string, unknown> }[]): {
  cls: string
  style: string
  pron: string
} {
  let cls = ''
  const styles: string[] = []
  let pron = ''
  for (const m of marks) {
    if (m.type === 'bold') styles.push('font-weight:800')
    else if (m.type === 'italic') styles.push('font-style:italic')
    else if (m.type === 'ptHighlight') {
      cls += ' pt-highlight'
      const a = m.attrs ?? {}
      if (a.color) styles.push(`background:${escapeAttr(String(a.color))};color:#0a0a0a`)
      if (a.bold) styles.push('font-weight:800')
      if (a.sizeEm) styles.push(`font-size:${Number(a.sizeEm)}em`)
      if (a.spacingEm) styles.push(`letter-spacing:${Number(a.spacingEm)}em`)
      if (a.pronunciation) pron = ` data-pron="${escapeAttr(String(a.pronunciation))}"`
    }
  }
  return {
    cls,
    style: styles.length ? ` style="${styles.join(';')}"` : '',
    pron,
  }
}

/** Count reading words in a doc (questions + paragraphs; notes excluded). */
export function countWords(doc: JSONContent): number {
  let n = 0
  for (const block of doc.content ?? []) {
    if (block.type === 'note') continue
    for (const inline of block.content ?? []) {
      if (inline.type === 'text' && inline.text) {
        n += inline.text.trim().split(/\s+/).filter(Boolean).length
      }
    }
  }
  return n
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;')
}
