const path = require('path');

function createDB() {
  const Database = require('better-sqlite3');
  const dbPath = process.env.DB_PATH || path.join(__dirname, 'restaurank.db');
  const db = new Database(dbPath);
  try { db.pragma('journal_mode = WAL'); } catch (e) {}
  db._isPostgres = false;
  console.log('📦 SQLite: ' + dbPath);
  return db;
}

const SYNC_TABLES = ['accounts', 'restaurants', 'restaurant_settings', 'sessions'];

async function setupPGSync(db) {
  const pgUrl = process.env.DATABASE_URL;
  if (!pgUrl) return;

  let Pool;
  try { Pool = require('pg').Pool; } catch (e) {
    console.warn('pg module not installed — PG sync disabled');
    return;
  }

  const pool = new Pool({
    connectionString: pgUrl,
    ssl: (pgUrl.includes('neon.tech') || pgUrl.includes('render.com') || pgUrl.includes('supabase'))
      ? { rejectUnauthorized: false } : false,
    max: 3, idleTimeoutMillis: 30000,
  });

  try {
    await pool.query('SELECT 1');
    console.log('🐘 Neon PG connected (backup sync)');
  } catch (e) {
    console.warn('PG connection failed:', e.message);
    return;
  }

  async function ensurePGTables() {
    const creates = [
      `CREATE TABLE IF NOT EXISTS accounts (id SERIAL PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, salt TEXT, name TEXT, role TEXT DEFAULT 'client', plan TEXT DEFAULT 'free', plan_expires TIMESTAMP, stripe_customer_id TEXT, stripe_subscription_id TEXT, max_restaurants INTEGER DEFAULT 1, is_active INTEGER DEFAULT 1, email_verified INTEGER DEFAULT 0, verification_token TEXT, reset_token TEXT, reset_expires TIMESTAMP, last_login TIMESTAMP, social_tokens TEXT DEFAULT '{}', created_at TIMESTAMP DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS restaurants (id SERIAL PRIMARY KEY, user_id INTEGER, owner_id INTEGER, name TEXT NOT NULL, city TEXT NOT NULL, google_place_id TEXT, google_account_id TEXT, google_location_id TEXT, audit_data TEXT, scores TEXT, completed_actions TEXT DEFAULT '{}', platform_status TEXT DEFAULT '{}', hub_data TEXT, last_audit TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS restaurant_settings (id SERIAL PRIMARY KEY, restaurant_id INTEGER NOT NULL DEFAULT 0, type TEXT NOT NULL, data TEXT DEFAULT '{}', updated_at TIMESTAMP DEFAULT NOW())`,
      `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, account_id INTEGER NOT NULL, expires_at TIMESTAMP NOT NULL, created_at TIMESTAMP DEFAULT NOW())`,
    ];
    for (const sql of creates) {
      try { await pool.query(sql); } catch (e) {}
    }
  }

  async function restoreFromPG() {
    let total = 0;
    for (const table of SYNC_TABLES) {
      try {
        const { rows } = await pool.query(`SELECT * FROM ${table}`);
        if (!rows.length) continue;
        const info = db.pragma(`table_info(${table})`);
        if (!info.length) continue;
        const sqliteCols = new Set(info.map(c => c.name));

        for (const row of rows) {
          const cols = Object.keys(row).filter(c => sqliteCols.has(c));
          if (!cols.length) continue;
          const vals = cols.map(c => {
            const v = row[c];
            if (v instanceof Date) return v.toISOString();
            if (typeof v === 'object' && v !== null) return JSON.stringify(v);
            return v;
          });
          const ph = cols.map(() => '?').join(',');
          const pk = table === 'sessions' ? 'id' : 'id';
          const updateCols = cols.filter(c => c !== pk);
          const updateSet = updateCols.map(c => `${c}=excluded.${c}`).join(',');
          try {
            db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${ph})`).run(...vals);
            total++;
          } catch (e) {}
        }
      } catch (e) {
        console.warn('PG restore:', table, e.message?.substring(0, 80));
      }
    }
    if (total) console.log(`🔄 Restored ${total} rows PG → SQLite`);
  }

  async function backupToPG() {
    let total = 0;
    for (const table of SYNC_TABLES) {
      try {
        const info = db.pragma(`table_info(${table})`);
        if (!info.length) continue;
        const rows = db.prepare(`SELECT * FROM ${table}`).all();
        if (!rows.length) continue;

        for (const row of rows) {
          const cols = Object.keys(row);
          const vals = cols.map(c => row[c]);
          const ph = cols.map((_, i) => `$${i + 1}`).join(',');
          const pk = table === 'sessions' ? 'id' : 'id';
          const updateCols = cols.filter(c => c !== pk);
          const updateSet = updateCols.map(c => {
            const idx = cols.indexOf(c) + 1;
            return `${c}=$${idx}`;
          }).join(',');
          try {
            await pool.query(
              `INSERT INTO ${table} (${cols.join(',')}) VALUES (${ph}) ON CONFLICT (${pk}) DO UPDATE SET ${updateSet}`,
              vals
            );
            total++;
          } catch (e) {}
        }
      } catch (e) {
        console.warn('PG backup:', table, e.message?.substring(0, 80));
      }
    }
    if (total) console.log(`🔄 Backed up ${total} rows SQLite → PG`);
  }

  await ensurePGTables();
  try { await restoreFromPG(); } catch (e) { console.warn('PG restore failed:', e.message); }
  setInterval(() => { backupToPG().catch(() => {}); }, 5 * 60 * 1000);
  setTimeout(() => { backupToPG().catch(() => {}); }, 30000);
  console.log('🔄 PG sync: restore done, backup every 5min');
}

module.exports = { createDB, setupPGSync };
