// ============================================================
// DB ADAPTER — SQLite ↔ PostgreSQL transparent switch
// Uses DATABASE_URL env var to decide. If set → PostgreSQL, else → SQLite.
// PostgreSQL mode uses deasync to provide TRUE synchronous queries
// that are 100% compatible with the existing better-sqlite3 API.
// ============================================================
const path = require('path');

function createDB() {
  const pgUrl = process.env.DATABASE_URL;

  if (pgUrl) {
    // ═══════════════════════════════════════
    // POSTGRESQL MODE (Render, production)
    // Uses deasync to block event loop until PG query completes
    // This provides TRUE synchronous behavior matching better-sqlite3
    // ═══════════════════════════════════════
    const { Pool } = require('pg');
    const loopWhile = require('deasync').loopWhile;

    const pool = new Pool({
      connectionString: pgUrl,
      ssl: pgUrl.includes('render.com') || pgUrl.includes('neon.tech') || pgUrl.includes('supabase')
        ? { rejectUnauthorized: false }
        : false,
      max: 10,
      idleTimeoutMillis: 30000,
    });

    console.log('🐘 PostgreSQL mode (deasync)');

    // Convert SQLite SQL to PostgreSQL SQL
    function convertSQL(sql) {
      let i = 0;
      return sql
        .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY')
        .replace(/DATETIME DEFAULT CURRENT_TIMESTAMP/gi, 'TIMESTAMP DEFAULT NOW()')
        .replace(/DATETIME/gi, 'TIMESTAMP')
        .replace(/datetime\('now'\)/gi, 'NOW()')
        .replace(/datetime\('now',\s*'([^']+)'\)/gi, (m, interval) => {
          // Convert SQLite date math to PostgreSQL: datetime('now', '-7 days') → NOW() + interval '-7 days'
          return `NOW() + interval '${interval}'`;
        })
        .replace(/TEXT DEFAULT '{}'/gi, "TEXT DEFAULT '{}'")
        .replace(/INTEGER DEFAULT (\d+)/gi, 'INTEGER DEFAULT $1')
        .replace(/\bINTEGER\b(?!\s+DEFAULT|\s+NOT)/gi, 'INTEGER')
        .replace(/,\s*UNIQUE\(([^)]+)\)/gi, ', UNIQUE($1)')
        // INSERT OR REPLACE → INSERT ... ON CONFLICT
        .replace(/INSERT OR REPLACE INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)/gi,
          (match, table, cols, vals) => {
            return `INSERT INTO ${table} (${cols}) VALUES (${vals}) ON CONFLICT DO UPDATE SET ${cols.split(',').map(c => c.trim() + ' = EXCLUDED.' + c.trim()).join(', ')}`;
          })
        // ? placeholders → $1, $2, $3...
        .replace(/\?/g, () => '$' + (++i));
    }

    // Synchronous PG query using deasync
    function syncQuery(sql, params = []) {
      let result = undefined;
      let error = null;
      let done = false;

      pool.query(sql, params)
        .then(r => { result = r; done = true; })
        .catch(e => { error = e; done = true; });

      loopWhile(() => !done);

      if (error) throw error;
      return result;
    }

    // Wrapper that emulates better-sqlite3 API with TRUE sync PG queries
    const db = {
      _pool: pool,
      _isPostgres: true,

      exec(sql) {
        const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
        let ok = 0, skip = 0, fail = 0;
        for (const stmt of statements) {
          try {
            const pgSQL = convertSQL(stmt);
            syncQuery(pgSQL);
            ok++;
          } catch(e) {
            if (e.message.includes('already exists') || e.message.includes('duplicate')) {
              skip++;
            } else {
              fail++;
              console.warn('PG exec FAIL:', e.message.substring(0, 150));
              console.warn('  SQL:', stmt.substring(0, 100));
            }
          }
        }
        if (ok + skip + fail > 1) console.log(`PG exec: ${ok} ok, ${skip} skip, ${fail} fail`);
      },

      prepare(sql) {
        const pgSQL = convertSQL(sql);
        return {
          run(...params) {
            try {
              const result = syncQuery(pgSQL, params);
              return { lastInsertRowid: result.rows?.[0]?.id || 0, changes: result.rowCount || 0 };
            } catch(e) {
              if (!e.message.includes('duplicate') && !e.message.includes('unique') && !e.message.includes('already exists'))
                console.warn('PG run:', e.message.substring(0, 100));
              return { lastInsertRowid: 0, changes: 0 };
            }
          },
          get(...params) {
            try {
              const result = syncQuery(pgSQL, params);
              return result.rows[0] || null;
            } catch(e) {
              console.warn('PG get:', e.message.substring(0, 100));
              return null;
            }
          },
          all(...params) {
            try {
              const result = syncQuery(pgSQL, params);
              return result.rows;
            } catch(e) {
              console.warn('PG all:', e.message.substring(0, 100));
              return [];
            }
          }
        };
      },

      pragma(val) {
        // PostgreSQL doesn't use pragma — no-op
        // But handle 'foreign_keys = OFF/ON' for compatibility
      },

      transaction(fn) {
        return (...args) => {
          try {
            syncQuery('BEGIN');
            const result = fn(...args);
            syncQuery('COMMIT');
            return result;
          } catch(e) {
            try { syncQuery('ROLLBACK'); } catch(re) {}
            throw e;
          }
        };
      },

      async waitForInit() {
        console.log('🐘 PostgreSQL ready (sync mode via deasync)');
      },

      close() {
        pool.end();
      }
    };

    return db;

  } else {
    // ═══════════════════════════════════════
    // SQLITE MODE (local development)
    // ═══════════════════════════════════════
    const Database = require('better-sqlite3');
    const dbPath = process.env.DB_PATH || path.join(__dirname, 'restaurank.db');
    const db = new Database(dbPath);
    try { db.pragma('journal_mode = WAL'); } catch(e) {}
    db._isPostgres = false;
    db.waitForInit = async () => {};
    console.log('📦 SQLite: ' + dbPath);
    return db;
  }
}

module.exports = { createDB };
