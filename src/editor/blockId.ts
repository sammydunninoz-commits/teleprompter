import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { nanoid } from 'nanoid'

const TARGET_TYPES = ['paragraph', 'question', 'note', 'heading']

/**
 * Assigns a stable `blockId` to every block node and keeps it unique.
 *
 * Word/token addressing (spec core data model) is derived as
 * `${blockId}#${wordIndex}` at render time. Because ids live on block nodes and
 * survive edits, a word's address only shifts when its own block is edited —
 * edits in other blocks leave the talent's anchored position untouched.
 */
export const BlockId = Extension.create({
  name: 'blockId',

  addGlobalAttributes() {
    return [
      {
        types: TARGET_TYPES,
        attributes: {
          blockId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => el.getAttribute('data-block-id'),
            renderHTML: (attrs) =>
              attrs.blockId ? { 'data-block-id': attrs.blockId } : {},
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('blockId'),
        appendTransaction: (_transactions, _oldState, newState) => {
          const seen = new Set<string>()
          const missing: { pos: number; id: string }[] = []
          newState.doc.descendants((node, pos) => {
            if (!TARGET_TYPES.includes(node.type.name)) return
            const id = node.attrs.blockId as string | null
            if (!id || seen.has(id)) {
              missing.push({ pos, id: nanoid(8) })
            } else {
              seen.add(id)
            }
          })
          if (missing.length === 0) return null
          const tr = newState.tr
          for (const m of missing) {
            const node = tr.doc.nodeAt(m.pos)
            if (node) tr.setNodeAttribute(m.pos, 'blockId', m.id)
          }
          tr.setMeta('addToHistory', false)
          return tr
        },
      }),
    ]
  },
})
