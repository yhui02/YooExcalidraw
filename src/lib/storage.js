import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, renameSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { getDB, listFiles as dbListFiles, getFileRecord, createFileRecord, updateFileRecord, deleteFileRecord, renameFileRecord } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');

// Initialize DB on module load
getDB();

function userDir(username) {
  const d = join(DATA_DIR, username);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function sanitizeName(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'untitled';
}

// Import existing on-disk files into SQLite on first run
function ensureFilesImported(username) {
  const dir = userDir(username);
  const existing = dbListFiles(username);
  const dbIds = new Set(existing.map(r => r.id));
  let imported = false;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries
    .filter(e => e.isFile() && e.name.endsWith('.excalidraw'))
    .forEach(e => {
      const id = e.name.replace(/\.excalidraw$/, '');
      if (!dbIds.has(id)) {
        const fullPath = join(dir, e.name);
        let name = id;
        try {
          const parsed = JSON.parse(readFileSync(fullPath, 'utf-8'));
          name = parsed.name || id;
        } catch {}
        createFileRecord(username, id, name, e.name);
        imported = true;
      }
    });
  return imported;
}

export function listFiles(username) {
  ensureFilesImported(username);
  const dir = userDir(username);
  return dbListFiles(username).map(r => {
    const path = join(dir, r.filename);
    let sceneData = '{}';
    try {
      const content = readFileSync(path, 'utf-8');
      const parsed = JSON.parse(content);
      sceneData = JSON.stringify(parsed);
    } catch {}
    return {
      id: r.id,
      name: r.name,
      path,
      scene_data: sceneData,
    };
  });
}

export function getFile(username, fileId) {
  ensureFilesImported(username);
  const dir = userDir(username);
  const record = getFileRecord(username, fileId);
  if (!record) return null;
  const path = join(dir, record.filename);
  let content = '{}';
  try { content = readFileSync(path, 'utf-8'); } catch {}
  return {
    id: record.id,
    name: record.name,
    scene_data: content,
  };
}

export function createFile(username, name, sceneData) {
  const dir = userDir(username);
  const sanitized = sanitizeName(name);
  let filename = sanitized + '.excalidraw';
  let path = join(dir, filename);
  let counter = 1;
  while (existsSync(path)) {
    filename = sanitized + ' (' + counter + ').excalidraw';
    path = join(dir, filename);
    counter++;
  }

  const content = {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: sceneData?.elements || [],
    appState: sceneData?.appState ? {
      ...(sceneData.appState.viewBackgroundColor != null ? { viewBackgroundColor: sceneData.appState.viewBackgroundColor } : {}),
      ...(sceneData.appState.gridSize != null ? { gridSize: sceneData.appState.gridSize } : {}),
    } : {},
    files: {},
  };

  writeFileSync(path, JSON.stringify(content, null, 2), 'utf-8');
  const id = filename.replace(/\.excalidraw$/, '');
  createFileRecord(username, id, sanitized, filename);
  return getFile(username, id);
}

export function updateFile(username, fileId, { name, scene_data }) {
  const dir = userDir(username);
  const record = getFileRecord(username, fileId);
  if (!record) return null;

  let filename = record.filename;
  if (name !== undefined) {
    const sanitized = sanitizeName(name);
    const newFilename = sanitized + '.excalidraw';
    if (newFilename !== filename) {
      let finalFilename = newFilename;
      let newPath = join(dir, finalFilename);
      let counter = 1;
      while (existsSync(newPath)) {
        finalFilename = sanitized + ' (' + counter + ').excalidraw';
        newPath = join(dir, finalFilename);
        counter++;
      }
      const oldPath = join(dir, filename);
      if (existsSync(oldPath)) renameSync(oldPath, newPath);
      renameFileRecord(username, fileId, finalFilename.replace(/\.excalidraw$/, ''), finalFilename);
      filename = finalFilename;
      fileId = finalFilename.replace(/\.excalidraw$/, '');
    }
    updateFileRecord(username, fileId, { name: sanitized });
  }

  if (scene_data !== undefined) {
    const path = join(dir, filename);
    // Write raw scene_data directly as the complete file content
    try {
      const parsed = typeof scene_data === 'string' ? JSON.parse(scene_data) : scene_data;
      const content = {
        type: 'excalidraw',
        version: 2,
        source: 'https://excalidraw.com',
        elements: parsed.elements || [],
        appState: parsed.appState ? {
          ...(parsed.appState.viewBackgroundColor != null ? { viewBackgroundColor: parsed.appState.viewBackgroundColor } : {}),
          ...(parsed.appState.gridSize != null ? { gridSize: parsed.appState.gridSize } : {}),
        } : {},
        files: {},
      };
      writeFileSync(path, JSON.stringify(content, null, 2), 'utf-8');
    } catch {
      writeFileSync(path, scene_data);
    }
  }

  return getFile(username, fileId);
}

export function deleteFile(username, fileId) {
  const dir = userDir(username);
  const record = getFileRecord(username, fileId);
  if (!record) return false;
  const path = join(dir, record.filename);
  if (existsSync(path)) unlinkSync(path);
  deleteFileRecord(username, fileId);
  return true;
}
