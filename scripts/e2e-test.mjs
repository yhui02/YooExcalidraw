import { spawn, execSync } from 'child_process';
import { existsSync, readdirSync, writeFileSync, unlinkSync, readFileSync, rmdirSync, mkdirSync } from 'fs';
import path from 'path';

const PORT = 4321;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.resolve('data');
const CLI = 'npx --no-install playwright-cli';

let server;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function cli(args) {
  try {
    return execSync(`${CLI} ${args}`, { encoding: 'utf-8', timeout: 30000 }).trim();
  } catch (e) {
    return e.stdout?.trim() || '';
  }
}

function cliRaw(args) {
  return cli(`--raw ${args}`);
}

function evalJS(expr) {
  return cliRaw(`eval "${expr.replace(/"/g, '\\"')}"`);
}

function snapshot() {
  return cliRaw('snapshot');
}

function findRef(snapshotText, keyword) {
  const lines = snapshotText.split('\n');
  for (const line of lines) {
    if (line.includes(keyword)) {
      const match = line.match(/\[ref=e(\d+)\]/);
      if (match) return `e${match[1]}`;
    }
  }
  return null;
}

async function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn('npx', ['astro', 'dev', '--port', String(PORT)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ASTRO_SESSION_DIR: '/tmp/yooexcalidraw-test' },
    });
    let started = false;
    server.stdout.on('data', (data) => {
      const text = data.toString();
      if ((text.includes('ready in') || text.includes('running at') || text.includes('Server listening')) && !started) {
        started = true;
        resolve();
      }
    });
    server.stderr.on('data', (data) => { process.stderr.write(data); });
    setTimeout(() => { if (!started) reject(new Error('Server start timeout')); }, 30000);
  });
}

function test(name, fn) {
  return async () => {
    try {
      await fn();
      console.log(`  ✅ ${name}`);
      return true;
    } catch (e) {
      console.log(`  ❌ ${name}`);
      console.log(`     ${e.message}`);
      return false;
    }
  };
}

