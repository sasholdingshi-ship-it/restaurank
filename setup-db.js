#!/usr/bin/env node
// ============================================================
// RestauRank — Setup PostgreSQL database
// Usage: DATABASE_URL=postgres://... node setup-db.js
// ============================================================
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL non défini. Ajoutez-le dans .env ou en variable d\'environnement.');
  console.log('\nExemple: DATABASE_URL=postgresql://user:pass@host/dbname?sslmode=require');
  console.log('\nCréez une base gratuite sur:');
  console.log('  → https://neon.tech (recommandé — gratuit, persistant)');
  console.log('  → https://supabase.com');
  console.log('  → https://render.com/docs/databases');
  process.exit(1);
}

const { Pool } = require('pg');
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('neon.tech') || DATABASE_URL.includes('render.com') || DATABASE_URL.includes('supabase')
    ? { rejectUnauthorized: false }
    : false,
});

async function run() {
  console.log('🐘 Connexion à PostgreSQL...');

  try {
    const client = await pool.connect();
    console.log('✅ Connecté à PostgreSQL');

    // Read and execute init-db.sql
    const sql = fs.readFileSync(path.join(__dirname, 'init-db.sql'), 'utf8');
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    let created = 0, skipped = 0;
    for (const stmt of statements) {
      try {
        await client.query(stmt);
        created++;
      } catch (e) {
        if (e.message.includes('already exists')) {
          skipped++;
        } else {
          console.warn('⚠️', e.message.substring(0, 100));
        }
      }
    }

    console.log(`\n📊 Résultat: ${created} créés, ${skipped} déjà existants`);

    // Show tables
    const tables = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    console.log(`\n📋 Tables (${tables.rows.length}):`);
    tables.rows.forEach(t => console.log(`   ✅ ${t.tablename}`));

    // Check if we should migrate data from local SQLite
    const accountCount = await client.query('SELECT COUNT(*) as c FROM accounts');
    if (parseInt(accountCount.rows[0].c) === 0) {
      console.log('\n📦 Base vide — tentative de migration depuis SQLite local...');
      try {
        const Database = require('better-sqlite3');
        const localDb = new Database(path.join(__dirname, 'restaurank.db'));

        // Migrate accounts
        const accounts = localDb.prepare('SELECT * FROM accounts').all();
        for (const a of accounts) {
          try {
            await client.query(
              `INSERT INTO accounts (email, password_hash, name, role, plan, plan_expires, max_restaurants, is_active, last_login, social_tokens, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
               ON CONFLICT (email) DO NOTHING`,
              [a.email, a.password_hash, a.name, a.role, a.plan, a.plan_expires, a.max_restaurants, a.is_active, a.last_login, a.social_tokens || '{}', a.created_at]
            );
          } catch (e) {}
        }
        console.log(`   ✅ ${accounts.length} comptes migrés`);

        // Migrate restaurants
        const restaurants = localDb.prepare('SELECT * FROM restaurants').all();
        for (const r of restaurants) {
          try {
            await client.query(
              `INSERT INTO restaurants (user_id, owner_id, name, city, google_place_id, audit_data, scores, completed_actions, platform_status, last_audit)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
              [r.user_id, r.owner_id, r.name, r.city, r.google_place_id, r.audit_data, r.scores, r.completed_actions || '{}', r.platform_status || '{}', r.last_audit]
            );
          } catch (e) {}
        }
        console.log(`   ✅ ${restaurants.length} restaurants migrés`);

        // Migrate restaurant_settings
        const settings = localDb.prepare('SELECT * FROM restaurant_settings').all();
        for (const s of settings) {
          try {
            await client.query(
              `INSERT INTO restaurant_settings (restaurant_id, type, data) VALUES ($1, $2, $3)`,
              [s.restaurant_id, s.type, s.data]
            );
          } catch (e) {}
        }
        console.log(`   ✅ ${settings.length} paramètres migrés`);

        // Migrate keyword_tracking
        try {
          const keywords = localDb.prepare('SELECT * FROM keyword_tracking').all();
          for (const k of keywords) {
            await client.query(
              `INSERT INTO keyword_tracking (restaurant_id, keyword, position, previous_position, search_volume) VALUES ($1, $2, $3, $4, $5)`,
              [k.restaurant_id, k.keyword, k.position, k.previous_position, k.search_volume]
            );
          }
          console.log(`   ✅ ${keywords.length} mots-clés migrés`);
        } catch (e) {}

        // Migrate generated_content
        try {
          const content = localDb.prepare('SELECT * FROM generated_content').all();
          for (const c of content) {
            await client.query(
              `INSERT INTO generated_content (restaurant_id, content_type, content, metadata) VALUES ($1, $2, $3, $4)`,
              [c.restaurant_id, c.content_type, c.content, c.metadata]
            );
          }
          console.log(`   ✅ ${content.length} contenus IA migrés`);
        } catch (e) {}

        localDb.close();
        console.log('\n✅ Migration SQLite → PostgreSQL terminée !');
      } catch (e) {
        console.log('   ⚠️ Pas de SQLite local ou erreur:', e.message);
      }
    } else {
      console.log(`\n📊 Base existante: ${accountCount.rows[0].c} comptes déjà présents`);
    }

    client.release();

    console.log('\n🎉 Base de données prête !');
    console.log('   Ajoutez DATABASE_URL dans .env et sur Render pour utiliser PostgreSQL en production.');

  } catch (e) {
    console.error('❌ Erreur:', e.message);
  }

  await pool.end();
}

run();
