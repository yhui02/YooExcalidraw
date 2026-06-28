# YooExcalidraw

YooExcalidraw 是一个基于 Excalidraw 的本地画板管理工具，支持加载整个文件夹、在多文件间快速切换编辑，所有数据都存储在本地。

## 项目背景

Excalidraw 官方工具只能一次加载并修改一个文件，无法加载文件夹，也无法在多文件间快速切换。YooExcalidraw 解决了这些问题：

- **文件夹管理** — 直接加载整个文件夹，文件按目录自动分组
- **多文件切换** — 在文件夹内自由切换和编辑多个画板，数据实时读写到本地
- **本地存储** — 采用和官方同样的浏览器本地文件方案，不依赖后台，所有数据只存在你的电脑上

## 在线使用

部署在 GitHub Pages 上，无需安装，打开浏览器即可使用：

[项目在线地址](https://yhui02.github.io/YooExcalidraw)

## 浏览器兼容性

本工具依赖 [File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)，仅在以下浏览器中可用：

| 浏览器 | 支持情况 | 最低版本 |
|---|---|---|
| Chrome | 支持 | 86+ |
| Edge | 支持 | 86+ |
| Opera | 支持 | 91+ |
| Firefox | 不支持 | — |
| Safari | 不支持 | — |
| Samsung Internet | 不支持 | — |

> Chrome 105+ 可获得完整的重命名支持。

## 快速开始

```bash
pnpm install
pnpm dev
```

访问 `http://localhost:4321`，点击"选择文件夹"打开一个包含 `.excalidraw` 文件的本地目录即可开始使用。

## 功能

- **文件夹管理** — 直接加载整个文件夹，文件按目录分组展示
- **多文件支持** — 在文件夹内自由切换和编辑多个画板文件
- **本地存储** — 使用浏览器本地文件 API，数据只存在你的电脑上
- **主题切换** — 支持 light / dark / auto 三种主题
- **文件操作** — 新建、重命名、删除画板文件
- **拖放添加** — 拖拽文件夹到界面上即可添加

## 开发

```bash
pnpm dev          # 启动开发服务器
pnpm build        # 构建生产版本
pnpm preview      # 预览生产构建
```
