import { readFileSync, writeFileSync, renameSync, statSync, readdirSync, mkdtempSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import path from 'path';

const PY_ENCODER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'compress-images.py');

// 清理 .excalidraw 里未被引用的二进制（files 条目），并顺带找回丢失的图片数据。
//
// 历史 bug：保存时写入的是 Excalidraw 内存里累积的全量文件仓库，导致图片被复制进每个打开并
// 保存过的画布（单文件可达 100MB+），同时部分画布的元素引用着本文件里已不存在的 blob。
//
// 执行顺序（找回必须排在剪枝之前，否则可复用的残留会被删掉）：
//   1. 全量扫描建索引：fileId -> 承载它的画布。fileId 是 SHA-1(原始字节)，跨画布精确命中即同一张图
//   2. 从其他画布把"被引用但本文件缺失"的 blob 回补进来
//   3. 剪除本文件里没有任何元素、也没有任何素材库条目引用的 blob
//
// 用法：
//   node scripts/clean-excalidraw-files.mjs <目录或文件...>                # 试运行，只报告
//   node scripts/clean-excalidraw-files.mjs --write <目录或文件...>         # 就地改写（文件名不变）
//   --compress           额外把被引用的图片按原生口径重编码（1440px / 质量 80，有损，不可逆）
//   --index-only <目录>  只作为找回的数据来源，永不改写（可重复传多个只读画布目录）
//   --manifest <路径>    输出 JSON 审计清单：每个文件补了什么、删了什么、还缺什么

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const compress = argv.includes('--compress');
const targets = [];
const indexOnly = [];
let manifestArg;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--write' || a === '--compress') continue;
  if (a === '--manifest' || a === '--index-only') {
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      console.error(`${a} 需要一个路径参数`);
      process.exit(1);
    }
    if (a === '--manifest') manifestArg = value;
    else indexOnly.push(path.resolve(value));
    i++;
    continue;
  }
  if (a.startsWith('--')) {
    console.error(`未知参数：${a}`);
    process.exit(1);
  }
  targets.push(path.resolve(a));
}

if (targets.length === 0) {
  console.log(
    '用法: node scripts/clean-excalidraw-files.mjs [--write] [--compress] [--index-only <目录>] [--manifest <路径>] <目录或文件...>',
  );
  process.exit(1);
}

const manifestPath = manifestArg ? path.resolve(manifestArg) : null;
const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2);

