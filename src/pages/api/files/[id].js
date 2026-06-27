import { requireAuth, getUsername } from '@/lib/auth.js';
import { getFile, updateFile, deleteFile } from '@/lib/storage.js';

export const prerender = false;

export async function GET(context) {
  const userId = requireAuth(context);
  if (!userId) {
    return new Response(JSON.stringify({ code: 1, msg: '未登录' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const username = getUsername(userId);
  const file = getFile(username, context.params.id);
  if (!file) {
    return new Response(JSON.stringify({ code: 1, msg: '文件不存在' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ code: 0, data: file }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

export async function PUT(context) {
  const userId = requireAuth(context);
  if (!userId) {
    return new Response(JSON.stringify({ code: 1, msg: '未登录' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const username = getUsername(userId);
  const file = getFile(username, context.params.id);
  if (!file) {
    return new Response(JSON.stringify({ code: 1, msg: '文件不存在' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await context.request.json();
    const updated = updateFile(username, context.params.id, body);
    return new Response(JSON.stringify({ code: 0, data: { id: updated.id, name: updated.name } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ code: 1, msg: '更新失败' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function DELETE(context) {
  const userId = requireAuth(context);
  if (!userId) {
    return new Response(JSON.stringify({ code: 1, msg: '未登录' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const username = getUsername(userId);
  if (!deleteFile(username, context.params.id)) {
    return new Response(JSON.stringify({ code: 1, msg: '文件不存在' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ code: 0, msg: '已删除' }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
