import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = join(DATA_DIR, 'excalidraw.db');
let db;

function seedAdmin() {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!existing) {
    const hash = createHash('sha256').update('admin123').digest('hex');
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('admin', hash);
  }
}

export function getDB() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        filename TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_files_username ON files(username);
    `);
    seedAdmin();
  }
  return db;
}

export function listFiles(username) {
  return getDB().prepare(
    'SELECT id, name, filename, created_at, updated_at FROM files WHERE username = ? ORDER BY name DESC'
  ).all(username).map(r => ({
    id: r.id,
    name: r.name,
    filename: r.filename,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function getFileRecord(username, fileId) {
  const r = getDB().prepare(
    'SELECT id, name, filename, created_at, updated_at FROM files WHERE username = ? AND id = ?'
  ).get(username, fileId);
  return r ? {
    id: r.id,
    name: r.name,
    filename: r.filename,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  } : null;
}

export function createFileRecord(username, id, name, filename) {
  const now = Date.now();
  getDB().prepare(
    'INSERT INTO files (id, username, name, filename, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, username, name, filename, now, now);
}

export function updateFileRecord(username, fileId, { name, filename }) {
  const now = Date.now();
  const sets = [];
  const params = [];
  if (name !== undefined) { sets.push('name = ?'); params.push(name); }
  if (filename !== undefined) { sets.push('filename = ?'); params.push(filename); }
  if (sets.length > 0) {
    sets.push('updated_at = ?');
    params.push(now);
    params.push(username, fileId);
    getDB().prepare(
      `UPDATE files SET ${sets.join(', ')} WHERE username = ? AND id = ?`
    ).run(...params);
  }
}

export function deleteFileRecord(username, fileId) {
  getDB().prepare('DELETE FROM files WHERE username = ? AND id = ?').run(username, fileId);
}

export function renameFileRecord(username, oldId, newId, newFilename) {
  const now = Date.now();
  getDB().prepare(
    'UPDATE files SET id = ?, filename = ?, updated_at = ? WHERE username = ? AND id = ?'
  ).run(newId, newFilename, now, username, oldId);
}