function collectFiles(list) {
  const out = [];
  for (const item of list) {
    const abs = path.resolve(item);
    let st;
    try {
      st = statSync(abs);
    } catch {
      console.log(`跳过：路径不存在 ${abs}`);
      continue;
    }
    if (st.isDirectory()) {
      for (const entry of readdirSync(abs, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        out.push(...collectFiles([path.join(abs, entry.name)]));
      }
    } else if (abs.endsWith('.excalidraw')) {
      out.push(abs);
    }
  }
  return out;
}

function readScene(abs) {
  const data = JSON.parse(readFileSync(abs, 'utf-8'));
  if (data.type !== 'excalidraw') return null;
  if (!data.files || typeof data.files !== 'object') data.files = {};
  return data;
}

// 素材库条目里的图片元素同样依赖 files 里的 blob，因此引用集合要一起覆盖 libraryItems
function referencedFileIds(data) {
  const ids = new Set();
  const scan = (list) => {
    if (!Array.isArray(list)) return;
    for (const el of list) if (el && el.fileId) ids.add(el.fileId);
  };
  scan(data.elements);
  for (const item of data.libraryItems || []) scan(item && item.elements);
  return ids;
}

// ---------- --compress：把被引用的图片重编码成 webp（缩放 1440px / 质量 80，有损、不可逆）----------
const MAX_DIM = 1440; // = Excalidraw DEFAULT_MAX_IMAGE_WIDTH_OR_HEIGHT
const QUALITY = 80; // = 原生 resizeImageFile 的 0.8
const COMPRESS_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg' };
const MIN_COMPRESS_BYTES = 60 * 1024;

function dataURLBytes(url) {
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}

function cleanDir(dir) {
  for (const name of readdirSync(dir)) rmSync(path.join(dir, name), { force: true });
}

// 缩放与编码交给 scripts/compress-images.py（一个画布起一次进程），Node 只做取舍：
// 重编码后反而变大的就保留原图。
function compressReferenced(data, dirs) {
  // 裁剪过的图片用原始像素坐标描述裁剪区，换分辨率会导致裁剪错位，必须跳过
  const cropped = new Set();
  for (const el of data.elements || []) {
    const c = el?.crop;
    if (el?.fileId && c && (c.top || c.right || c.bottom || c.left)) cropped.add(el.fileId);
  }

  const jobs = [];
  for (const [id, blob] of Object.entries(data.files)) {
    const ext = COMPRESS_EXT[blob.mimeType];
    if (!ext || !blob.dataURL || cropped.has(id)) continue;
    const raw = dataURLBytes(blob.dataURL);
    if (raw.length < MIN_COMPRESS_BYTES) continue;
    const key = String(jobs.length);
    writeFileSync(path.join(dirs.in, `${key}.${ext}`), raw);
    jobs.push({ key, id, raw });
  }
  if (!jobs.length) return [];

  let results;
  try {
    const stdout = execFileSync(
      'python3',
      [PY_ENCODER, dirs.in, dirs.out, '--max-dim', String(MAX_DIM), '--quality', String(QUALITY)],
      { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 },
    );
    results = JSON.parse(stdout);
  } catch (e) {
    problems.push(`图片重编码不可用（${e.message.split('\n')[0]}），本次跳过压缩`);
    cleanDir(dirs.in);
    cleanDir(dirs.out);
    return [];
  }

  const records = [];
  for (const job of jobs) {
    const r = results[job.key];
    if (!r || r.error || r.bytes >= job.raw.length) continue;
    const before = JSON.stringify(data.files[job.id]).length;
    const encoded = readFileSync(path.join(dirs.out, `${job.key}.webp`));
    data.files[job.id] = {
      ...data.files[job.id],
      mimeType: 'image/webp',
      dataURL: `data:image/webp;base64,${encoded.toString('base64')}`,
    };
    records.push({
      id: job.id,
      fromKB: Math.round(job.raw.length / 1024),
      toKB: Math.round(encoded.length / 1024),
      before,
      after: JSON.stringify(data.files[job.id]).length,
    });
  }
  cleanDir(dirs.in);
  cleanDir(dirs.out);
  return records;
}

const compressDirs = compress
  ? {
      in: mkdtempSync(path.join(tmpdir(), 'excal-in-')),
      out: mkdtempSync(path.join(tmpdir(), 'excal-out-')),
    }
  : null;
const writeFiles = collectFiles(targets);
const indexFiles = collectFiles(indexOnly);
const writeSet = new Set(writeFiles);
const problems = [];

// ---------- 第 1 趟：建索引 + 统计每个文件要补/要删什么 ----------
const homeOfFileId = new Map(); // fileId -> 承载它的画布
const plan = new Map(); // 待改写文件 -> { missing, orphans, orphanBytes, total }

for (const abs of [...writeFiles, ...indexFiles]) {
  let data;
  try {
    data = readScene(abs);
  } catch (e) {
    problems.push(`${abs} — 无法解析（${e.message}），本次不处理`);
    continue;
  }
  if (!data) continue;

  const refs = referencedFileIds(data);
  const keys = Object.keys(data.files);
  for (const id of keys) if (!homeOfFileId.has(id)) homeOfFileId.set(id, abs);
  if (!writeSet.has(abs)) {
    data = null;
    continue;
  }

  const missing = [...refs].filter((id) => !data.files[id]);
  const orphans = keys.filter((id) => !refs.has(id));
  const orphanBytes = orphans.reduce((n, id) => n + JSON.stringify(data.files[id]).length, 0);
  if (orphans.length || missing.length || compress) {
    plan.set(abs, { missing, orphans, orphanBytes, total: keys.length });
  } else if (refs.size === 0 && statSync(abs).size > 2 * 1024 * 1024) {
    problems.push(`${abs} — 无图片元素却有 ${mb(statSync(abs).size)}MB，请人工确认`);
  }
  data = null;
}

// ---------- 第 2 趟：确定来源，从来源画布取出待回补的 blob ----------
const targetNeeds = new Map(); // 待改写文件 -> [fileId]
const sourceNeeds = new Map(); // 来源文件 -> Set<fileId>
const stillMissing = new Map(); // 待改写文件 -> [fileId]

for (const [abs, meta] of plan) {
  const need = [];
  const unresolvable = [];
  for (const id of meta.missing) {
    const home = homeOfFileId.get(id);
    if (home && home !== abs) {
      need.push(id);
      if (!sourceNeeds.has(home)) sourceNeeds.set(home, new Set());
      sourceNeeds.get(home).add(id);
    } else {
      unresolvable.push(id);
    }
  }
  if (need.length) targetNeeds.set(abs, need);
  if (unresolvable.length) stillMissing.set(abs, unresolvable);
}

const recovered = new Map(); // fileId -> blob
for (const [abs, ids] of sourceNeeds) {
  let data;
  try {
    data = readScene(abs);
  } catch {
    continue;
  }
  if (data) {
    for (const id of ids) {
      const blob = data.files[id];
      if (blob && blob.dataURL && !recovered.has(id)) recovered.set(id, blob);
    }
  }
  data = null;
}

// ---------- 第 3 趟：回补 + 剪枝 +（可选）重压缩 + 落盘 ----------
const manifest = { mode: `${write ? 'write' : 'dry-run'}${compress ? ' +compress' : ''}`, files: {} };
let changed = 0;
let reclaimed = 0;
let recoveredCount = 0;
let compressedCount = 0;

for (const [abs, meta] of plan) {
  const doRecover = (targetNeeds.get(abs) || []).filter((id) => recovered.has(id));
  const sizeBefore = statSync(abs).size;

  let data;
  try {
    data = readScene(abs);
  } catch (e) {
    problems.push(`${abs} — 重新解析失败（${e.message}），跳过`);
    continue;
  }
  if (!data) continue;

  const refs = referencedFileIds(data);
  const removed = Object.keys(data.files).filter((id) => !refs.has(id));
  for (const id of doRecover) {
    data.files[id] = { ...recovered.get(id), lastRetrieved: Date.now() };
  }
  for (const id of removed) delete data.files[id];
  const compressed = compress ? compressReferenced(data, compressDirs) : [];

  if (!removed.length && !doRecover.length && !compressed.length) {
    data = null;
    continue;
  }

  const out = JSON.stringify(data, null, 2);
  const sizeAfter = Buffer.byteLength(out);
  manifest.files[abs] = {
    sizeBeforeMB: +mb(sizeBefore),
    sizeAfterMB: +mb(sizeAfter),
    pruned: removed,
    recovered: doRecover,
    compressed,
    stillMissing: stillMissing.get(abs) || [],
  };

  if (write) {
    const tmp = `${abs}.cleaning.tmp`;
    writeFileSync(tmp, out);
    renameSync(tmp, abs);
    changed++;
  }
  reclaimed += sizeBefore - sizeAfter;
  recoveredCount += doRecover.length;
  compressedCount += compressed.length;
  console.log(
    `${path.basename(abs)}: ${mb(sizeBefore)}MB → ${mb(sizeAfter)}MB${
      removed.length ? `，剪除 ${removed.length}/${meta.total} 条未引用数据` : ''
    }${doRecover.length ? `，回补 ${doRecover.length} 张丢失图片` : ''}${
      compressed.length ? `，重压缩 ${compressed.length} 张图` : ''
    }${write ? '' : '（试运行）'}`,
  );
  data = null;
}
if (compressDirs) {
  rmSync(compressDirs.in, { recursive: true, force: true });
  rmSync(compressDirs.out, { recursive: true, force: true });
}

// ---------- 汇总 ----------
console.log('');
console.log(`扫描 ${writeFiles.length + indexFiles.length} 个文件（其中可改写 ${writeFiles.length} 个）`);
console.log(
  write
    ? `已改写 ${changed} 个，净释放 ${mb(reclaimed)}MB，回补 ${recoveredCount} 张图片，重压缩 ${compressedCount} 张图片`
    : `试运行（未改写）：可释放 ${mb(reclaimed)}MB，可回补 ${recoveredCount} 张，可重压缩 ${compressedCount} 张${
        reclaimed || recoveredCount || compressedCount ? '，加 --write 就地生效' : ''
      }`,
);
if (manifestPath) {
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`审计清单：${manifestPath}`);
}

const unresolved = [...stillMissing.values()].reduce((n, list) => n + list.length, 0);
if (unresolved || problems.length) {
  console.log('\n需要关注:');
  for (const [abs, ids] of stillMissing) {
    console.log(
      `  - ${abs} — ${ids.length} 张图片在所有已扫描画布里都找不到，无法找回: ${ids.slice(0, 3).join(', ')}${ids.length > 3 ? ' ...' : ''}`,
    );
  }
  for (const p of problems) console.log(`  - ${p}`);
}
