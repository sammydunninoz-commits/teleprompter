import Dexie, { type EntityTable } from 'dexie'
import type { DirectorFlag, LinkedDoc, Project } from './types'

/**
 * Local-first structured storage. Projects live here; a project can also be
 * saved to disk as a .json via the File System Access API (see io/projectFile.ts).
 */
export const db = new Dexie('autocue') as Dexie & {
  projects: EntityTable<Project, 'id'>
  flags: EntityTable<DirectorFlag, 'id'>
  links: EntityTable<LinkedDoc, 'projectId'>
}

db.version(1).stores({
  projects: 'id, name, updatedAt',
  // Flags persist per take, not overwritten — enables comparing take 2 vs take 1.
  flags: 'id, takeId, atMs',
})

// v2 adds live-document links: one persistent file handle per project.
db.version(2).stores({
  projects: 'id, name, updatedAt',
  flags: 'id, takeId, atMs',
  links: 'projectId',
})

export async function saveProject(p: Project): Promise<void> {
  await db.projects.put({ ...p, updatedAt: Date.now() })
}

export async function loadProject(id: string): Promise<Project | undefined> {
  return db.projects.get(id)
}

export async function listProjects(): Promise<Project[]> {
  return db.projects.orderBy('updatedAt').reverse().toArray()
}

export async function deleteProject(id: string): Promise<void> {
  await db.projects.delete(id)
  await db.links.delete(id)
}

export async function saveLink(link: LinkedDoc): Promise<void> {
  await db.links.put(link)
}

export async function getLink(projectId: string): Promise<LinkedDoc | undefined> {
  return db.links.get(projectId)
}

export async function deleteLink(projectId: string): Promise<void> {
  await db.links.delete(projectId)
}
