import type { JSONContent } from '@tiptap/core'

/**
 * Export the script for sharing back to non-technical collaborators (Feature 1).
 * Markdown is clean and portable; the Word export wraps HTML in a .doc envelope
 * that Microsoft Word opens directly (no heavy docx-generation dependency).
 */

export function docToMarkdown(doc: JSONContent): string {
  const out: string[] = []
  for (const block of doc.content ?? []) {
    const text = inlineToMarkdown(block.content)
    switch (block.type) {
      case 'heading':
        out.push(`${'#'.repeat((block.attrs?.level as number) || 2)} ${text}`)
        break
      case 'question':
        out.push(`**Q:** ${text}`)
        break
      case 'note':
        out.push(`> _Note: ${text}_`)
        break
      default:
        out.push(text)
    }
    out.push('')
  }
  return out.join('\n').trim() + '\n'
}

function inlineToMarkdown(content: JSONContent[] | undefined): string {
  if (!content) return ''
  let s = ''
  for (const n of content) {
    if (n.type !== 'text' || !n.text) continue
    let t = n.text
    const marks = n.marks ?? []
    if (marks.some((m) => m.type === 'bold')) t = `**${t}**`
    if (marks.some((m) => m.type === 'italic')) t = `_${t}_`
    s += t
  }
  return s
}

function docToHtmlBody(doc: JSONContent): string {
  const out: string[] = []
  for (const block of doc.content ?? []) {
    const text = inlineToHtml(block.content)
    switch (block.type) {
      case 'heading':
        out.push(`<h${(block.attrs?.level as number) || 2}>${text}</h${(block.attrs?.level as number) || 2}>`)
        break
      case 'question':
        out.push(`<p style="color:#b8860b;font-weight:bold">Q: ${text}</p>`)
        break
      case 'note':
        out.push(`<p style="color:#777;font-style:italic">Note: ${text}</p>`)
        break
      default:
        out.push(`<p>${text}</p>`)
    }
  }
  return out.join('\n')
}

function inlineToHtml(content: JSONContent[] | undefined): string {
  if (!content) return '&nbsp;'
  let s = ''
  for (const n of content) {
    if (n.type !== 'text' || !n.text) continue
    let t = escapeHtml(n.text)
    const marks = n.marks ?? []
    if (marks.some((m) => m.type === 'bold')) t = `<b>${t}</b>`
    if (marks.some((m) => m.type === 'italic')) t = `<i>${t}</i>`
    s += t
  }
  return s
}

export function exportMarkdown(doc: JSONContent, name: string) {
  download(docToMarkdown(doc), `${safe(name)}.md`, 'text/markdown')
}

export function exportDoc(doc: JSONContent, name: string) {
  const html =
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" ` +
    `xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">` +
    `<head><meta charset="utf-8"><title>${escapeHtml(name)}</title></head>` +
    `<body style="font-family:Calibri,Arial,sans-serif;font-size:12pt">${docToHtmlBody(doc)}</body></html>`
  download(html, `${safe(name)}.doc`, 'application/msword')
}

function download(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function safe(name: string): string {
  return name.replace(/[^\w-]+/g, '_').slice(0, 60) || 'script'
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