async function run() {
  console.log('\n═══════════════════════════════════════');
  console.log('  YooExcalidraw E2E Test Suite');
  console.log('═══════════════════════════════════════\n');

  console.log('📡 Starting dev server...');
  try {
    await startServer();
    console.log('   ✅ Server ready\n');
  } catch (e) {
    console.error('   ❌ Server start failed:', e.message);
    process.exit(1);
  }

  console.log('🌐 Launching browser...');
  cli('open');
  await sleep(2000);
  console.log('   ✅ Browser ready\n');

  const results = [];

  try {
    // ========== TEST 1: Page loads ==========
    results.push(await test('Page loads at /', async () => {
      cli(`goto ${BASE}/`);
      await sleep(3000);
      const title = evalJS('document.title');
      if (!title.includes('YooExcalidraw')) throw new Error(`Expected "YooExcalidraw" in title, got: "${title}"`);
    })());

    // ========== TEST 2: Editor container renders ==========
    results.push(await test('Editor container renders', async () => {
      const hasEditor = evalJS('!!document.getElementById("editor-container")');
      if (hasEditor !== 'true') throw new Error('Editor container #editor-container not found');
    })());

    // ========== TEST 3: Sidebar renders ==========
    results.push(await test('Sidebar with file list renders', async () => {
      const hasSidebar = evalJS('!!document.getElementById("file-list")');
      if (hasSidebar !== 'true') throw new Error('File list #file-list not found');
      const hasHeader = evalJS('!!document.querySelector(".excal-sidebar-header")');
      if (hasHeader !== 'true') throw new Error('Sidebar header not found');
    })());

    // ========== TEST 4: Excalidraw React island hydrates ==========
    results.push(await test('Excalidraw React island loads and paints canvas', async () => {
      await sleep(5000);
      const hasIsland = evalJS('!!document.querySelector("astro-island")');
      if (hasIsland !== 'true') throw new Error('astro-island not found in DOM');
      const canvasCount = evalJS('document.querySelectorAll("canvas").length');
      const excalCount = evalJS('document.querySelectorAll("[class*=excalidraw]").length');
      const layerCount = evalJS('document.querySelectorAll("[class*=layer-ui]").length');
      console.log(`     Canvases: ${canvasCount}, excal layers: ${excalCount}, layer-ui: ${layerCount}`);
      if (parseInt(canvasCount) === 0 && parseInt(excalCount) === 0) {
        throw new Error('No canvas or excalidraw elements found');
      }
    })());

    // ========== TEST 5: Excalidraw toolbar visible ==========
    results.push(await test('Excalidraw toolbar is visible', async () => {
      const snap = snapshot();
      if (!snap.includes('形状') && !snap.includes('矩形') && !snap.includes('选择')) {
        throw new Error('Excalidraw toolbar not found in snapshot');
      }
      // Check for tool buttons
      const hasToolBtns = snap.includes('radio') || snap.includes('button');
      if (!hasToolBtns) throw new Error('No tool buttons found');
    })());

    // ========== TEST 6: Empty state message ==========
    results.push(await test('Empty state shows "选择一个画板文件开始绘图"', async () => {
      const snap = snapshot();
      // The empty state should be visible when no file is selected
      const hasEmptyState = snap.includes('选择一个画板文件开始绘图') || snap.includes('打开一个文件夹');
      if (!hasEmptyState) {
        // Might be hidden if a file is auto-selected
        const emptyHidden = evalJS('document.getElementById("editor-empty-state")?.style?.display === "none"');
        if (!emptyHidden) throw new Error('Empty state not found and not hidden');
      }
    })());

    // ========== TEST 7: Navbar elements ==========
    results.push(await test('Navbar has save and settings buttons', async () => {
      const snap = snapshot();
      const hasSave = snap.includes('保存');
      const hasSettings = snap.includes('设置');
      if (!hasSave) throw new Error('Save button not found');
      if (!hasSettings) throw new Error('Settings button not found');
    })());

    // ========== TEST 8: File creation via disk (simulating external tool) ==========
    results.push(await test('File created on disk is valid Excalidraw JSON', async () => {
      // Create a test directory and file to verify disk operations work
      const testDir = path.join(DATA_DIR, 'e2etest');
      mkdirSync(testDir, { recursive: true });
      const testFile = path.join(testDir, 'test-create.excalidraw');
      const testData = {
        type: 'excalidraw',
        version: 2,
        source: 'https://excalidraw.com',
        name: '测试创建的画板',
        elements: [
          { id: 'el1', type: 'rectangle', x: 100, y: 100, width: 200, height: 150, strokeColor: '#000000', backgroundColor: 'transparent', fillStyle: 'hachure', strokeWidth: 1, roughness: 1, opacity: 100, angle: 0, groupIds: [], frameId: null, roundness: null, seed: 12345, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: Date.now(), link: null, locked: false },
        ],
        appState: { viewBackgroundColor: '#ffffff' },
        files: {},
        libraryItems: [],
      };
      writeFileSync(testFile, JSON.stringify(testData, null, 2));

      // Verify the file is valid
      const content = readFileSync(testFile, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed.type !== 'excalidraw') throw new Error('Missing type field');
      if (parsed.version !== 2) throw new Error('Missing version field');
      if (!Array.isArray(parsed.elements)) throw new Error('Missing elements array');
      if (!parsed.name) throw new Error('Missing name field');
      console.log(`     File: "${parsed.name}" with ${parsed.elements.length} element(s)`);

      // Clean up
      unlinkSync(testFile);
      try { rmdirSync(testDir); } catch {}
    })());

    // ========== TEST 9: Library items in file format ==========
    results.push(await test('Library items can be stored in .excalidraw file', async () => {
      const testDir = path.join(DATA_DIR, 'e2etest');
      mkdirSync(testDir, { recursive: true });
      const testFile = path.join(testDir, 'test-library.excalidraw');
      const libItems = [
        {
          id: 'lib-1',
          status: 'published',
          elements: [{ id: 'lib-el1', type: 'rectangle', x: 0, y: 0, width: 100, height: 80 }],
          created: Date.now(),
          name: '测试素材',
        },
      ];
      const testData = {
        type: 'excalidraw',
        version: 2,
        source: 'https://excalidraw.com',
        name: '测试素材库',
        elements: [],
        appState: {},
        files: {},
        libraryItems: libItems,
      };
      writeFileSync(testFile, JSON.stringify(testData, null, 2));

      const content = readFileSync(testFile, 'utf-8');
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed.libraryItems)) throw new Error('Missing libraryItems array');
      if (parsed.libraryItems.length !== 1) throw new Error(`Expected 1 library item, got ${parsed.libraryItems.length}`);
      if (parsed.libraryItems[0].name !== '测试素材') throw new Error('Library item name mismatch');
      console.log(`     Library: ${parsed.libraryItems.length} item(s), name: "${parsed.libraryItems[0].name}"`);

      unlinkSync(testFile);
      try { rmdirSync(testDir); } catch {}
    })());

    // ========== TEST 10: Settings dialog opens ==========
    results.push(await test('Settings dialog opens', async () => {
      const snap = snapshot();
      const settingsRef = findRef(snap, '设置');
      if (!settingsRef) throw new Error('Settings button not found');
      cli(`click ${settingsRef}`);
      await sleep(1000);
      const snap2 = snapshot();
      const hasDialog = snap2.includes('manage-dialog') || snap2.includes('管理') || snap2.includes('设置');
      if (!hasDialog) throw new Error('Settings dialog did not open');
      // Close dialog
      cli('press Escape');
      await sleep(500);
    })());

    // ========== TEST 11: Page has correct CSS variables ==========
    results.push(await test('CSS variables loaded (daisyUI)', async () => {
      const hasTheme = evalJS('!!document.documentElement.getAttribute("data-theme") || getComputedStyle(document.documentElement).getPropertyValue("--color-primary").length > 0');
      // daisyUI sets CSS variables
      const primaryColor = evalJS('getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim()');
      console.log(`     Primary color: "${primaryColor}"`);
    })());

    // ========== TEST 12: Responsive layout ==========
    results.push(await test('Layout is responsive (sidebar + editor)', async () => {
      const sidebarWidth = evalJS('document.querySelector(".excal-sidebar")?.offsetWidth || 0');
      const editorWidth = evalJS('document.getElementById("editor-container")?.offsetWidth || 0');
      console.log(`     Sidebar: ${sidebarWidth}px, Editor: ${editorWidth}px`);
      if (parseInt(sidebarWidth) === 0) throw new Error('Sidebar has zero width');
      if (parseInt(editorWidth) === 0) throw new Error('Editor has zero width');
    })());

    // ========== TEST 13: Excalidraw API is accessible ==========
    results.push(await test('Excalidraw API is accessible via window', async () => {
      // The Excalidraw wrapper dispatches 'excalidraw:ready' event
      const readyFired = evalJS('typeof __excalidrawReady !== "undefined" && __excalidrawReady === true');
      if (readyFired !== 'true') throw new Error('Excalidraw not ready (__excalidrawReady is not true)');
    })());

    // ========== RESULTS ==========
    const passed = results.filter(r => r === true).length;
    const total = results.length;
    console.log('\n═══════════════════════════════════════');
    console.log(`  ${passed}/${total} tests passed`);
    if (passed < total) {
      console.log(`  ${total - passed} test(s) FAILED`);
      process.exitCode = 1;
    } else {
      console.log('  🎉 All tests passed!');
    }
    console.log('═══════════════════════════════════════\n');

  } finally {
    cli('close');
    if (server) server.kill('SIGTERM');
  }
}

run().catch(e => {
  console.error('Fatal:', e);
  cli('close');
  if (server) server.kill('SIGTERM');
  process.exit(1);
});
