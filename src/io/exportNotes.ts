import type { DirectorFlag } from '../store/types'
import { formatDuration } from '../scroll/transport'

/** Export director notes to a downloadable .json or .txt file. */
export function exportNotesJson(flags: DirectorFlag[], projectName: string) {
  download(JSON.stringify(flags, null, 2), `${safe(projectName)}-notes.json`, 'application/json')
}

export function exportNotesTxt(flags: DirectorFlag[], projectName: string) {
  const byTake = new Map<string, DirectorFlag[]>()
  for (const f of flags) {
    if (!byTake.has(f.takeId)) byTake.set(f.takeId, [])
    byTake.get(f.takeId)!.push(f)
  }
  const lines: string[] = [`Director notes — ${projectName}`, '']
  for (const items of byTake.values()) {
    const sorted = [...items].sort((a, b) => a.atMs - b.atMs)
    lines.push(`## ${sorted[0].takeLabel}`)
    for (const f of sorted) {
      const time = formatDuration(f.atMs / 1000)
      const ref = f.snippet ? `  "${f.snippet}"` : ''
      lines.push(`[${time}] ${f.label}${ref}`)
    }
    lines.push('')
  }
  download(lines.join('\n'), `${safe(projectName)}-notes.txt`, 'text/plain')
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
