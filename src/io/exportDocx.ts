import type { JSONContent } from '@tiptap/core'

/**
 * Real OOXML .docx export (Library → Export).
 *
 * io/export.ts already has `exportDoc`, which wraps HTML in a Word envelope and
 * saves it as .doc. Word opens that, but Google Docs and Pages handle it poorly
 * and it is not actually a .docx. This produces a genuine one.
 *
 * The `docx` library is imported dynamically — it is a few hundred KB and only
 * ever needed the moment someone clicks Export.
 */

/** Colour for question blocks in the exported document (matches the prompter). */
const QUESTION_COLOR = 'B8860B'
const NOTE_COLOR = '777777'

export async function exportDocx(doc: JSONContent, name: string): Promise<void> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx')

  /** TipTap inline nodes → docx runs, preserving bold/italic. */
  const runs = (content: JSONContent[] | undefined, base?: { color?: string; italics?: boolean }) => {
    if (!content?.length) return [new TextRun({ text: '', ...base })]
    return content
      .filter((n) => n.type === 'text' && n.text)
      .map((n) => {
        const marks = n.marks ?? []
        return new TextRun({
          text: n.text!,
          bold: marks.some((m) => m.type === 'bold') || undefined,
          italics: marks.some((m) => m.type === 'italic') || base?.italics || undefined,
          color: base?.color,
        })
      })
  }

  const headingFor = (level: number) =>
    level === 1
      ? HeadingLevel.HEADING_1
      : level === 3
        ? HeadingLevel.HEADING_3
        : HeadingLevel.HEADING_2

  const paragraphs = (doc.content ?? []).map((block) => {
    switch (block.type) {
      case 'heading':
        return new Paragraph({
          heading: headingFor((block.attrs?.level as number) || 2),
          children: runs(block.content),
        })
      case 'question':
        // Questions are the interviewer's lines — kept visually distinct so the
        // exported script reads the same way the prompter shows it.
        return new Paragraph({
          spacing: { before: 200, after: 120 },
          children: [
            new TextRun({ text: 'Q: ', bold: true, color: QUESTION_COLOR }),
            ...runs(block.content, { color: QUESTION_COLOR }),
          ],
        })
      case 'note':
        return new Paragraph({
          spacing: { before: 120, after: 120 },
          children: [
            new TextRun({ text: 'Note: ', italics: true, color: NOTE_COLOR }),
            ...runs(block.content, { color: NOTE_COLOR, italics: true }),
          ],
        })
      default:
        return new Paragraph({ spacing: { after: 160 }, children: runs(block.content) })
    }
  })

  const file = new Document({
    creator: 'autocue',
    title: name,
    sections: [{ children: paragraphs.length ? paragraphs : [new Paragraph({ children: [] })] }],
  })

  const blob = await Packer.toBlob(file)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safe(name)}.docx`
  a.click()
  URL.revokeObjectURL(url)
}

function safe(name: string): string {
  return name.replace(/[^\w-]+/g, '_').slice(0, 60) || 'script'
}
