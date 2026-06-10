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
