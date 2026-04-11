// Smoke tests — verify server boots and core endpoints respond.
// Run: npm test   (uses node --test, no extra deps)
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 9876;
const BASE = `http://localhost:${PORT}`;
let server;

test.before(async () => {
  server = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Wait for "listening" or 5s
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(), 5000);
    server.stdout.on('data', (buf) => {
      if (buf.toString().toLowerCase().includes('listening') || buf.toString().includes(String(PORT))) {
        clearTimeout(t); resolve();
      }
    });
    server.on('error', (e) => { clearTimeout(t); reject(e); });
  });
});

test.after(() => {
  if (server && !server.killed) server.kill('SIGTERM');
});

test('GET / serves main HTML', async () => {
  const r = await fetch(`${BASE}/`);
  assert.strictEqual(r.status, 200);
  const body = await r.text();
  assert.match(body, /RestauRank/);
});

test('GET /public/styles.css serves extracted CSS', async () => {
  const r = await fetch(`${BASE}/public/styles.css`);
  assert.strictEqual(r.status, 200);
  const body = await r.text();
  assert.ok(body.length > 1000, 'CSS should be non-trivial');
});

test('GET /public/app.js serves extracted JS', async () => {
  const r = await fetch(`${BASE}/public/app.js`);
  assert.strictEqual(r.status, 200);
  const body = await r.text();
  assert.ok(body.length > 1000, 'JS should be non-trivial');
});

test('POST /auth/login with bad credentials rejects', async () => {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'nobody@example.invalid', password: 'wrong' }),
  });
  assert.ok(r.status >= 400 && r.status < 500, `expected 4xx, got ${r.status}`);
});

test('POST /api/blog/publish without cms_type returns validation error', async () => {
  const r = await fetch(`${BASE}/api/blog/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'x', content: 'y' }),
  });
  const j = await r.json();
  assert.strictEqual(j.success, false);
  assert.match(j.error || '', /cms_type/);
});

test('POST /api/blog/publish squarespace returns WXR import file', async () => {
  const r = await fetch(`${BASE}/api/blog/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cms_type: 'squarespace',
      title: 'Test Post',
      content: '<p>Hello world</p>',
      credentials: {},
    }),
  });
  const j = await r.json();
  assert.strictEqual(j.success, true);
  assert.strictEqual(j.method, 'squarespace_wxr_import');
  assert.ok(j.import_file && j.import_file.data.includes('<rss'));
});

test('GET /api/cms/snapshots returns snapshots array', async () => {
  const r = await fetch(`${BASE}/api/cms/snapshots`);
  const j = await r.json();
  assert.strictEqual(j.success, true);
  assert.ok(Array.isArray(j.snapshots));
});

// SEO/GEO routes
test('GET /robots.txt serves valid robots file', async () => {
  const r = await fetch(`${BASE}/robots.txt`);
  assert.strictEqual(r.status, 200);
  const body = await r.text();
  assert.match(body, /User-agent/);
  assert.match(body, /Sitemap/);
});

test('GET /sitemap.xml serves valid sitemap', async () => {
  const r = await fetch(`${BASE}/sitemap.xml`);
  assert.strictEqual(r.status, 200);
  const body = await r.text();
  assert.match(body, /urlset/);
  assert.match(body, /restaurank/);
});

test('GET /about serves public about page', async () => {
  const r = await fetch(`${BASE}/about`);
  assert.strictEqual(r.status, 200);
  const body = await r.text();
  assert.match(body, /RestauRank/);
  assert.match(body, /SEO/);
  assert.match(body, /GEO/);
});

test('GET /blog serves blog index with articles', async () => {
  const r = await fetch(`${BASE}/blog`);
  assert.strictEqual(r.status, 200);
  const body = await r.text();
  assert.match(body, /Blog/);
  assert.match(body, /audit-seo-local/);
});

test('GET /blog/:slug serves article page', async () => {
  const r = await fetch(`${BASE}/blog/audit-seo-local-restaurant`);
  assert.strictEqual(r.status, 200);
  const body = await r.text();
  assert.match(body, /SEO local/);
  assert.match(body, /BlogPosting/);
});
