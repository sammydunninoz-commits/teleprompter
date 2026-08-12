import { Mark, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    ptHighlight: {
      setPtHighlight: (attrs?: Partial<HighlightAttrs>) => ReturnType
      togglePtHighlight: (attrs?: Partial<HighlightAttrs>) => ReturnType
      unsetPtHighlight: () => ReturnType
    }
  }
}

export interface HighlightAttrs {
  color: string | null
  bold: boolean
  /** Relative size multiplier — size & spacing aid legibility more than colour. */
  sizeEm: number | null
  spacingEm: number | null
  /** Optional phonetic string rendered small above the word (Phase 2 UI). */
  pronunciation: string | null
}

/**
 * Persistent highlight (Feature 4). A mark, not a node — carries style plus an
 * optional pronunciation hint. Distinct from the runtime "live highlight",
 * which is applied as a DOM decoration and never saved into the document.
 */
export const PtHighlight = Mark.create({
  name: 'ptHighlight',

  addAttributes() {
    return {
      color: {
        default: '#fde047',
        parseHTML: (el) => el.getAttribute('data-color'),
        renderHTML: (a) => (a.color ? { 'data-color': a.color } : {}),
      },
      bold: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-bold') === 'true',
        renderHTML: (a) => ({ 'data-bold': String(!!a.bold) }),
      },
      sizeEm: {
        default: null,
        parseHTML: (el) => numAttr(el, 'data-size'),
        renderHTML: (a) => (a.sizeEm ? { 'data-size': String(a.sizeEm) } : {}),
      },
      spacingEm: {
        default: null,
        parseHTML: (el) => numAttr(el, 'data-spacing'),
        renderHTML: (a) => (a.spacingEm ? { 'data-spacing': String(a.spacingEm) } : {}),
      },
      pronunciation: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-pron'),
        renderHTML: (a) => (a.pronunciation ? { 'data-pron': a.pronunciation } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-pt-highlight]' }]
  },

  renderHTML({ HTMLAttributes, mark }) {
    const a = mark.attrs as HighlightAttrs
    const style = [
      a.color ? `background:${a.color};color:#0a0a0a` : '',
      a.bold ? 'font-weight:800' : '',
      a.sizeEm ? `font-size:${a.sizeEm}em` : '',
      a.spacingEm ? `letter-spacing:${a.spacingEm}em` : '',
    ]
      .filter(Boolean)
      .join(';')
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-pt-highlight': '',
        class: 'pt-highlight',
        style,
      }),
      0,
    ]
  },

  addCommands() {
    return {
      setPtHighlight:
        (attrs) =>
        ({ commands }) =>
          commands.setMark(this.name, attrs),
      togglePtHighlight:
        (attrs) =>
        ({ commands }) =>
          commands.toggleMark(this.name, attrs),
      unsetPtHighlight:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    }
  },
})

function numAttr(el: HTMLElement, name: string): number | null {
  const v = el.getAttribute(name)
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
