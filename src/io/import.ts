/**
 * Import helpers. Each returns an HTML string; the caller hands it to
 * `editor.commands.setContent(html)`, so TipTap does the HTML→document parse
 * with the project schema (bold/italic/headings preserved).
 */

export async function importDocx(file: File): Promise<string> {
  // Lazy-loaded: mammoth is ~1MB and only needed for .docx import. Still
  // precached by the service worker, so offline import works after first load.
  const mammoth = (await import('mammoth')).default
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.convertToHtml({ arrayBuffer })
  return result.value
}

export function importTextFile(text: string, isMarkdown: boolean): string {
  return isMarkdown ? markdownishToHtml(text) : plainTextToHtml(text)
}

function plainTextToHtml(text: string): string {
  const paras = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (paras.length === 0) return '<p></p>'
  return paras.map((p) => `<p>${escapeHtml(p.replace(/\n/g, ' '))}</p>`).join('')
}

/**
 * Deliberately light markdown handling — headings and paragraphs only. A full
 * markdown pipeline isn't a Phase 1 need; the operator cleans up in the editor.
 */
function markdownishToHtml(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let buf: string[] = []
  const flush = () => {
    if (buf.length) {
      out.push(`<p>${escapeHtml(buf.join(' '))}</p>`)
      buf = []
    }
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) {
      flush()
      const level = h[1].length
      out.push(`<h${level}>${escapeHtml(h[2])}</h${level}>`)
    } else if (line.trim() === '') {
      flush()
    } else {
      buf.push(line.trim())
    }
  }
  flush()
  return out.join('') || '<p></p>'
}

export async function importFile(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.docx')) return importDocx(file)
  if (name.endsWith('.pdf')) {
    const { importPdf } = await import('./importPdf')
    return importPdf(file)
  }
  const text = await file.text()
  return importTextFile(text, name.endsWith('.md') || name.endsWith('.markdown'))
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
