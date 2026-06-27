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
    const user = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(username);
    if (!user || user.password_hash !== hashPassword(password)) {
      return new Response(JSON.stringify({ code: 1, msg: '用户名或密码错误' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }

    const token = createSession(user.id);
    return new Response(JSON.stringify({ code: 0, data: { token, username } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ code: 1, msg: '登录失败' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
