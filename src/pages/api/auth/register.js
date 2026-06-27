import { hashPassword, createSession } from '@/lib/auth.js';
import { getDB } from '@/lib/db.js';

export const prerender = false;

export async function POST(context) {
  try {
    const body = await context.request.json();
    const { username, password } = body;
    if (!username || !password) {
      return new Response(JSON.stringify({ code: 1, msg: '用户名和密码不能为空' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = getDB();
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return new Response(JSON.stringify({ code: 1, msg: '用户名已存在' }), {
        status: 409, headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hashPassword(password));
    const token = createSession(result.lastInsertRowid);

    return new Response(JSON.stringify({ code: 0, data: { token, username } }), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ code: 1, msg: '注册失败' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
