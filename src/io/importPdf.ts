/**
 * PDF import (Feature 1 / Phase 3). pdf.js returns positioned text fragments,
 * not clean paragraphs, so we rebuild structure with Y-position heuristics and
 * expect the operator to tidy up afterwards in the editor. Loaded lazily —
 * pdf.js is heavy and only needed for this path.
 */
export async function importPdf(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  // Bundle the worker locally (no CDN) so import works offline.
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const data = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data }).promise
  const paragraphs: string[] = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()

    // Group text items into lines by their Y coordinate (transform[5]).
    type Line = { y: number; parts: { x: number; str: string }[] }
    const lines: Line[] = []
    for (const item of content.items as TextItem[]) {
      if (!('str' in item)) continue
      const x = item.transform[4]
      const y = item.transform[5]
      let line = lines.find((l) => Math.abs(l.y - y) < 3)
      if (!line) {
        line = { y, parts: [] }
        lines.push(line)
      }
      line.parts.push({ x, str: item.str })
    }
    // Top-to-bottom, then left-to-right.
    lines.sort((a, b) => b.y - a.y)

    const lineTexts = lines.map((l) =>
      l.parts
        .sort((a, b) => a.x - b.x)
        .map((pp) => pp.str)
        .join('')
        .replace(/\s+/g, ' ')
        .trim(),
    )

    // Merge consecutive lines into paragraphs: a blank line, or a line that ends
    // with sentence punctuation, ends the current paragraph.
    let buf = ''
    for (const lt of lineTexts) {
      if (lt === '') {
        if (buf) {
          paragraphs.push(buf.trim())
          buf = ''
        }
        continue
      }
      buf += (buf ? ' ' : '') + lt
      if (/[.!?:]["')\]]?$/.test(lt)) {
        paragraphs.push(buf.trim())
        buf = ''
      }
    }
    if (buf) paragraphs.push(buf.trim())
  }

  if (paragraphs.length === 0) return '<p></p>'
  return paragraphs.map((t) => `<p>${escapeHtml(t)}</p>`).join('')
}

interface TextItem {
  str: string
  transform: number[]
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
