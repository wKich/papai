import { Database } from 'bun:sqlite'

export const openDatabase = (dbPath: string): Database => {
  const db = new Database(dbPath, { create: true })
  db.run('PRAGMA journal_mode = WAL;')
  db.run('PRAGMA foreign_keys = ON;')
  return db
}
