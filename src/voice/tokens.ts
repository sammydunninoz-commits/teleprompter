import type { JSONContent } from '@tiptap/core'

export interface ScriptToken {
  /** Stable word address — matches renderDoc's `${blockId}#${wordIndex}`. */
  wid: string
  /** Original word as written. */
  text: string
  /** Normalised form used for matching (lowercase, punctuation stripped). */
  norm: string
  /** Global reading-order index. */
  index: number
  /** True if this token belongs to a question block (coasted through by voice). */
  isQuestion: boolean
  /** True only for normal reading paragraphs (not headings/titles or questions). */
  isReading: boolean
}

/**
 * Flatten a script document into an ordered list of reading tokens with their
 * stable word IDs. Note blocks are excluded (never spoken by talent). The wid
 * scheme mirrors renderDoc exactly so the aligner's positions map straight onto
 * the rendered word spans.
 */
export function tokensFromDoc(doc: JSONContent): ScriptToken[] {
  const tokens: ScriptToken[] = []
  let blockFallback = 0
  let index = 0
  for (const block of doc.content ?? []) {
    const blockId = (block.attrs?.blockId as string) || `b${blockFallback}`
    blockFallback++
    if (block.type === 'note') continue
    const isQuestion = block.type === 'question'
    const isReading = block.type === 'paragraph'
    let wordIdx = 0
    for (const inline of block.content ?? []) {
      if (inline.type !== 'text' || !inline.text) continue
      for (const raw of inline.text.split(/\s+/)) {
        if (!raw) continue
        const norm = normalizeWord(raw)
        const wid = `${blockId}#${wordIdx++}`
        if (!norm) continue // punctuation-only chunk: keep wid slot, skip token
        tokens.push({ wid, text: raw, norm, index: index++, isQuestion, isReading })
      }
    }
  }
  return tokens
}

/**
 * A short human-readable excerpt of the script starting at a given word id —
 * used to label director flags so it's obvious which line they point at.
 */
export function snippetForWid(doc: JSONContent, wid: string | null, count = 9): string {
  if (!wid) return ''
  const toks = tokensFromDoc(doc)
  const i = toks.findIndex((t) => t.wid === wid)
  if (i < 0) return ''
  const text = toks.slice(i, i + count).map((t) => t.text).join(' ')
  return text + (i + count < toks.length ? '…' : '')
}

export function normalizeWord(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]/g, '')
}
