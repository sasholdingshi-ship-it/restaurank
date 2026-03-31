-- ============================================================
-- RestauRank — Schéma PostgreSQL complet
-- Toutes les tables pour le SaaS
-- ============================================================

-- 1. USERS (legacy — Google OAuth tokens)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE,
  google_tokens TEXT,
  gbp_accounts TEXT,
  gbp_locations TEXT,
  gbp_cache_updated TIMESTAMP,
  social_tokens TEXT DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. ACCOUNTS (auth system — clients SaaS)
CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  name TEXT,
  role TEXT DEFAULT 'user',
  plan TEXT DEFAULT 'free',
  plan_expires TIMESTAMP,
  max_restaurants INTEGER DEFAULT 1,
  is_active INTEGER DEFAULT 1,
  last_login TIMESTAMP,
  social_tokens TEXT DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

-- 3. SESSIONS
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES accounts(id),
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 4. RESTAURANTS (audit data per client)
CREATE TABLE IF NOT EXISTS restaurants (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  owner_id INTEGER REFERENCES accounts(id),
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  google_place_id TEXT,
  google_account_id TEXT,
  google_location_id TEXT,
  audit_data TEXT,
  scores TEXT,
  completed_actions TEXT DEFAULT '{}',
  platform_status TEXT DEFAULT '{}',
  hub_data TEXT,
  last_audit TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 5. ACTION LOG
CREATE TABLE IF NOT EXISTS action_log (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER,
  action_type TEXT,
  item_id TEXT,
  platform TEXT,
  status TEXT DEFAULT 'pending',
  request_data TEXT,
  response_data TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 6. RESTAURANT SETTINGS (hub data, ai settings, etc.)
CREATE TABLE IF NOT EXISTS restaurant_settings (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL,
  data TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 7. SEO SETTINGS
CREATE TABLE IF NOT EXISTS seo_settings (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL DEFAULT 0,
  settings_type TEXT NOT NULL,
  data TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 8. GOOGLE POSTS
CREATE TABLE IF NOT EXISTS google_posts (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL DEFAULT 0,
  post_type TEXT DEFAULT 'UPDATE',
  content TEXT,
  image_url TEXT,
  status TEXT DEFAULT 'draft',
  published_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 9. KEYWORD TRACKING
CREATE TABLE IF NOT EXISTS keyword_tracking (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL DEFAULT 0,
  keyword TEXT NOT NULL,
  position INTEGER,
  previous_position INTEGER,
  search_volume INTEGER,
  tracked_at TIMESTAMP DEFAULT NOW()
);

-- 10. SEO STATS HISTORY (score evolution)
CREATE TABLE IF NOT EXISTS seo_stats_history (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL DEFAULT 0,
  stat_type TEXT NOT NULL,
  value TEXT,
  source TEXT,
  recorded_at TIMESTAMP DEFAULT NOW()
);

-- 11. LICENSES
CREATE TABLE IF NOT EXISTS licenses (
  id SERIAL PRIMARY KEY,
  license_key TEXT UNIQUE NOT NULL,
  email TEXT,
  plan TEXT DEFAULT 'starter',
  max_restaurants INTEGER DEFAULT 1,
  max_scans_per_day INTEGER DEFAULT 5,
  max_directories INTEGER DEFAULT 3,
  features TEXT DEFAULT '{}',
  is_active INTEGER DEFAULT 1,
  activated_at TIMESTAMP,
  expires_at TIMESTAMP,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 12. TEAM MEMBERS
CREATE TABLE IF NOT EXISTS team_members (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'viewer',
  invited_by INTEGER,
  accepted INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 13. INVITATIONS
CREATE TABLE IF NOT EXISTS invitations (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  role TEXT DEFAULT 'viewer',
  token TEXT UNIQUE NOT NULL,
  invited_by INTEGER,
  accepted INTEGER DEFAULT 0,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 14. INVITE CODES (admin-generated)
CREATE TABLE IF NOT EXISTS invite_codes (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  created_by INTEGER,
  email_for TEXT,
  plan TEXT DEFAULT 'free',
  max_uses INTEGER DEFAULT 1,
  used_count INTEGER DEFAULT 0,
  expires_at TIMESTAMP,
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 15. GENERATED CONTENT (AI cache)
CREATE TABLE IF NOT EXISTS generated_content (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL DEFAULT 0,
  content_type TEXT NOT NULL,
  content TEXT,
  metadata TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 16. API KEYS (per-restaurant Claude keys)
CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL DEFAULT 0,
  key_type TEXT DEFAULT 'claude',
  api_key TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 17. CMS CONNECTIONS
CREATE TABLE IF NOT EXISTS cms_connections (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL DEFAULT 0,
  cms_type TEXT NOT NULL,
  site_url TEXT,
  credentials TEXT,
  status TEXT DEFAULT 'connected',
  last_sync TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 18. DIRECTORY AUTOMATION
CREATE TABLE IF NOT EXISTS directory_automation (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER DEFAULT 0,
  platform TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  claim_url TEXT,
  automation_log TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 19. AGENT RUNS (autonomous agent history)
CREATE TABLE IF NOT EXISTS agent_runs (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER DEFAULT 0,
  user_id INTEGER DEFAULT 0,
  status TEXT DEFAULT 'running',
  steps_log TEXT DEFAULT '[]',
  summary TEXT,
  started_at TIMESTAMP DEFAULT NOW(),
  finished_at TIMESTAMP
);

-- 20. SCHEDULED RESPONSES (auto review replies)
CREATE TABLE IF NOT EXISTS scheduled_responses (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER,
  platform TEXT,
  review_id TEXT,
  reply_text TEXT,
  scheduled_at TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

-- INDEXES for performance
CREATE INDEX IF NOT EXISTS idx_restaurants_owner ON restaurants(owner_id);
CREATE INDEX IF NOT EXISTS idx_restaurants_user ON restaurants(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_action_log_restaurant ON action_log(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_settings_restaurant ON restaurant_settings(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_keyword_restaurant ON keyword_tracking(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_stats_restaurant ON seo_stats_history(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_team_restaurant ON team_members(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_dir_auto_restaurant ON directory_automation(restaurant_id);
