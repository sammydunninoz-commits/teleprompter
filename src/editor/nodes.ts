import { Node, mergeAttributes } from '@tiptap/core'
import { toggleBlockOnSelection } from './toggleBlockOnSelection'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    question: {
      setQuestion: () => ReturnType
      toggleQuestion: () => ReturnType
    }
    note: {
      setNote: () => ReturnType
      toggleNote: () => ReturnType
    }
  }
}

/**
 * Question block — a distinct block type (not a mark). The scroll engine
 * auto-holds at the end of each of these (Feature 2). Visibility is toggleable
 * per display (Feature 4).
 */
export const Question = Node.create({
  name: 'question',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      color: { default: null as string | null },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="question"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const color = node.attrs.color as string | null
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'question',
        class: 'pt-question',
        // Drives the CSS var so the editor preview shows the per-block colour.
        style: color ? `--question-color:${color}` : undefined,
      }),
      0,
    ]
  },

  addCommands() {
    return {
      setQuestion:
        () =>
        ({ commands }) =>
          commands.setNode(this.name),
      toggleQuestion: toggleBlockOnSelection('question'),
    }
  },
})

/**
 * Director-only note block (e.g. "pause here", "look at camera 2").
 * NEVER rendered on a talent display — the display view filters these out by
 * type, independent of any per-display toggle.
 */
export const NoteBlock = Node.create({
  name: 'note',
  group: 'block',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="note"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'note', class: 'pt-note' }),
      0,
    ]
  },

  addCommands() {
    return {
      setNote:
        () =>
        ({ commands }) =>
          commands.setNode(this.name),
      toggleNote: toggleBlockOnSelection('note'),
    }
  },
})
