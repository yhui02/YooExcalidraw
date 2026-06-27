# YooExcalidraw

基于 [Excalidraw](https://github.com/excalidraw/excalidraw) 的在线白板工具，支持多用户、文件系统存储、外部工具集成。

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | [Astro 7](https://astro.build) SSR |
| UI | [daisyUI 5](https://daisyui.com) + [Tailwind CSS 4](https://tailwindcss.com) |
| React 岛屿 | [@astrojs/react](https://docs.astro.build/en/guides/integrations-guide/react/) |
| 白板引擎 | [@excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) 0.18 |
| 数据库 | [node:sqlite](https://nodejs.org/api/sqlite.html)（内置，仅存用户/会话） |
| 文件存储 | 文件系统 + `.excalidraw` JSON 格式 |
| 服务端 | [@astrojs/node](https://docs.astro.build/en/guides/integrations-guide/node/) standalone |

## 快速开始

```bash
pnpm install
pnpm dev
```

访问 `http://localhost:4321/login`，未登录时自动跳转到登录页。

**预设管理账号：** `admin` / `admin123`（首次启动自动创建）

## 项目结构

```
src/
├── components/
│   └── ExcalidrawWrapper.tsx   # React 岛屿组件
├── lib/
│   ├── db.js                   # SQLite 连接 & 建表
│   ├── auth.js                 # 用户认证（注册/登录/token）
│   └── storage.js              # 文件系统存储（核心）
├── pages/
│   ├── login.astro             # 登录/注册页
│   ├── index.astro             # 编辑器主页（未登录跳转 /login）
│   └── api/
│       ├── auth/
│       │   ├── register.js     # POST 注册
│       │   └── login.js        # POST 登录
│       └── files/
│           ├── index.js        # GET 列表 / POST 创建
│           └── [id].js         # GET / PUT / DELETE
└── styles/
    └── global.css              # Tailwind + daisyUI
```

## 存储架构

### 用户认证（SQLite）

`data/yooexcalidraw.db` 包含两张表：

- **users** — `id`, `username`, `password_hash`, `created_at`
- **sessions** — `token`, `user_id`, `expires_at`, `created_at`

Token 有效期 24 小时，SHA-256 密码哈希。

### 画板文件（文件系统）

每个用户一个目录，每个画板一个 `.excalidraw` 文件：

```
data/{username}/
├── 1782322143785-qlhuv9.excalidraw
├── 1782323033070-oz08eh.excalidraw
└── my-drawing.excalidraw
```

文件格式（标准 Excalidraw JSON）：

```json
{
  "name": "画板名称",
  "elements": [ /* Excalidraw 元素数组 */ ],
  "appState": { /* Excalidraw 应用状态 */ },
  "created": 1782322000000,
  "updated": 1782322000000
}
```

## API

所有 API 需要 `Authorization: Bearer <token>` 请求头。

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/auth/register` | 注册 `{username, password}` → `{token, username}` |
| `POST` | `/api/auth/login` | 登录 → `{token, username}` |
| `GET` | `/api/files` | 列出当前用户的画板 |
| `POST` | `/api/files` | 创建画板 `{name, scene_data?}` |
| `GET` | `/api/files/:id` | 获取画板详情（含 scene_data） |
| `PUT` | `/api/files/:id` | 更新 `{name?, scene_data?}` |
| `DELETE` | `/api/files/:id` | 删除画板 |

## 外部工具集成

项目支持**自动发现**：直接将 `.excalidraw` 文件放入用户的目录，系统会在 10 秒内自动识别并显示。

例如：

```bash
# 假设用户 testuser 的目录
DIR="data/testuser"

# 大模型或脚本直接创建文件
cat > "$DIR/llm-drawing.excalidraw" << 'EOF'
{
  "name": "AI 生成的流程图",
  "elements": [...],
  "appState": {}
}
EOF
```

前端每 10 秒轮询一次文件列表，新文件会自动出现在侧栏中。

## 开发

```bash
pnpm dev          # 开发服务器
pnpm build        # 生产构建
pnpm preview      # 预览生产构建
```

## 测试

```bash
node scripts/e2e-test.mjs
```

端到端测试覆盖：注册/登录、文件 CRUD、编辑器渲染、重命名、删除、外部文件自动发现、API 数据往返。
