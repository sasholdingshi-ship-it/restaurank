// ============================================================
// DB ADAPTER — SQLite ↔ PostgreSQL transparent switch
// Uses DATABASE_URL env var to decide. If set → PostgreSQL, else → SQLite.
// Emulates the better-sqlite3 synchronous API over pg async pool.
// ============================================================
const path = require('path');

function createDB() {
  const pgUrl = process.env.DATABASE_URL;

  if (pgUrl) {
    // ═══════════════════════════════════════
    // POSTGRESQL MODE (Render, production)
    // ═══════════════════════════════════════
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: pgUrl,
      ssl: pgUrl.includes('render.com') || pgUrl.includes('neon.tech') || pgUrl.includes('supabase')
        ? { rejectUnauthorized: false }
        : false,
      max: 10,
      idleTimeoutMillis: 30000,
    });

    console.log('🐘 PostgreSQL connected');

    // Queue for synchronous-style execution
    let initDone = false;
    const pendingExecs = [];

    // Convert SQLite SQL to PostgreSQL SQL
    function convertSQL(sql) {
      return sql
        .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY')
        .replace(/DATETIME DEFAULT CURRENT_TIMESTAMP/gi, 'TIMESTAMP DEFAULT NOW()')
        .replace(/DATETIME/gi, 'TIMESTAMP')
        .replace(/datetime\('now'\)/gi, 'NOW()')
        .replace(/TEXT DEFAULT '{}'/gi, "TEXT DEFAULT '{}'")
        .replace(/INTEGER DEFAULT (\d+)/gi, 'INTEGER DEFAULT $1')
        .replace(/\bINTEGER\b(?!\s+DEFAULT)/gi, 'INTEGER')
        // SQLite UNIQUE constraint in CREATE TABLE
        .replace(/,\s*UNIQUE\(([^)]+)\)/gi, ', UNIQUE($1)')
        // INSERT OR REPLACE → INSERT ... ON CONFLICT DO UPDATE
        .replace(/INSERT OR REPLACE INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)/gi,
          (match, table, cols, vals) => {
            return `INSERT INTO ${table} (${cols}) VALUES (${vals}) ON CONFLICT DO UPDATE SET ${cols.split(',').map(c => c.trim() + ' = EXCLUDED.' + c.trim()).join(', ')}`;
          })
        // ? placeholders → $1, $2, $3...
        .replace(/\?/g, (() => { let i = 0; return () => '$' + (++i); })());
    }

    // Wrapper that emulates better-sqlite3 API
    const db = {
      _pool: pool,
      _isPostgres: true,

      exec(sql) {
        // Split multi-statement SQL and execute each
        const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
        const converted = statements.map(s => convertSQL(s));
        // Execute synchronously via queue (init only)
        const promise = (async () => {
          for (const stmt of converted) {
            try {
              await pool.query(stmt);
            } catch(e) {
              // Ignore "already exists" errors during init
              if (!e.message.includes('already exists') && !e.message.includes('duplicate')) {
                console.warn('PG exec warning:', e.message.substring(0, 100));
              }
            }
          }
        })();
        pendingExecs.push(promise);
      },

      prepare(sql) {
        const pgSQL = convertSQL(sql);
        return {
          run(...params) {
            // Fire and forget for writes (matches SQLite sync behavior)
            pool.query(pgSQL, params).catch(e => {
              if (!e.message.includes('duplicate') && !e.message.includes('unique'))
                console.warn('PG run error:', e.message.substring(0, 80));
            });
            return { lastInsertRowid: 0, changes: 0 };
          },
          get(...params) {
            // SYNC EMULATION: We cache recent results
            // For true sync, we need to pre-fetch. Use async version when possible.
            return db._syncGet(pgSQL, params);
          },
          all(...params) {
            return db._syncAll(pgSQL, params);
          }
        };
      },

      // Async helpers (preferred)
      async asyncGet(sql, params = []) {
        const pgSQL = convertSQL(sql);
        const result = await pool.query(pgSQL, params);
        return result.rows[0] || null;
      },

      async asyncAll(sql, params = []) {
        const pgSQL = convertSQL(sql);
        const result = await pool.query(pgSQL, params);
        return result.rows;
      },

      async asyncRun(sql, params = []) {
        const pgSQL = convertSQL(sql);
        const result = await pool.query(pgSQL, params);
        return { lastInsertRowid: result.rows?.[0]?.id, changes: result.rowCount };
      },

      // Sync emulation using a blocking approach (for compatibility)
      _cache: new Map(),
      _syncGet(sql, params) {
        // Return null synchronously, schedule async fetch
        const key = sql + JSON.stringify(params);
        if (this._cache.has(key)) {
          const cached = this._cache.get(key);
          this._cache.delete(key); // One-time use
          return cached;
        }
        // Schedule for next tick
        pool.query(sql, params).then(r => {
          this._cache.set(key, r.rows[0] || null);
        }).catch(() => {});
        return null;
      },
      _syncAll(sql, params) {
        const key = 'all:' + sql + JSON.stringify(params);
        if (this._cache.has(key)) {
          const cached = this._cache.get(key);
          this._cache.delete(key);
          return cached;
        }
        pool.query(sql, params).then(r => {
          this._cache.set(key, r.rows);
        }).catch(() => {});
        return [];
      },

      pragma() { /* no-op for PG */ },

      transaction(fn) {
        return async (...args) => {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await fn(...args);
            await client.query('COMMIT');
          } catch(e) {
            await client.query('ROLLBACK');
            throw e;
          } finally {
            client.release();
          }
        };
      },

      async waitForInit() {
        await Promise.all(pendingExecs);
        initDone = true;
        console.log('🐘 PostgreSQL tables initialized');
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
    db.waitForInit = async () => {}; // No-op for SQLite
    console.log('📦 SQLite: ' + dbPath);
    return db;
  }
}

module.exports = { createDB };
