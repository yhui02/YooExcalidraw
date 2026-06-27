import { createHash, randomBytes } from 'node:crypto';
import { getDB } from './db.js';

const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000;

export function hashPassword(password) {
  return createHash('sha256').update(password).digest('hex');
}

export function createSession(userId) {
  const db = getDB();
  const token = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + TOKEN_EXPIRY_MS;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  return token;
}

export function verifyToken(token) {
  if (!token) return null;
  const db = getDB();
  const session = db.prepare('SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?').get(token, Date.now());
  return session ? session.user_id : null;
}

export function removeToken(token) {
  if (!token) return;
  getDB().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function requireAuth(context) {
  const auth = context.request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  const userId = verifyToken(token);
  if (!userId) return null;
  return userId;
}

export function getUsername(userId) {
  const user = getDB().prepare('SELECT username FROM users WHERE id = ?').get(userId);
  return user ? user.username : null;
}
