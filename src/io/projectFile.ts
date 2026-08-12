import type { Project } from '../store/types'

/** Native project format is plain JSON — portable and diff-friendly. */
export function exportProjectJson(p: Project) {
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safe(p.name)}.autocue.json`
  a.click()
  URL.revokeObjectURL(url)
}

export async function importProjectJson(file: File): Promise<Project> {
  const text = await file.text()
  const p = JSON.parse(text) as Project
  if (!p.doc || p.doc.type !== 'doc') throw new Error('Not a valid autocue project file')
  return p
}

function safe(name: string): string {
  return name.replace(/[^\w-]+/g, '_').slice(0, 60) || 'script'
}
