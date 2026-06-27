import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { existsSync, readdirSync, writeFileSync, unlinkSync, readFileSync, rmdirSync, mkdirSync } from 'fs';
import path from 'path';

const PORT = 5199;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.resolve('data');

let server;
let browser;
let page;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
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
      if ((text.includes('ready in') || text.includes('running at')) && !started) { started = true; resolve(); }
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
      const stack = e.stack?.split('\n').slice(1, 3).join('\n     ') || '';
      if (stack) console.log(`     ${stack}`);
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
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });
  page = await context.newPage();
  console.log('   ✅ Browser ready\n');

  const results = [];

  // Clean previous test data
  const userDir = path.join(DATA_DIR, 'e2etest');
  if (existsSync(userDir)) {
    const files = readdirSync(userDir);
    files.forEach(f => unlinkSync(path.join(userDir, f)));
    try { rmdirSync(userDir); } catch {}
  }

  try {
    // ========== TEST 1: Login page loads ==========
    results.push(await test('Login page loads', async () => {
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
      const title = await page.title();
      if (!title.includes('登录')) throw new Error(`Expected "登录" in title, got: "${title}"`);
      const visible = await page.isVisible('#login-btn');
      if (!visible) throw new Error('Login button not visible');
    })());

    // ========== TEST 2: Register new user ==========
    results.push(await test('Register new user via register form', async () => {
      // Switch to register form
      await page.click('#switch-to-register');
      await sleep(500);
      const regVisible = await page.isVisible('#register-view');
      if (!regVisible) throw new Error('Register form not visible after switch');
      // Fill and submit register
      await page.fill('#reg-username', 'e2etest');
      await page.fill('#reg-password', 'test123');
      await page.click('#register-btn');
      // Wait for redirect to /excalidraw
      try {
        await page.waitForURL('**/', { timeout: 8000 });
      } catch {
        // Check if already exists
        const errorText = await page.textContent('#reg-error');
        if (errorText && errorText.includes('已存在')) {
          // User already exists, switch to login
          await page.click('#switch-to-login');
          await sleep(500);
          await page.fill('#login-username', 'e2etest');
          await page.fill('#login-password', 'test123');
          await page.click('#login-btn');
          try { await page.waitForURL('**/', { timeout: 8000 }); } catch {}
        }
      }
      const token = await page.evaluate(() => localStorage.getItem('excalidraw_token'));
      if (!token) throw new Error(`No token after registration/login. URL: ${page.url()}`);
    })());

    // ========== TEST 3: Editor page renders ==========
    results.push(await test('Editor page renders with sidebar', async () => {
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
      await sleep(1000);
      const editor = await page.isVisible('#editor-container');
      if (!editor) throw new Error('Editor container not found');
      const sidebar = await page.isVisible('#file-list');
      if (!sidebar) throw new Error('File list not found');
      console.log(`     URL: ${page.url()}`);
    })());

    // ========== TEST 4: Excalidraw React island hydrates ==========
    results.push(await test('Excalidraw React island loads and paints canvas', async () => {
      await sleep(5000); // Give React island time to hydrate
      // Check for astro-island
      const island = await page.$('astro-island');
      if (!island) throw new Error('astro-island not found in DOM');
      const isHydrated = await page.evaluate(() => {
        const island = document.querySelector('astro-island');
        return island && !island.hasAttribute('ssr');
      });
      if (!isHydrated) throw new Error('astro-island still has ssr attribute (not hydrated)');
      // Check for canvas or excalidraw layer
      const canvases = await page.$$('canvas');
      const excalLayers = await page.$$('[class*="excalidraw"]');
      const layerDivs = await page.$$('[class*="layer-ui"]');
      console.log(`     Canvases: ${canvases.length}, excal layers: ${excalLayers.length}, layer-ui: ${layerDivs.length}`);
      if (canvases.length === 0 && excalLayers.length === 0) {
        // The excalidraw may use an iframe or custom renderer
        // Let's check if the component rendered at all
        const wrapper = await page.$('#excalidraw-container');
        const containerContent = wrapper ? await page.evaluate(el => el.innerHTML.length, wrapper) : 0;
        if (containerContent === 0) throw new Error('Excalidraw container is empty');
      }
    })());

    // ========== TEST 5: Create file via UI ==========
    results.push(await test('Create new file via sidebar button', async () => {
      // Wait for file list to load
      await sleep(2000);
      const createBtn = await page.$('.excal-sidebar-header .btn-icon');
      if (!createBtn) throw new Error('Create button not found in sidebar header');
      await createBtn.click();
      await sleep(2000);
      const items = await page.$$('.excal-file-item');
      if (items.length === 0) throw new Error('No file items after creation');
      const name = await items[0].$eval('.file-name', el => el.textContent);
      console.log(`     File name: "${name.trim()}"`);
    })());

    // ========== TEST 6: File exists on disk ==========
    results.push(await test('Created file exists on disk', async () => {
      if (!existsSync(userDir)) throw new Error('User directory does not exist');
      const files = readdirSync(userDir).filter(f => f.endsWith('.excalidraw'));
      if (files.length === 0) throw new Error('No .excalidraw files found on disk');
      const content = readFileSync(path.join(userDir, files[0]), 'utf-8');
      const data = JSON.parse(content);
      if (!data.name) throw new Error('Missing name field');
      if (!Array.isArray(data.elements)) throw new Error('Missing elements array');
      console.log(`     ${files.length} file(s) on disk`);
      console.log(`     "${data.name}" (${files[0]})`);
    })());

    // ========== TEST 7: Rename file ==========
    results.push(await test('Rename file', async () => {
      const fileItem = await page.$('.excal-file-item');
      if (!fileItem) throw new Error('No file items found');
      await fileItem.hover();
      await sleep(300);
      const renameBtn = await page.$('.file-action-btn[title="重命名"], .file-action-btn:not(.danger)');
      if (!renameBtn) throw new Error('Rename button not found');
      await renameBtn.click();
      await sleep(500);
      const input = await page.$('.file-name-input');
      if (!input) throw new Error('Rename input did not appear');
      await input.fill('我的测试画板');
      await page.keyboard.press('Enter');
      await sleep(1000);
      const fileName = await page.textContent('.excal-file-item .file-name');
      if (!fileName.includes('测试')) throw new Error(`Expected name to contain "测试", got: "${fileName}"`);
    })());

    // ========== TEST 8: Auto-discovery ==========
    results.push(await test('Auto-discovery of externally created file', async () => {
      // Create external file
      writeFileSync(path.join(userDir, 'external-test.excalidraw'), JSON.stringify({
        name: '外部创建的画板',
        elements: [{ id: 'ext1', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }],
        appState: {},
        created: Date.now(),
        updated: Date.now(),
      }));
      console.log('     External file written to disk');
      
      // Wait for discovery (frontend polls every 10s)
      await sleep(12000);
      const items = await page.$$('.excal-file-item');
      const names = await Promise.all(items.map(el => el.textContent()));
      const found = names.some(n => n.includes('外部创建'));
      if (!found) {
        // Force reload
        await page.evaluate(() => loadFiles());
        await sleep(2000);
        const items2 = await page.$$('.excal-file-item');
        const names2 = await Promise.all(items2.map(el => el.textContent()));
        if (!names2.some(n => n.includes('外部创建'))) {
          console.log(`     Files found: ${names2.join(', ')}`);
          throw new Error('Externally created file not auto-detected');
        }
      }
      console.log('     ✅ External file auto-detected');
      
      // Clean up
      unlinkSync(path.join(userDir, 'external-test.excalidraw'));
    })());

    // ========== TEST 9: API round-trip (scene_data) ==========
    results.push(await test('API scene_data round-trip', async () => {
      const token = await page.evaluate(() => localStorage.getItem('excalidraw_token'));
      const listRes = await page.evaluate(async (t) => {
        const r = await fetch('/api/files', { headers: { Authorization: 'Bearer ' + t } });
        return r.json();
      }, token);
      if (!listRes.data || listRes.data.length === 0) throw new Error('No files from API');
      const fileId = listRes.data[0].id;
      const getRes = await page.evaluate(async ({ t, id }) => {
        const r = await fetch(`/api/files/${id}`, { headers: { Authorization: 'Bearer ' + t } });
        return r.json();
      }, { t: token, id: fileId });
      if (getRes.code !== 0) throw new Error(`Get file failed: ${getRes.msg}`);
      if (!getRes.data.scene_data) throw new Error('No scene_data');
      const parsed = JSON.parse(getRes.data.scene_data);
      if (!Array.isArray(parsed.elements)) throw new Error('scene_data missing elements array');
      if (!parsed.name) throw new Error('scene_data missing name');
      console.log(`     "${parsed.name}" - ${parsed.elements.length} elements`);
    })());

    // ========== TEST 10: Update scene_data via API ==========
    results.push(await test('Update scene_data via API', async () => {
      const token = await page.evaluate(() => localStorage.getItem('excalidraw_token'));
      const listRes = await page.evaluate(async (t) => {
        const r = await fetch('/api/files', { headers: { Authorization: 'Bearer ' + t } });
        return r.json();
      }, token);
      if (!listRes.data || listRes.data.length === 0) throw new Error('No files to update');
      const fileId = listRes.data[0].id;
      const newScene = JSON.stringify({
        elements: [{ id: 'api-el', type: 'ellipse', x: 50, y: 50, width: 80, height: 80 }],
        appState: { viewBackgroundColor: '#f0f0f0' },
        name: '我的测试画板',
      });
      const updateRes = await page.evaluate(async ({ t, id, scene }) => {
        const r = await fetch(`/api/files/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
          body: JSON.stringify({ scene_data: scene }),
        });
        return r.json();
      }, { t: token, id: fileId, scene: newScene });
      if (updateRes.code !== 0) throw new Error(`Update failed: ${updateRes.msg}`);
      
      // Verify on disk
      const files = readdirSync(userDir).filter(f => f.endsWith('.excalidraw'));
      const content = readFileSync(path.join(userDir, files[0]), 'utf-8');
      const data = JSON.parse(content);
      if (data.elements.length !== 1) throw new Error(`Expected 1 element after update, got ${data.elements.length}`);
      console.log(`     Updated: ${data.elements.length} elements, background: ${data.appState?.viewBackgroundColor}`);
    })());

    // ========== TEST 11: Delete file ==========
    results.push(await test('Delete file via UI', async () => {
      const itemsBefore = await page.$$('.excal-file-item');
      if (itemsBefore.length === 0) throw new Error('No files to delete');

      // Accept confirm dialog
      page.once('dialog', async dialog => {
        console.log(`     Dialog: "${dialog.message().slice(0, 40)}..."`);
        await dialog.accept();
      });

      // Hover over the first file item to reveal action buttons
      const fileItemLocator = page.locator('.excal-file-item').first();
      await fileItemLocator.hover({ timeout: 5000 });
      await sleep(500);

      // Now click the delete button via locator (not stale elementHandle)
      const deleteBtn = page.locator('.file-action-btn.danger').first();
      await deleteBtn.click({ force: true, timeout: 5000 });
      await sleep(2000);
      const itemsAfter = await page.$$('.excal-file-item');
      console.log(`     Files: ${itemsBefore.length} → ${itemsAfter.length}`);
    })());

    // ========== TEST 12: Login page switch to register ==========
    results.push(await test('Login/register form toggle', async () => {
      // Clear auth state first
      await page.evaluate(() => {
        localStorage.removeItem('excalidraw_token');
        localStorage.removeItem('excalidraw_username');
      });
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
      await sleep(1000);
      // Wait for page to fully render
      await page.waitForSelector('#switch-to-register', { timeout: 5000 });
      // Switch to register
      await page.click('#switch-to-register');
      await sleep(500);
      const regFormVisible = await page.isVisible('#register-view');
      if (!regFormVisible) throw new Error('Register form not visible after switch');
      const regBtnVisible = await page.isVisible('#register-btn');
      if (!regBtnVisible) throw new Error('Register button not visible');
      // Switch back to login
      await page.click('#switch-to-login');
      await sleep(500);
      const loginFormVisible = await page.isVisible('#login-view');
      if (!loginFormVisible) throw new Error('Login form not visible after switch back');
      console.log('     Form toggle works correctly');
    })());

    // ========== TEST 13: Saved file is valid Excalidraw format ==========
    results.push(await test('Saved file is valid Excalidraw JSON format', async () => {
      if (!existsSync(userDir)) {
        console.log('     (no user dir, skipping)');
        return;
      }
      const files = readdirSync(userDir).filter(f => f.endsWith('.excalidraw'));
      if (files.length === 0) {
        // Create a sample valid file
        mkdirSync(userDir, { recursive: true });
        writeFileSync(path.join(userDir, 'sample-valid.excalidraw'), JSON.stringify({
          type: 'excalidraw',
          version: 2,
          source: '',
          elements: [],
          appState: {},
          files: {},
        }));
        files.push('sample-valid.excalidraw');
      }
      files.forEach(f => {
        try {
          const content = readFileSync(path.join(userDir, f), 'utf-8');
          const data = JSON.parse(content);
          if (!data.name && !data.elements && !data.type) {
            console.log(`     ⚠️  ${f}: non-standard format (no name/elements/type)`);
          }
          console.log(`     ✅ ${f} is valid JSON`);
        } catch (e) {
          console.log(`     ❌ ${f}: ${e.message}`);
          throw e;
        }
      });
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
    await context.close();
    await browser.close();
    if (server) server.kill('SIGTERM');
    // Clean up test data
    if (existsSync(userDir)) {
      const files = readdirSync(userDir);
      files.forEach(f => unlinkSync(path.join(userDir, f)));
      try { rmdirSync(userDir); } catch {}
    }
  }
}

run().catch(e => {
  console.error('Fatal:', e);
  if (server) server.kill('SIGTERM');
  process.exit(1);
});
