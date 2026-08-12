import type { EditorState, Transaction } from '@tiptap/pm/state'

interface CommandProps {
  state: EditorState
  tr: Transaction
  dispatch?: ((tr: Transaction) => void) | undefined
}

/**
 * Toggle a block node type (question / note) scoped to the SELECTION rather than
 * the whole paragraph.
 *
 * - Highlight part of a line + toggle → only the highlighted text is split out
 *   into its own block of `typeName`; the text before/after stays as paragraphs.
 * - Caret only (no selection), or a selection covering the whole block → convert
 *   the whole block, as before.
 * - Already this type → revert the covered block(s) back to paragraphs.
 *
 * Questions/notes remain true block nodes (needed for auto-hold, per-display
 * visibility, and the notes-never-render guarantee) — we just isolate the
 * selected text into its own block first, so the button feels like Bold.
 */
export function toggleBlockOnSelection(typeName: 'question' | 'note') {
  return () =>
    ({ state, tr, dispatch }: CommandProps): boolean => {
      const nodeType = state.schema.nodes[typeName]
      const paragraph = state.schema.nodes.paragraph
      if (!nodeType || !paragraph) return false

      const sel = state.selection
      const { from, to, empty, $from, $to } = sel

      // Toggle OFF: caret/selection sits in a block already of this type.
      if ($from.parent.type === nodeType) {
        if (dispatch) {
          tr.setBlockType(from, to, paragraph)
          dispatch(tr)
        }
        return true
      }

      const sameBlock = $from.sameParent($to)
      const blockStart = $from.start()
      const blockEnd = $from.end()
      const coversWholeBlock = from <= blockStart && to >= blockEnd

      // Whole-block cases: empty selection, cross-block selection, or the entire
      // block is selected → just convert the block(s).
      if (empty || !$from.parent.isTextblock || !sameBlock || coversWholeBlock) {
        if (dispatch) {
          tr.setBlockType(from, to, nodeType)
          dispatch(tr)
        }
        return true
      }

      // Partial selection inside one block → isolate the selected text into its
      // own block, then set that block's type. We split off the text after and
      // before the selection, then convert only the isolated block by targeting
      // a single interior position (a range would spill into the next block).
      if (dispatch) {
        tr.split(to)
        tr.split(from)
        const mFrom = tr.mapping.map(from)
        const mTo = tr.mapping.map(to)
        const interior = Math.floor((mFrom + mTo) / 2)
        tr.setBlockType(interior, interior, nodeType)
        dispatch(tr)
      }
      return true
    }
}
