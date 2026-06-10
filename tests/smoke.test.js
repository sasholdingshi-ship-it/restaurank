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
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test', AGENT_TOKEN: 'test-agent-token' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Wait until the HTTP server actually answers (big single-file boot can take >5s)
  const deadline = Date.now() + 30000;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/ping`);
      if (r.ok) return;
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server not ready after 30s: ${lastErr?.message || 'no response'}`);
});

test.after(() => {
  if (server && !server.killed) server.kill('SIGTERM');
});

test('GET / serves landing page', async () => {
  const r = await fetch(`${BASE}/`);
  assert.strictEqual(r.status, 200);
  const body = await r.text();
  assert.match(body, /RestauRank/);
  assert.match(body, /audit/i);
});

test('GET /app serves the SPA', async () => {
  const r = await fetch(`${BASE}/app`);
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

// ── AGENT API v2 (X-Agent-Token auth) ──
const AGENT_HEADERS = { 'Content-Type': 'application/json', 'X-Agent-Token': 'test-agent-token' };

test('POST /api/content/push without token is rejected', async () => {
  const r = await fetch(`${BASE}/api/content/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'blog', content: 'x' }),
  });
  assert.strictEqual(r.status, 401);
});

test('POST /api/content/push stores content and reports publication status', async () => {
  const r = await fetch(`${BASE}/api/content/push`, {
    method: 'POST',
    headers: AGENT_HEADERS,
    body: JSON.stringify({ restaurant_id: 0, type: 'report', title: 'Rapport test', content: 'contenu de test' }),
  });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.success, true);
  assert.ok(j.id > 0);
  assert.strictEqual(j.publication.status, 'stored_only');
});

test('GET /api/agent/state returns full state for the manager', async () => {
  const r = await fetch(`${BASE}/api/agent/state`, { headers: AGENT_HEADERS });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.success, true);
  assert.ok(Array.isArray(j.restaurants));
  assert.ok(j.publication_mode);
  assert.ok('reddit_accounts' in j.channels);
  if (j.restaurants.length > 0) {
    const r0 = j.restaurants[0];
    assert.ok('needs_action' in r0 && 'content' in r0 && 'learnings' in r0 && 'anti_spam' in r0);
  }
});

test('agent actions journal roundtrip', async () => {
  const post = await fetch(`${BASE}/api/agent/actions`, {
    method: 'POST',
    headers: AGENT_HEADERS,
    body: JSON.stringify({ restaurant_id: 0, run_tag: 'test-run', role: 'manager', action: 'smoke_test', reason: 'test suite', priority: 'low' }),
  });
  assert.strictEqual(post.status, 200);
  const pj = await post.json();
  assert.strictEqual(pj.success, true);
  const get = await fetch(`${BASE}/api/agent/actions?limit=5`, { headers: AGENT_HEADERS });
  const gj = await get.json();
  assert.strictEqual(gj.success, true);
  assert.ok(gj.actions.some(a => a.action === 'smoke_test'));
});

test('learnings lifecycle: create then reinforce', async () => {
  const learning = `test learning ${Date.now()}`;
  const c1 = await fetch(`${BASE}/api/learnings`, {
    method: 'POST', headers: AGENT_HEADERS,
    body: JSON.stringify({ restaurant_id: 0, content_type: 'blog', learning, confidence: 0.5, scope: 'global' }),
  });
  const j1 = await c1.json();
  assert.strictEqual(j1.action, 'created');
  assert.strictEqual(j1.status, 'testing');
  const c2 = await fetch(`${BASE}/api/learnings`, {
    method: 'POST', headers: AGENT_HEADERS,
    body: JSON.stringify({ restaurant_id: 0, learning }),
  });
  const j2 = await c2.json();
  assert.strictEqual(j2.action, 'reinforced');
  assert.ok(j2.confidence > 0.5);
  const g = await fetch(`${BASE}/api/learnings?restaurant_id=0`, { headers: AGENT_HEADERS });
  const gj = await g.json();
  assert.ok(gj.learnings.some(l => l.learning === learning));
});

test('GET /api/agent/status still answers (agent-monitor compat)', async () => {
  const r = await fetch(`${BASE}/api/agent/status?restaurant_id=1`, { headers: AGENT_HEADERS });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.success, true);
  assert.ok('needs_action' in j);
});

test('POST /api/metrics/track requires token', async () => {
  const r = await fetch(`${BASE}/api/metrics/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ metric_type: 'health_check', value: 1 }),
  });
  assert.strictEqual(r.status, 401);
});
