import { requireAuth, getUsername } from '@/lib/auth.js';
import { listFiles, createFile } from '@/lib/storage.js';

export const prerender = false;

export async function GET(context) {
  const userId = requireAuth(context);
  if (!userId) {
    return new Response(JSON.stringify({ code: 1, msg: '未登录' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const username = getUsername(userId);
  const files = listFiles(username).map(f => ({
    id: f.id,
    name: f.name,
  }));

  return new Response(JSON.stringify({ code: 0, data: files }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(context) {
  const userId = requireAuth(context);
  if (!userId) {
    return new Response(JSON.stringify({ code: 1, msg: '未登录' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await context.request.json();
    const username = getUsername(userId);
    const file = createFile(username, body.name || '未命名', body.scene_data || null);
    return new Response(JSON.stringify({ code: 0, data: { id: file.id, name: file.name } }), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ code: 1, msg: '创建失败' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
