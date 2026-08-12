import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import type { Extensions } from '@tiptap/core'
import { BlockId } from './blockId'
import { Question, NoteBlock } from './nodes'
import { PtHighlight } from './highlightMark'

/** The single schema used by the editor. Display views render the same JSON. */
export function buildExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
    }),
    Placeholder.configure({
      placeholder: 'Paste or type your script here…',
    }),
    BlockId,
    Question,
    NoteBlock,
    PtHighlight,
  ]
}
