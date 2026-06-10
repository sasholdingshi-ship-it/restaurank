// Migration runner — applied once at startup, tracked in schema_migrations.
// Keep migrations idempotent and guarded: prod DB may predate any of them.
function runMigrations(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name));
  const hasTable = (t) => !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
  const hasCol = (t, c) => hasTable(t) && db.prepare(`PRAGMA table_info("${t}")`).all().some(x => x.name === c);

  const MIGRATIONS = [
    {
      // A French-accent fixer once ran over the codebase and corrupted identifiers
      // (base64→basé64, completed→complèted…). Code is fixed; live DBs created before
      // the fix still carry accented column/table names — rename them to match.
      name: '001_rename_accent_corrupted_columns',
      up() {
        if (hasCol('restaurants', 'complèted_actions')) db.exec('ALTER TABLE restaurants RENAME COLUMN "complèted_actions" TO completed_actions');
        if (hasCol('accounts', 'vérification_token')) db.exec('ALTER TABLE accounts RENAME COLUMN "vérification_token" TO verification_token');
        if (hasCol('agent_runs', 'complèted_at')) db.exec('ALTER TABLE agent_runs RENAME COLUMN "complèted_at" TO completed_at');
        if (hasTable('anti_détection_log') && !hasTable('anti_detection_log')) db.exec('ALTER TABLE "anti_détection_log" RENAME TO anti_detection_log');
        if (hasTable('directory_automation')) db.exec("UPDATE directory_automation SET status='needs_verification' WHERE status='needs_vérification'");
      },
    },
    {
      // Agent API v2: action journal + learnings lifecycle + perf indexes.
      // Base tables may already exist (created inline by v1 handlers on prod).
      name: '002_agent_v2_tables',
      up() {
        db.exec(`CREATE TABLE IF NOT EXISTS generated_content (id INTEGER PRIMARY KEY AUTOINCREMENT, restaurant_id INTEGER, restaurant_name TEXT, type TEXT NOT NULL, title TEXT, content TEXT NOT NULL, published INTEGER DEFAULT 0, publish_url TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.exec(`CREATE TABLE IF NOT EXISTS content_performance (id INTEGER PRIMARY KEY AUTOINCREMENT, content_id INTEGER, restaurant_id INTEGER, content_type TEXT, metric_type TEXT NOT NULL, value REAL DEFAULT 0, source TEXT, metadata TEXT, tracked_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.exec(`CREATE TABLE IF NOT EXISTS agent_learnings (id INTEGER PRIMARY KEY AUTOINCREMENT, restaurant_id INTEGER, content_type TEXT, learning TEXT NOT NULL, confidence REAL DEFAULT 0.5, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        if (!hasCol('agent_learnings', 'status')) db.exec("ALTER TABLE agent_learnings ADD COLUMN status TEXT DEFAULT 'testing'");
        if (!hasCol('agent_learnings', 'scope')) db.exec("ALTER TABLE agent_learnings ADD COLUMN scope TEXT DEFAULT 'restaurant'");
        if (!hasCol('agent_learnings', 'evidence_count')) db.exec('ALTER TABLE agent_learnings ADD COLUMN evidence_count INTEGER DEFAULT 0');
        db.exec(`CREATE TABLE IF NOT EXISTS agent_actions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          restaurant_id INTEGER DEFAULT 0,
          run_tag TEXT,
          role TEXT,
          action TEXT NOT NULL,
          reason TEXT,
          priority TEXT,
          status TEXT DEFAULT 'done',
          payload TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        db.exec('CREATE INDEX IF NOT EXISTS idx_actions_restaurant ON agent_actions(restaurant_id, created_at)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_actions_run ON agent_actions(run_tag)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_perf_restaurant ON content_performance(restaurant_id, tracked_at)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_gc_restaurant_type ON generated_content(restaurant_id, type, created_at)');
      },
    },
  ];

  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    db.transaction(() => {
      m.up();
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(m.name);
    })();
    console.log(`🗄️  migration applied: ${m.name}`);
  }
}

module.exports = { runMigrations };
