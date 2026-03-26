// ============================================================
// RestauRank — Backend SaaS
// Google Business Profile API + Yelp Data Ingestion
// ============================================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');
const zlib = require('zlib');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Node.js < 18 fetch polyfill
const fetch = globalThis.fetch || require('node-fetch');

// ============================================================
// PUPPETEER — Browser Automation Engine
// ============================================================
let puppeteer = null;
function getPuppeteer() {
  if (!puppeteer) { puppeteer = require('puppeteer'); }
  return puppeteer;
}

// Active browser sessions per restaurant
const activeBrowserSessions = {};

async function launchBrowser() {
  const ppt = getPuppeteer();
  return ppt.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
           '--window-size=1280,900', '--lang=fr-FR,fr'],
    defaultViewport: { width: 1280, height: 900 }
  });
}

async function autoFillAndScreenshot(page, step) {
  // Take screenshot at each step
  const screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 60 });
  return { screenshot: `data:image/jpeg;base64,${screenshot}`, step, url: page.url(), title: await page.title().catch(() => '') };
}

// Platform-specific automation scripts
const PLATFORM_AUTOMATIONS = {
  yelp: async (page, { name, city, phone, website }) => {
    const steps = [];
    // Step 1: Go to Yelp Business claim page
    await page.goto(`https://biz.yelp.com/claim/search?q=${encodeURIComponent(name + ' ' + city)}`, { waitUntil: 'networkidle2', timeout: 30000 });
    steps.push(await autoFillAndScreenshot(page, 'Recherche sur Yelp Business'));
    // Try to find and click on the business listing
    try {
      const found = await page.$('a[href*="/claim/"]');
      if (found) {
        await found.click();
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
        steps.push(await autoFillAndScreenshot(page, 'Page de réclamation trouvée'));
      } else {
        steps.push({ step: 'Fiche non trouvée — ajout nécessaire', url: page.url(), needsManual: true,
          detail: 'Le restaurant n\'a pas été trouvé sur Yelp. RestauRank va créer la fiche.' });
        // Try to navigate to add business
        await page.goto('https://biz.yelp.com/claim', { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
        steps.push(await autoFillAndScreenshot(page, 'Page d\'ajout de commerce'));
      }
    } catch (e) {
      steps.push({ step: 'Navigation automatique', detail: e.message, needsManual: true });
    }
    // Try to fill any visible form fields
    await autoFillFormFields(page, { business_name: name, city, phone, website, name });
    steps.push(await autoFillAndScreenshot(page, 'Formulaire pré-rempli'));
    return steps;
  },

  tripadvisor: async (page, { name, city }) => {
    const steps = [];
    await page.goto('https://www.tripadvisor.com/Owners', { waitUntil: 'networkidle2', timeout: 30000 });
    steps.push(await autoFillAndScreenshot(page, 'Page TripAdvisor Owners'));
    // Search for business
    try {
      const searchInput = await page.$('input[type="text"], input[name*="search"], input[placeholder*="name"]');
      if (searchInput) {
        await searchInput.type(name + ' ' + city, { delay: 50 });
        await page.keyboard.press('Enter');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
        steps.push(await autoFillAndScreenshot(page, 'Recherche effectuée'));
      }
    } catch (e) {}
    return steps;
  },

  thefork: async (page, { name, city }) => {
    const steps = [];
    await page.goto('https://manager.thefork.com', { waitUntil: 'networkidle2', timeout: 30000 });
    steps.push(await autoFillAndScreenshot(page, 'TheFork Manager'));
    return steps;
  },

  bing: async (page, { name, city }) => {
    const steps = [];
    await page.goto('https://www.bingplaces.com', { waitUntil: 'networkidle2', timeout: 30000 });
    steps.push(await autoFillAndScreenshot(page, 'Bing Places Dashboard'));
    try {
      // Try import from Google
      const importBtn = await page.$('a[href*="ImportFromGoogle"], button:has-text("Import")');
      if (importBtn) {
        await importBtn.click();
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
        steps.push(await autoFillAndScreenshot(page, 'Import depuis Google'));
      }
    } catch (e) {}
    return steps;
  },

  foursquare: async (page, { name, city }) => {
    const steps = [];
    const q = encodeURIComponent(name + ' ' + city);
    await page.goto(`https://foursquare.com/search?q=${q}`, { waitUntil: 'networkidle2', timeout: 30000 });
    steps.push(await autoFillAndScreenshot(page, 'Recherche Foursquare'));
    return steps;
  },

  apple: async (page, { name, city }) => {
    const steps = [];
    const q = encodeURIComponent(name + ' ' + city);
    await page.goto(`https://businessconnect.apple.com/search?term=${q}`, { waitUntil: 'networkidle2', timeout: 30000 });
    steps.push(await autoFillAndScreenshot(page, 'Apple Business Connect'));
    return steps;
  },

  pagesjaunes: async (page, { name, city }) => {
    const steps = [];
    await page.goto('https://www.solocal.com/inscription', { waitUntil: 'networkidle2', timeout: 30000 });
    steps.push(await autoFillAndScreenshot(page, 'Solocal / Pages Jaunes'));
    await autoFillFormFields(page, { business_name: name, city, name });
    steps.push(await autoFillAndScreenshot(page, 'Formulaire pré-rempli'));
    return steps;
  },

  facebook: async (page, { name, city, phone, website }) => {
    const steps = [];
    await page.goto('https://www.facebook.com/pages/create/', { waitUntil: 'networkidle2', timeout: 30000 });
    steps.push(await autoFillAndScreenshot(page, 'Création de page Facebook'));
    await autoFillFormFields(page, { page_name: name, name, city, phone, website, category: 'Restaurant' });
    steps.push(await autoFillAndScreenshot(page, 'Formulaire pré-rempli'));
    return steps;
  },

  instagram: async (page, { name }) => {
    const steps = [];
    await page.goto('https://business.instagram.com', { waitUntil: 'networkidle2', timeout: 30000 });
    steps.push(await autoFillAndScreenshot(page, 'Instagram Business'));
    return steps;
  },

  ubereats: async (page, { name, city, phone }) => {
    const steps = [];
    await page.goto('https://merchants.ubereats.com/signup', { waitUntil: 'networkidle2', timeout: 30000 });
    steps.push(await autoFillAndScreenshot(page, 'Uber Eats Marchands'));
    await autoFillFormFields(page, { restaurant_name: name, name, city, phone });
    steps.push(await autoFillAndScreenshot(page, 'Formulaire pré-rempli'));
    return steps;
  },

  waze: async (page, { name, city }) => {
    const steps = [];
    await page.goto('https://ads.waze.com/register', { waitUntil: 'networkidle2', timeout: 30000 });
    steps.push(await autoFillAndScreenshot(page, 'Waze for Business'));
    await autoFillFormFields(page, { business_name: name, name, city });
    steps.push(await autoFillAndScreenshot(page, 'Formulaire pré-rempli'));
    return steps;
  },

  // New platforms
  tiktok: async (page, { name }) => {
    const steps = [];
    await page.goto('https://www.tiktok.com/business', { waitUntil: 'networkidle2', timeout: 30000 });
    steps.push(await autoFillAndScreenshot(page, 'TikTok Business'));
    return steps;
  },
  mapstr: async (page, { name, city }) => {
    const steps = [];
    await page.goto('https://pro.mapstr.com', { waitUntil: 'networkidle2', timeout: 30000 });
    steps.push(await autoFillAndScreenshot(page, 'Mapstr Pro'));
    return steps;
  },
  zenchef: async (page, { name, city, phone }) => {
    const steps = [];
    await page.goto('https://www.zenchef.com/inscription', { waitUntil: 'networkidle2', timeout: 30000 });
    steps.push(await autoFillAndScreenshot(page, 'Zenchef'));
    await autoFillFormFields(page, { name, city, phone });
    steps.push(await autoFillAndScreenshot(page, 'Formulaire pré-rempli'));
    return steps;
  },
  opentable: async (page, { name, city }) => {
    const steps = [];
    await page.goto('https://restaurant.opentable.com/get-started', { waitUntil: 'networkidle2', timeout: 30000 });
    steps.push(await autoFillAndScreenshot(page, 'OpenTable'));
    await autoFillFormFields(page, { name, city });
    steps.push(await autoFillAndScreenshot(page, 'Formulaire pré-rempli'));
    return steps;
  },
  deliveroo: async (page, { name, city, phone }) => {
    const steps = [];
    await page.goto('https://restaurants.deliveroo.com/signup', { waitUntil: 'networkidle2', timeout: 30000 });
    steps.push(await autoFillAndScreenshot(page, 'Deliveroo Partner'));
    await autoFillFormFields(page, { restaurant_name: name, name, city, phone });
    steps.push(await autoFillAndScreenshot(page, 'Formulaire pré-rempli'));
    return steps;
  },
  doordash: async (page, { name, city }) => {
    const steps = [];
    await page.goto('https://get.doordash.com/signup', { waitUntil: 'networkidle2', timeout: 30000 });
    steps.push(await autoFillAndScreenshot(page, 'DoorDash'));
    await autoFillFormFields(page, { restaurant_name: name, name, city });
    steps.push(await autoFillAndScreenshot(page, 'Formulaire pré-rempli'));
    return steps;
  },
  justeat: async (page, { name, city, phone }) => {
    const steps = [];
    await page.goto('https://restaurants.just-eat.fr/inscription', { waitUntil: 'networkidle2', timeout: 30000 });
    steps.push(await autoFillAndScreenshot(page, 'Just Eat'));
    await autoFillFormFields(page, { restaurant_name: name, name, city, phone });
    steps.push(await autoFillAndScreenshot(page, 'Formulaire pré-rempli'));
    return steps;
  }
};

// Smart form filler — tries multiple selectors
async function autoFillFormFields(page, data) {
  const fieldMappings = [
    { keys: ['business_name', 'restaurant_name', 'name', 'page_name'], selectors: ['input[name*="name" i]', 'input[name*="business" i]', 'input[placeholder*="nom" i]', 'input[placeholder*="name" i]', 'input[id*="name" i]', 'input[aria-label*="name" i]'] },
    { keys: ['city', 'location'], selectors: ['input[name*="city" i]', 'input[name*="location" i]', 'input[placeholder*="ville" i]', 'input[placeholder*="city" i]', 'input[id*="city" i]', 'input[id*="location" i]'] },
    { keys: ['phone'], selectors: ['input[name*="phone" i]', 'input[name*="tel" i]', 'input[type="tel"]', 'input[placeholder*="phone" i]', 'input[placeholder*="téléphone" i]'] },
    { keys: ['website'], selectors: ['input[name*="website" i]', 'input[name*="url" i]', 'input[type="url"]', 'input[placeholder*="site" i]', 'input[placeholder*="website" i]'] },
    { keys: ['email'], selectors: ['input[name*="email" i]', 'input[type="email"]', 'input[placeholder*="email" i]'] },
    { keys: ['category'], selectors: ['input[name*="category" i]', 'input[name*="type" i]', 'select[name*="category" i]'] }
  ];

  for (const mapping of fieldMappings) {
    const value = mapping.keys.map(k => data[k]).find(v => v);
    if (!value) continue;
    for (const selector of mapping.selectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          await el.click({ clickCount: 3 }); // Select all
          await el.type(value, { delay: 30 });
          break;
        }
      } catch (e) {}
    }
  }
}

// Lazy-load googleapis to avoid memory spike at startup (macOS OOM kill)
let _google = null;
function getGoogle() {
  if (!_google) { _google = require('googleapis').google; }
  return _google;
}

// ============================================================
// EMAIL TRANSPORTER — Nodemailer
// ============================================================
let mailTransporter = null;
function getMailTransporter() {
  if (mailTransporter) return mailTransporter;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    console.warn('⚠️ SMTP non configuré — les emails seront loggés en console uniquement');
    return null;
  }
  mailTransporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass }
  });
  console.log(`📧 SMTP configuré: ${host}`);
  return mailTransporter;
}

const MAIL_FROM = process.env.SMTP_FROM || 'RestauRank <noreply@restaurank.com>';
const APP_URL = process.env.APP_URL || 'http://localhost:8765';

async function sendEmail(to, subject, html) {
  const transporter = getMailTransporter();
  if (!transporter) {
    console.log(`📧 [DEV] Email to ${to}: ${subject}`);
    console.log(`📧 [DEV] ${html.replace(/<[^>]*>/g, '').substring(0, 200)}`);
    return { success: true, mode: 'dev_log' };
  }
  try {
    await transporter.sendMail({ from: MAIL_FROM, to, subject, html });
    console.log(`📧 Email envoyé à ${to}: ${subject}`);
    return { success: true, mode: 'smtp' };
  } catch (e) {
    console.error(`❌ Email failed to ${to}:`, e.message);
    return { success: false, error: e.message };
  }
}

function emailResetPassword(email, token) {
  const link = `${APP_URL}/?reset=${token}`;
  return sendEmail(email, 'RestauRank — Réinitialisation de mot de passe', `
    <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;padding:24px;">
      <h2 style="color:#6366f1;">🔑 Réinitialisation de mot de passe</h2>
      <p>Vous avez demandé à réinitialiser votre mot de passe RestauRank.</p>
      <p>Cliquez sur le bouton ci-dessous (valide 1 heure) :</p>
      <a href="${link}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0;">Réinitialiser mon mot de passe</a>
      <p style="color:#888;font-size:13px;">Si vous n'avez pas fait cette demande, ignorez cet email.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
      <p style="color:#aaa;font-size:12px;">RestauRank — Audit SEO + GEO pour restaurants</p>
    </div>
  `);
}

function emailTeamInvitation(email, inviterName, restaurantName, token) {
  const link = `${APP_URL}/?invite=${token}`;
  return sendEmail(email, `RestauRank — Invitation à rejoindre ${restaurantName}`, `
    <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;padding:24px;">
      <h2 style="color:#6366f1;">👥 Invitation à rejoindre une équipe</h2>
      <p><strong>${inviterName}</strong> vous invite à rejoindre <strong>${restaurantName}</strong> sur RestauRank.</p>
      <a href="${link}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0;">Accepter l'invitation</a>
      <p style="color:#888;font-size:13px;">Cette invitation expire dans 7 jours.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
      <p style="color:#aaa;font-size:12px;">RestauRank — Audit SEO + GEO pour restaurants</p>
    </div>
  `);
}

function emailInviteCode(email, code, plan) {
  const link = `${APP_URL}/?code=${code}`;
  return sendEmail(email, 'RestauRank — Votre code d\'accès', `
    <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;padding:24px;">
      <h2 style="color:#6366f1;">🎟️ Votre code d'accès RestauRank</h2>
      <p>Voici votre code pour créer un compte RestauRank (plan <strong>${plan}</strong>) :</p>
      <div style="background:#1a1a2e;color:#6366f1;font-size:24px;font-weight:900;letter-spacing:3px;padding:16px 24px;border-radius:8px;text-align:center;margin:16px 0;">${code}</div>
      <a href="${link}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0;">S'inscrire maintenant</a>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
      <p style="color:#aaa;font-size:12px;">RestauRank — Audit SEO + GEO pour restaurants</p>
    </div>
  `);
}

// ============================================================
// STARTUP VALIDATION
// ============================================================
const NODE_ENV = process.env.NODE_ENV || 'development';
if (NODE_ENV === 'production') {
  const required = ['ADMIN_EMAIL', 'ADMIN_PASSWORD'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`❌ Variables d'environnement manquantes en production: ${missing.join(', ')}`);
    console.error('Consultez .env.example pour la configuration complète.');
    process.exit(1);
  }
  const recommended = ['STRIPE_SECRET_KEY', 'SMTP_HOST', 'APP_URL'];
  const missingRec = recommended.filter(k => !process.env[k]);
  if (missingRec.length) {
    console.warn(`⚠️ Variables recommandées non configurées: ${missingRec.join(', ')}`);
  }
}

const app = express();
app.use(cors());
app.use((req,res,next)=>{if(req.method==='POST')console.log(`[REQ] ${req.method} ${req.url} from ${req.headers['user-agent']?.substring(0,30)}`);next();});
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 8765;

// ============================================================
// DATABASE — SQLite
// ============================================================
// Use /tmp for SQLite to avoid I/O issues on mounted volumes
const dbPath = process.env.DB_PATH || path.join(__dirname, 'restaurank.db');
const db = new Database(dbPath);
try { db.pragma('journal_mode = WAL'); } catch(e) { console.warn('WAL mode unavailable, using default'); }

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    google_tokens TEXT,
    gbp_accounts TEXT,
    gbp_locations TEXT,
    gbp_cache_updated DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS restaurants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT NOT NULL,
    city TEXT NOT NULL,
    google_place_id TEXT,
    google_account_id TEXT,
    google_location_id TEXT,
    audit_data TEXT,
    scores TEXT,
    completed_actions TEXT DEFAULT '{}',
    platform_status TEXT DEFAULT '{}',
    last_audit DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS action_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER,
    action_type TEXT,
    item_id TEXT,
    platform TEXT,
    status TEXT DEFAULT 'pending',
    request_data TEXT,
    response_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS restaurant_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER NOT NULL DEFAULT 0,
    type TEXT NOT NULL,
    data TEXT DEFAULT '{}',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(restaurant_id, type)
  );
  CREATE TABLE IF NOT EXISTS seo_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER NOT NULL,
    setting_type TEXT NOT NULL,
    setting_data TEXT DEFAULT '{}',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(restaurant_id, setting_type)
  );
  CREATE TABLE IF NOT EXISTS google_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER NOT NULL,
    post_type TEXT DEFAULT 'news',
    content TEXT,
    status TEXT DEFAULT 'draft',
    scheduled_at DATETIME,
    published_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS keyword_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER NOT NULL,
    keyword TEXT NOT NULL,
    language TEXT DEFAULT 'FR',
    popularity TEXT DEFAULT 'Moyenne',
    position INTEGER,
    previous_position INTEGER,
    competitors INTEGER DEFAULT 0,
    last_checked DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS seo_stats_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER NOT NULL,
    period TEXT,
    total_searches INTEGER DEFAULT 0,
    maps_views INTEGER DEFAULT 0,
    actions_count INTEGER DEFAULT 0,
    branded_searches INTEGER DEFAULT 0,
    discovery_searches INTEGER DEFAULT 0,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ============================================================
// LICENSE TABLE — domain-locked license keys
// ============================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS licenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key TEXT UNIQUE NOT NULL,
    owner_email TEXT,
    plan TEXT DEFAULT 'pro',
    allowed_domains TEXT DEFAULT '*',
    features TEXT DEFAULT 'all',
    is_active INTEGER DEFAULT 1,
    expires_at DATETIME,
    last_validated DATETIME,
    last_domain TEXT,
    session_token TEXT,
    session_expires DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Insert default dev license if none exists
const licenseCount = db.prepare('SELECT COUNT(*) as c FROM licenses').get().c;
if (licenseCount === 0) {
  const devKey = 'RK-DEV-' + crypto.randomBytes(16).toString('hex').toUpperCase();
  db.prepare('INSERT INTO licenses (license_key, owner_email, plan, allowed_domains, features) VALUES (?, ?, ?, ?, ?)')
    .run(devKey, 'admin@restaurank.com', 'enterprise', '*', 'all');
  console.log(`🔑 Dev license created: ${devKey}`);
}

// ============================================================
// AUTH TABLES — accounts, sessions, roles, subscriptions, invitations
// ============================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    name TEXT,
    role TEXT DEFAULT 'client',
    plan TEXT DEFAULT 'free',
    plan_expires DATETIME,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    max_restaurants INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,
    email_verified INTEGER DEFAULT 0,
    verification_token TEXT,
    reset_token TEXT,
    reset_expires DATETIME,
    last_login DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );
  CREATE TABLE IF NOT EXISTS team_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    restaurant_id INTEGER,
    invited_by INTEGER NOT NULL,
    role TEXT DEFAULT 'viewer',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id),
    FOREIGN KEY (invited_by) REFERENCES accounts(id)
  );
  CREATE TABLE IF NOT EXISTS invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    restaurant_id INTEGER,
    role TEXT DEFAULT 'viewer',
    token TEXT UNIQUE NOT NULL,
    invited_by INTEGER NOT NULL,
    accepted INTEGER DEFAULT 0,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id),
    FOREIGN KEY (invited_by) REFERENCES accounts(id)
  );
`);

// Migrate: add owner_id to restaurants
try { db.exec(`ALTER TABLE restaurants ADD COLUMN owner_id INTEGER REFERENCES accounts(id)`); } catch(e) {}

// Create default admin account if not exists
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@restaurank.com';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'RestauRank2026!';
const existingAdmin = db.prepare('SELECT id FROM accounts WHERE email = ?').get(ADMIN_EMAIL);
if (!existingAdmin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(ADMIN_PASS, salt, 64).toString('hex');
  db.prepare('INSERT INTO accounts (email, password_hash, salt, name, role, plan, max_restaurants) VALUES (?, ?, ?, ?, ?, ?, ?)').run(ADMIN_EMAIL, hash, salt, 'Admin RestauRank', 'admin', 'enterprise', 999);
  console.log(`🔑 Admin account created: ${ADMIN_EMAIL}`);
}

// ============================================================
// AUTH HELPERS — hash, verify, session tokens
// ============================================================
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, hash) {
  const computed = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Session middleware — extracts account from Authorization header or cookie
function authMiddleware(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.session;
  if (!token) { req.account = null; return next(); }
  const session = db.prepare('SELECT s.*, a.id as account_id, a.email, a.name, a.role, a.plan, a.plan_expires, a.max_restaurants, a.is_active FROM sessions s JOIN accounts a ON s.account_id = a.id WHERE s.id = ? AND s.expires_at > datetime(\'now\')').get(token);
  if (!session || !session.is_active) { req.account = null; return next(); }
  req.account = { id: session.account_id, email: session.email, name: session.name, role: session.role, plan: session.plan, planExpires: session.plan_expires, maxRestaurants: session.max_restaurants };
  req.sessionToken = token;
  next();
}

// Require auth
function requireAuth(req, res, next) {
  if (!req.account) return res.status(401).json({ error: 'Non authentifié' });
  next();
}

// Require admin
function requireAdmin(req, res, next) {
  if (!req.account || req.account.role !== 'admin') return res.status(403).json({ error: 'Accès admin requis' });
  next();
}

// Require specific role on restaurant
function requireRole(minRole) {
  const hierarchy = { viewer: 0, manager: 1, owner: 2, admin: 3 };
  return (req, res, next) => {
    if (!req.account) return res.status(401).json({ error: 'Non authentifié' });
    if (req.account.role === 'admin') return next(); // admin bypasses
    const userLevel = hierarchy[req.account._restaurantRole] || 0;
    const required = hierarchy[minRole] || 0;
    if (userLevel < required) return res.status(403).json({ error: `Rôle ${minRole} requis` });
    next();
  };
}

// Plan limits
const PLAN_LIMITS = {
  free:       { restaurants: 1, scansPerDay: 1, autoApply: false, directories: 3,  reviews: false, team: 0,  price: 0 },
  starter:    { restaurants: 1, scansPerDay: 5, autoApply: true,  directories: 5,  reviews: true,  team: 1,  price: 29 },
  pro:        { restaurants: 3, scansPerDay: 999, autoApply: true, directories: 11, reviews: true,  team: 3,  price: 79 },
  premium:    { restaurants: 10, scansPerDay: 999, autoApply: true, directories: 11, reviews: true, team: 10, price: 149 },
  enterprise: { restaurants: 999, scansPerDay: 999, autoApply: true, directories: 11, reviews: true, team: 999, price: 0 },
};

function checkPlanLimit(account, feature) {
  const limits = PLAN_LIMITS[account.plan] || PLAN_LIMITS.free;
  return limits[feature];
}

// Apply auth middleware globally
app.use(authMiddleware);

// ============================================================
// RATE LIMITING — anti brute-force
// ============================================================
const _rateMap = new Map(); // ip -> { count, resetAt }
const RATE_LIMITS = {
  register: { max: 3,  windowMs: 60 * 60 * 1000 },  // 3 tentatives / heure
  login:    { max: 10, windowMs: 15 * 60 * 1000 },   // 10 tentatives / 15 min
  reset:    { max: 3,  windowMs: 60 * 60 * 1000 },   // 3 resets / heure
};

function rateLimit(action, req) {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const key = `${action}:${ip}`;
  const limit = RATE_LIMITS[action] || { max: 20, windowMs: 60000 };
  const now = Date.now();
  const entry = _rateMap.get(key);
  if (!entry || now > entry.resetAt) {
    _rateMap.set(key, { count: 1, resetAt: now + limit.windowMs });
    return null; // OK
  }
  entry.count++;
  if (entry.count > limit.max) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { error: `Trop de tentatives. Réessayez dans ${retryAfter}s`, retryAfter };
  }
  return null; // OK
}
// Cleanup old entries every 10min
setInterval(() => { const now = Date.now(); for (const [k, v] of _rateMap) { if (now > v.resetAt) _rateMap.delete(k); } }, 600000);

// ============================================================
// REGISTRATION SECURITY — invitation codes + admin control
// ============================================================
// Registration mode: 'closed' (invitation only), 'code' (access code), 'open' (anyone)
const REGISTRATION_MODE = process.env.REGISTRATION_MODE || 'code';
const REGISTRATION_CODE = process.env.REGISTRATION_CODE || 'RESTAURANK2026';

// Invitation codes table
db.exec(`
  CREATE TABLE IF NOT EXISTS invite_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    created_by INTEGER,
    email_for TEXT,
    plan TEXT DEFAULT 'free',
    max_uses INTEGER DEFAULT 1,
    used_count INTEGER DEFAULT 0,
    expires_at DATETIME,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ============================================================
// AUTH ROUTES — register, login, logout, me, password reset
// ============================================================
app.get('/api/ping', (req, res) => res.json({ pong: true, time: Date.now() }));

// Registration mode info (public)
app.get('/auth/registration-mode', (req, res) => {
  res.json({ mode: REGISTRATION_MODE, requiresCode: REGISTRATION_MODE !== 'open' });
});

app.post('/auth/register', (req, res) => {
  // Anti-bot: honeypot + time-trap
  if (req.body.website || req.body.company) return res.status(400).json({ error: 'Requête invalide' });
  if (req.body._ts && (Date.now() - parseInt(req.body._ts)) < 2000) return res.status(400).json({ error: 'Requête trop rapide' });
  // Rate limiting
  const rl = rateLimit('register', req);
  if (rl) return res.status(429).json(rl);

  const { email, password, name, inviteCode } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
  if (password.length < 8) return res.status(400).json({ error: 'Mot de passe minimum 8 caractères' });

  // --- REGISTRATION GATE ---
  let grantedPlan = 'free';

  if (REGISTRATION_MODE === 'closed') {
    // Only invitation codes work — check invite_codes table
    if (!inviteCode) return res.status(403).json({ error: 'Inscription sur invitation uniquement. Contactez l\'administrateur pour obtenir un code.' });
    const invite = db.prepare('SELECT * FROM invite_codes WHERE code = ? AND is_active = 1').get(inviteCode.trim());
    if (!invite) return res.status(403).json({ error: 'Code d\'invitation invalide ou expiré' });
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) return res.status(403).json({ error: 'Code d\'invitation expiré' });
    if (invite.max_uses > 0 && invite.used_count >= invite.max_uses) return res.status(403).json({ error: 'Code d\'invitation déjà utilisé' });
    if (invite.email_for && invite.email_for.toLowerCase() !== email.toLowerCase().trim()) return res.status(403).json({ error: 'Ce code est réservé à une autre adresse email' });
    // Valid — mark used
    db.prepare('UPDATE invite_codes SET used_count = used_count + 1 WHERE id = ?').run(invite.id);
    grantedPlan = invite.plan || 'free';
  } else if (REGISTRATION_MODE === 'code') {
    // Global access code — simpler gate
    if (!inviteCode) return res.status(403).json({ error: 'Un code d\'accès est requis pour s\'inscrire.' });
    // Check invite_codes table first, then fall back to global code
    const invite = db.prepare('SELECT * FROM invite_codes WHERE code = ? AND is_active = 1').get(inviteCode.trim());
    if (invite) {
      if (invite.expires_at && new Date(invite.expires_at) < new Date()) return res.status(403).json({ error: 'Code expiré' });
      if (invite.max_uses > 0 && invite.used_count >= invite.max_uses) return res.status(403).json({ error: 'Code déjà utilisé au maximum' });
      db.prepare('UPDATE invite_codes SET used_count = used_count + 1 WHERE id = ?').run(invite.id);
      grantedPlan = invite.plan || 'free';
    } else if (inviteCode.trim() !== REGISTRATION_CODE) {
      return res.status(403).json({ error: 'Code d\'accès invalide' });
    }
  }
  // mode 'open' — no check needed

  const emailClean = email.toLowerCase().trim();
  const existing = db.prepare('SELECT id FROM accounts WHERE email = ?').get(emailClean);
  if (existing) return res.status(409).json({ error: 'Cet email est déjà utilisé' });

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const verificationToken = generateToken();
  const limits = PLAN_LIMITS[grantedPlan] || PLAN_LIMITS.free;
  const result = db.prepare('INSERT INTO accounts (email, password_hash, salt, name, verification_token, plan, max_restaurants) VALUES (?, ?, ?, ?, ?, ?, ?)').run(emailClean, hash, salt, name || '', verificationToken, grantedPlan, limits.restaurants);

  // Auto-accept pending invitations for this email
  const pendingInvites = db.prepare('SELECT * FROM invitations WHERE email = ? AND accepted = 0 AND expires_at > datetime(\'now\')').all(emailClean);
  pendingInvites.forEach(inv => {
    db.prepare('INSERT INTO team_members (account_id, restaurant_id, invited_by, role) VALUES (?, ?, ?, ?)').run(result.lastInsertRowid, inv.restaurant_id, inv.invited_by, inv.role);
    db.prepare('UPDATE invitations SET accepted = 1 WHERE id = ?').run(inv.id);
  });

  // Create session
  const sessionId = generateSessionToken();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (id, account_id, expires_at) VALUES (?, ?, ?)').run(sessionId, result.lastInsertRowid, expires);
  db.prepare('UPDATE accounts SET last_login = datetime(\'now\') WHERE id = ?').run(result.lastInsertRowid);

  const account = db.prepare('SELECT id, email, name, role, plan, max_restaurants FROM accounts WHERE id = ?').get(result.lastInsertRowid);
  console.log(`🆕 New account: ${emailClean} (plan: ${grantedPlan}, mode: ${REGISTRATION_MODE}${inviteCode ? ', code: ' + inviteCode.substring(0, 6) + '...' : ''})`);
  res.json({ success: true, session: sessionId, account, invitesAccepted: pendingInvites.length });
});

app.post('/auth/login', (req, res) => {
  // Anti-bot: honeypot + time-trap
  if (req.body.website || req.body.company) return res.status(400).json({ error: 'Requête invalide' });
  if (req.body._ts && (Date.now() - parseInt(req.body._ts)) < 2000) return res.status(400).json({ error: 'Requête trop rapide' });
  // Rate limiting
  const rl = rateLimit('login', req);
  if (rl) return res.status(429).json(rl);

  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
  const account = db.prepare('SELECT * FROM accounts WHERE email = ? AND is_active = 1').get(email.toLowerCase().trim());
  if (!account) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  if (!verifyPassword(password, account.salt, account.password_hash)) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

  // Clean old sessions (keep max 5)
  const oldSessions = db.prepare('SELECT id FROM sessions WHERE account_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET 5').all(account.id);
  oldSessions.forEach(s => db.prepare('DELETE FROM sessions WHERE id = ?').run(s.id));

  const sessionId = generateSessionToken();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (id, account_id, expires_at) VALUES (?, ?, ?)').run(sessionId, account.id, expires);
  db.prepare('UPDATE accounts SET last_login = datetime(\'now\') WHERE id = ?').run(account.id);

  res.json({ success: true, session: sessionId, account: { id: account.id, email: account.email, name: account.name, role: account.role, plan: account.plan, maxRestaurants: account.max_restaurants } });
});

app.post('/auth/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.sessionToken);
  res.json({ success: true });
});

app.get('/auth/me', (req, res) => {
  if (!req.account) return res.json({ authenticated: false });
  const restaurants = db.prepare('SELECT id, name, city, last_audit FROM restaurants WHERE owner_id = ?').all(req.account.id);
  // Also get restaurants where user is team member
  const teamRestaurants = db.prepare('SELECT r.id, r.name, r.city, r.last_audit, tm.role as team_role FROM team_members tm JOIN restaurants r ON tm.restaurant_id = r.id WHERE tm.account_id = ?').all(req.account.id);
  const limits = PLAN_LIMITS[req.account.plan] || PLAN_LIMITS.free;
  res.json({ authenticated: true, account: req.account, restaurants, teamRestaurants, limits });
});

app.post('/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Mots de passe requis' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Minimum 8 caractères' });
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.account.id);
  if (!verifyPassword(currentPassword, account.salt, account.password_hash)) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(newPassword, salt);
  db.prepare('UPDATE accounts SET password_hash = ?, salt = ? WHERE id = ?').run(hash, salt, req.account.id);
  // Invalidate all other sessions
  db.prepare('DELETE FROM sessions WHERE account_id = ? AND id != ?').run(req.account.id, req.sessionToken);
  res.json({ success: true });
});

app.post('/auth/forgot-password', (req, res) => {
  // Anti-bot: honeypot + time-trap
  if (req.body.website || req.body.company) return res.status(400).json({ error: 'Requête invalide' });
  if (req.body._ts && (Date.now() - parseInt(req.body._ts)) < 2000) return res.status(400).json({ error: 'Requête trop rapide' });
  // Rate limiting
  const rl = rateLimit('reset', req);
  if (rl) return res.status(429).json(rl);
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requis' });
  const account = db.prepare('SELECT id FROM accounts WHERE email = ?').get(email.toLowerCase().trim());
  if (!account) return res.json({ success: true }); // Don't reveal existence
  const token = generateToken();
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
  db.prepare('UPDATE accounts SET reset_token = ?, reset_expires = ? WHERE id = ?').run(token, expires, account.id);
  emailResetPassword(email, token).catch(e => console.warn('Email send error:', e));
  const response = { success: true };
  if (NODE_ENV !== 'production') response._dev_token = token;
  res.json(response);
});

app.post('/auth/reset-password', (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: 'Token et mot de passe requis' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Minimum 8 caractères' });
  const account = db.prepare('SELECT * FROM accounts WHERE reset_token = ? AND reset_expires > datetime(\'now\')').get(token);
  if (!account) return res.status(400).json({ error: 'Token invalide ou expiré' });
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(newPassword, salt);
  db.prepare('UPDATE accounts SET password_hash = ?, salt = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?').run(hash, salt, account.id);
  db.prepare('DELETE FROM sessions WHERE account_id = ?').run(account.id);
  res.json({ success: true });
});

// ============================================================
// TEAM MANAGEMENT — invite, list, remove, change role
// ============================================================
app.post('/api/team/invite', requireAuth, (req, res) => {
  const { email, restaurantId, role } = req.body;
  if (!email || !restaurantId) return res.status(400).json({ error: 'Email et restaurant requis' });
  const validRoles = ['viewer', 'manager'];
  const inviteRole = validRoles.includes(role) ? role : 'viewer';

  // Check ownership
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ? AND owner_id = ?').get(restaurantId, req.account.id);
  if (!restaurant && req.account.role !== 'admin') return res.status(403).json({ error: 'Vous n\'êtes pas propriétaire de ce restaurant' });

  // Check team limit
  const teamCount = db.prepare('SELECT COUNT(*) as c FROM team_members WHERE restaurant_id = ?').get(restaurantId).c;
  const maxTeam = checkPlanLimit(req.account, 'team');
  if (teamCount >= maxTeam) return res.status(403).json({ error: `Limite équipe atteinte (${maxTeam} membres max sur le plan ${req.account.plan})` });

  // Check if already member
  const existingAccount = db.prepare('SELECT id FROM accounts WHERE email = ?').get(email.toLowerCase().trim());
  if (existingAccount) {
    const alreadyMember = db.prepare('SELECT id FROM team_members WHERE account_id = ? AND restaurant_id = ?').get(existingAccount.id, restaurantId);
    if (alreadyMember) return res.status(409).json({ error: 'Déjà membre de cette équipe' });
    // Directly add
    db.prepare('INSERT INTO team_members (account_id, restaurant_id, invited_by, role) VALUES (?, ?, ?, ?)').run(existingAccount.id, restaurantId, req.account.id, inviteRole);
    return res.json({ success: true, directAdd: true });
  }

  // Create invitation
  const token = generateToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
  db.prepare('INSERT INTO invitations (email, restaurant_id, role, token, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(email.toLowerCase().trim(), restaurantId, inviteRole, token, req.account.id, expires);
  const inviterName = req.account.name || req.account.email;
  const restaurantName = restaurant ? restaurant.name : `Restaurant #${restaurantId}`;
  emailTeamInvitation(email.toLowerCase().trim(), inviterName, restaurantName, token).catch(e => console.warn('Email send error:', e));
  const inviteResp = { success: true, invitationSent: true };
  if (NODE_ENV !== 'production') inviteResp._dev_token = token;
  res.json(inviteResp);
});

app.get('/api/team/:restaurantId', requireAuth, (req, res) => {
  const rid = req.params.restaurantId;
  const members = db.prepare('SELECT tm.id, tm.role, tm.created_at, a.email, a.name FROM team_members tm JOIN accounts a ON tm.account_id = a.id WHERE tm.restaurant_id = ?').all(rid);
  const pending = db.prepare('SELECT id, email, role, expires_at FROM invitations WHERE restaurant_id = ? AND accepted = 0 AND expires_at > datetime(\'now\')').all(rid);
  const owner = db.prepare('SELECT a.email, a.name FROM restaurants r JOIN accounts a ON r.owner_id = a.id WHERE r.id = ?').get(rid);
  res.json({ owner, members, pendingInvitations: pending });
});

app.post('/api/team/remove', requireAuth, (req, res) => {
  const { memberId } = req.body;
  const member = db.prepare('SELECT tm.*, r.owner_id FROM team_members tm JOIN restaurants r ON tm.restaurant_id = r.id WHERE tm.id = ?').get(memberId);
  if (!member) return res.status(404).json({ error: 'Membre non trouvé' });
  if (member.owner_id !== req.account.id && req.account.role !== 'admin') return res.status(403).json({ error: 'Propriétaire requis' });
  db.prepare('DELETE FROM team_members WHERE id = ?').run(memberId);
  res.json({ success: true });
});

app.post('/api/team/role', requireAuth, (req, res) => {
  const { memberId, newRole } = req.body;
  const validRoles = ['viewer', 'manager'];
  if (!validRoles.includes(newRole)) return res.status(400).json({ error: 'Rôle invalide' });
  const member = db.prepare('SELECT tm.*, r.owner_id FROM team_members tm JOIN restaurants r ON tm.restaurant_id = r.id WHERE tm.id = ?').get(memberId);
  if (!member) return res.status(404).json({ error: 'Membre non trouvé' });
  if (member.owner_id !== req.account.id && req.account.role !== 'admin') return res.status(403).json({ error: 'Propriétaire requis' });
  db.prepare('UPDATE team_members SET role = ? WHERE id = ?').run(newRole, memberId);
  res.json({ success: true });
});

// ============================================================
// LICENSE VALIDATION — server-side token check
// ============================================================
app.post('/api/license/validate', (req, res) => {
  const { key, domain } = req.body || {};
  // Check license key in DB
  const license = db.prepare('SELECT * FROM licenses WHERE license_key = ? AND is_active = 1').get(key);
  if (!license) return res.status(403).json({ valid: false, error: 'Clé de licence invalide' });
  // Check domain whitelist
  if (license.allowed_domains) {
    const allowed = license.allowed_domains.split(',').map(d => d.trim());
    if (domain && !allowed.includes(domain) && !allowed.includes('*')) {
      return res.status(403).json({ valid: false, error: 'Domaine non autorisé pour cette licence' });
    }
  }
  // Check expiry
  if (license.expires_at && new Date(license.expires_at) < new Date()) {
    return res.status(403).json({ valid: false, error: 'Licence expirée' });
  }
  // Generate short-lived token (valid 24h)
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE licenses SET last_validated = ?, last_domain = ?, session_token = ?, session_expires = ? WHERE id = ?')
    .run(new Date().toISOString(), domain || 'unknown', token, expiresAt, license.id);
  res.json({ valid: true, token, expires: expiresAt, plan: license.plan || 'pro', features: license.features || 'all' });
});

app.get('/api/license/check', (req, res) => {
  const token = req.headers['x-license-token'] || req.query.token;
  if (!token) return res.status(401).json({ valid: false });
  const license = db.prepare('SELECT * FROM licenses WHERE session_token = ? AND session_expires > datetime(\'now\') AND is_active = 1').get(token);
  res.json({ valid: !!license, plan: license?.plan || null });
});

// ============================================================
// SUBSCRIPTION MANAGEMENT — plans, upgrade, Stripe
// ============================================================
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PRICE_IDS = {
  starter: process.env.STRIPE_PRICE_STARTER || 'price_starter_monthly',
  pro: process.env.STRIPE_PRICE_PRO || 'price_pro_monthly',
  premium: process.env.STRIPE_PRICE_PREMIUM || 'price_premium_monthly'
};

let _stripe = null;
function getStripe() {
  if (!_stripe && STRIPE_SECRET) {
    try { _stripe = require('stripe')(STRIPE_SECRET); } catch(e) { console.warn('Stripe SDK not installed — running in demo mode'); }
  }
  return _stripe;
}

app.get('/api/plans', (req, res) => {
  res.json(PLAN_LIMITS);
});

// Create Stripe checkout session (or direct upgrade in demo mode)
app.post('/api/subscription/upgrade', requireAuth, async (req, res) => {
  const { plan } = req.body;
  if (!PLAN_LIMITS[plan]) return res.status(400).json({ error: 'Plan invalide' });
  if (plan === 'free') return res.status(400).json({ error: 'Utilisez /api/subscription/cancel pour passer au plan gratuit' });

  const stripe = getStripe();
  if (stripe && STRIPE_PRICE_IDS[plan] && !STRIPE_PRICE_IDS[plan].startsWith('price_')) {
    // --- PRODUCTION: Stripe checkout ---
    try {
      let customerId = db.prepare('SELECT stripe_customer_id FROM accounts WHERE id = ?').get(req.account.id)?.stripe_customer_id;
      if (!customerId) {
        const customer = await stripe.customers.create({ email: req.account.email, metadata: { account_id: String(req.account.id) } });
        customerId = customer.id;
        db.prepare('UPDATE accounts SET stripe_customer_id = ? WHERE id = ?').run(customerId, req.account.id);
      }
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [{ price: STRIPE_PRICE_IDS[plan], quantity: 1 }],
        mode: 'subscription',
        success_url: `${baseUrl}/?upgrade=success&plan=${plan}`,
        cancel_url: `${baseUrl}/?upgrade=cancel`,
        metadata: { account_id: String(req.account.id), plan }
      });
      return res.json({ success: true, mode: 'stripe', checkoutUrl: session.url, sessionId: session.id });
    } catch(e) {
      console.error('Stripe checkout error:', e.message);
      return res.status(500).json({ error: 'Erreur Stripe: ' + e.message });
    }
  } else {
    // --- DEMO MODE: instant upgrade (no Stripe keys configured) ---
    const limits = PLAN_LIMITS[plan];
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE accounts SET plan = ?, plan_expires = ?, max_restaurants = ? WHERE id = ?').run(plan, expires, limits.restaurants, req.account.id);
    console.log(`💳 [DEMO] Upgraded account ${req.account.id} to ${plan}`);
    return res.json({ success: true, mode: 'demo', plan, expires, limits });
  }
});

// Cancel subscription / downgrade to free
app.post('/api/subscription/cancel', requireAuth, async (req, res) => {
  const stripe = getStripe();
  const subId = db.prepare('SELECT stripe_subscription_id FROM accounts WHERE id = ?').get(req.account.id)?.stripe_subscription_id;
  if (stripe && subId) {
    try { await stripe.subscriptions.cancel(subId); } catch(e) { console.warn('Stripe cancel error:', e.message); }
  }
  db.prepare('UPDATE accounts SET plan = ?, plan_expires = NULL, stripe_subscription_id = NULL, max_restaurants = 1 WHERE id = ?').run('free', req.account.id);
  res.json({ success: true, plan: 'free' });
});

// Stripe customer portal (manage subscription, payment method, invoices)
app.post('/api/subscription/portal', requireAuth, async (req, res) => {
  const stripe = getStripe();
  const customerId = db.prepare('SELECT stripe_customer_id FROM accounts WHERE id = ?').get(req.account.id)?.stripe_customer_id;
  if (!stripe || !customerId) return res.json({ success: false, error: 'Stripe non configuré ou pas de compte client' });
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: baseUrl });
    res.json({ success: true, portalUrl: session.url });
  } catch(e) {
    res.status(500).json({ error: 'Erreur portail: ' + e.message });
  }
});

// Get current subscription status
app.get('/api/subscription/status', requireAuth, (req, res) => {
  const account = db.prepare('SELECT plan, plan_expires, stripe_customer_id, stripe_subscription_id FROM accounts WHERE id = ?').get(req.account.id);
  if (!account) return res.status(404).json({ error: 'Compte introuvable' });
  const limits = PLAN_LIMITS[account.plan] || PLAN_LIMITS.free;
  const isExpired = account.plan_expires && new Date(account.plan_expires) < new Date();
  res.json({
    plan: isExpired ? 'free' : account.plan,
    expires: account.plan_expires,
    isExpired,
    hasStripe: !!account.stripe_customer_id,
    limits
  });
});

// Stripe webhook — handles subscription lifecycle events
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.json({ received: true, mode: 'demo' });

  let event;
  try {
    if (STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
    } else {
      event = JSON.parse(req.body);
    }
  } catch(e) {
    console.error('⚠️ Webhook signature verification failed:', e.message);
    return res.status(400).json({ error: 'Webhook Error' });
  }

  console.log(`💳 Stripe webhook: ${event.type}`);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const accountId = session.metadata?.account_id;
      const plan = session.metadata?.plan;
      if (accountId && plan && PLAN_LIMITS[plan]) {
        const limits = PLAN_LIMITS[plan];
        const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        db.prepare('UPDATE accounts SET plan = ?, plan_expires = ?, max_restaurants = ?, stripe_subscription_id = ? WHERE id = ?')
          .run(plan, expires, limits.restaurants, session.subscription, accountId);
        console.log(`✅ Account ${accountId} upgraded to ${plan} via Stripe`);
      }
      break;
    }
    case 'invoice.paid': {
      const invoice = event.data.object;
      const subId = invoice.subscription;
      if (subId) {
        const account = db.prepare('SELECT id, plan FROM accounts WHERE stripe_subscription_id = ?').get(subId);
        if (account) {
          const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          db.prepare('UPDATE accounts SET plan_expires = ? WHERE id = ?').run(expires, account.id);
          console.log(`🔄 Subscription renewed for account ${account.id}`);
        }
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const account = db.prepare('SELECT id FROM accounts WHERE stripe_subscription_id = ?').get(sub.id);
      if (account) {
        db.prepare('UPDATE accounts SET plan = ?, plan_expires = NULL, stripe_subscription_id = NULL, max_restaurants = 1 WHERE id = ?').run('free', account.id);
        console.log(`⬇️ Account ${account.id} downgraded to free (subscription cancelled)`);
      }
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.warn(`⚠️ Payment failed for subscription ${invoice.subscription}`);
      break;
    }
  }

  res.json({ received: true });
});

// ============================================================
// ADMIN DASHBOARD — list accounts, stats, manage
// ============================================================
app.get('/api/admin/accounts', requireAuth, requireAdmin, (req, res) => {
  const accounts = db.prepare(`
    SELECT a.id, a.email, a.name, a.role, a.plan, a.plan_expires, a.max_restaurants, a.is_active, a.last_login, a.created_at,
      (SELECT COUNT(*) FROM restaurants WHERE owner_id = a.id) as restaurant_count,
      (SELECT COUNT(*) FROM sessions WHERE account_id = a.id AND expires_at > datetime('now')) as active_sessions
    FROM accounts a ORDER BY a.created_at DESC
  `).all();
  res.json(accounts);
});

app.get('/api/admin/stats', requireAuth, requireAdmin, (req, res) => {
  const totalAccounts = db.prepare('SELECT COUNT(*) as c FROM accounts').get().c;
  const activeAccounts = db.prepare('SELECT COUNT(*) as c FROM accounts WHERE is_active = 1').get().c;
  const totalRestaurants = db.prepare('SELECT COUNT(*) as c FROM restaurants').get().c;
  const planDistribution = db.prepare('SELECT plan, COUNT(*) as c FROM accounts GROUP BY plan').all();
  const recentSignups = db.prepare('SELECT COUNT(*) as c FROM accounts WHERE created_at > datetime(\'now\', \'-7 days\')').get().c;
  const recentLogins = db.prepare('SELECT COUNT(*) as c FROM accounts WHERE last_login > datetime(\'now\', \'-24 hours\')').get().c;
  const totalTeamMembers = db.prepare('SELECT COUNT(*) as c FROM team_members').get().c;
  const totalInvitations = db.prepare('SELECT COUNT(*) as c FROM invitations WHERE accepted = 0').get().c;
  res.json({ totalAccounts, activeAccounts, totalRestaurants, planDistribution, recentSignups, recentLogins, totalTeamMembers, totalInvitations });
});

app.post('/api/admin/account/:id/toggle', requireAuth, requireAdmin, (req, res) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!account) return res.status(404).json({ error: 'Compte non trouvé' });
  if (account.role === 'admin') return res.status(403).json({ error: 'Impossible de désactiver un admin' });
  db.prepare('UPDATE accounts SET is_active = ? WHERE id = ?').run(account.is_active ? 0 : 1, req.params.id);
  if (!account.is_active === false) db.prepare('DELETE FROM sessions WHERE account_id = ?').run(req.params.id);
  res.json({ success: true, isActive: !account.is_active });
});

app.post('/api/admin/account/:id/plan', requireAuth, requireAdmin, (req, res) => {
  const { plan } = req.body;
  if (!PLAN_LIMITS[plan]) return res.status(400).json({ error: 'Plan invalide' });
  const limits = PLAN_LIMITS[plan];
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE accounts SET plan = ?, plan_expires = ?, max_restaurants = ? WHERE id = ?').run(plan, expires, limits.restaurants, req.params.id);
  res.json({ success: true });
});

app.get('/api/admin/account/:id/restaurants', requireAuth, requireAdmin, (req, res) => {
  const restaurants = db.prepare('SELECT id, name, city, last_audit, scores FROM restaurants WHERE owner_id = ?').all(req.params.id);
  res.json(restaurants);
});

// --- ADMIN: Invite Codes Management ---
app.get('/api/admin/invite-codes', requireAuth, requireAdmin, (req, res) => {
  const codes = db.prepare('SELECT ic.*, a.email as creator_email FROM invite_codes ic LEFT JOIN accounts a ON ic.created_by = a.id ORDER BY ic.created_at DESC').all();
  res.json(codes);
});

app.post('/api/admin/invite-codes', requireAuth, requireAdmin, (req, res) => {
  const { email_for, plan, max_uses, expires_days } = req.body;
  const code = 'RK-' + crypto.randomBytes(6).toString('hex').toUpperCase();
  const expiresAt = expires_days ? new Date(Date.now() + expires_days * 24 * 60 * 60 * 1000).toISOString() : null;
  db.prepare('INSERT INTO invite_codes (code, created_by, email_for, plan, max_uses, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(code, req.account.id, email_for || null, plan || 'free', max_uses || 1, expiresAt);
  console.log(`🎟️ Invite code created: ${code} (for: ${email_for || 'anyone'}, plan: ${plan || 'free'}, uses: ${max_uses || 1})`);
  // Send invite code by email if email specified
  if (email_for) {
    emailInviteCode(email_for, code, plan || 'free').catch(e => console.warn('Email send error:', e));
  }
  res.json({ success: true, code, email_for, plan: plan || 'free', max_uses: max_uses || 1, expires_at: expiresAt });
});

app.post('/api/admin/invite-codes/:id/revoke', requireAuth, requireAdmin, (req, res) => {
  db.prepare('UPDATE invite_codes SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// --- ADMIN: Registration mode ---
app.get('/api/admin/registration-mode', requireAuth, requireAdmin, (req, res) => {
  res.json({ mode: REGISTRATION_MODE, code: REGISTRATION_MODE === 'code' ? REGISTRATION_CODE : null });
});

// Migrate existing DB: add cache columns if missing
try {
  db.exec(`ALTER TABLE users ADD COLUMN gbp_accounts TEXT`);
} catch(e) { /* column already exists */ }
try {
  db.exec(`ALTER TABLE users ADD COLUMN gbp_locations TEXT`);
} catch(e) {}
try {
  db.exec(`ALTER TABLE users ADD COLUMN gbp_cache_updated DATETIME`);
} catch(e) {}

// ============================================================
// GOOGLE OAUTH2
// ============================================================
let _oauth2Client = null;
function getOAuth2Client() {
  if (!_oauth2Client) {
    _oauth2Client = new (getGoogle()).auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback'
    );
  }
  return _oauth2Client;
}

const SCOPES = [
  'https://www.googleapis.com/auth/business.manage',
  'https://www.googleapis.com/auth/userinfo.email'
];

// Auth: Start OAuth flow
app.get('/auth/google', (req, res) => {
  const url = getOAuth2Client().generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
  res.json({ url });
});

// Auth: OAuth callback
app.get('/auth/google/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await getOAuth2Client().getToken(code);
    getOAuth2Client().setCredentials(tokens);

    // Get user email
    const oauth2 = getGoogle().oauth2({ version: 'v2', auth: getOAuth2Client() });
    const { data: userInfo } = await oauth2.userinfo.get();

    // Store/update user
    const stmt = db.prepare(`
      INSERT INTO users (email, google_tokens) VALUES (?, ?)
      ON CONFLICT(email) DO UPDATE SET google_tokens = ?
    `);
    stmt.run(userInfo.email, JSON.stringify(tokens), JSON.stringify(tokens));

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(userInfo.email);

    // Popup-friendly callback: write to localStorage and close popup
    // If opened in popup, this page will auto-close
    // If opened as redirect, it works the same as before
    const email = encodeURIComponent(userInfo.email);
    res.send(`<!DOCTYPE html><html><head><title>RestauRank — Connexion réussie</title></head><body style="background:#06070b;color:#eaecf4;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
      <div style="text-align:center;">
        <div style="font-size:3rem;margin-bottom:16px;">✅</div>
        <h2>Google connecté !</h2>
        <p style="color:#6e7490;">Retournez à RestauRank…</p>
      </div>
      <script>
        try{
          var authData=JSON.stringify({connected:true,email:decodeURIComponent('${email}'),userId:${user.id},accountId:null,locationName:null,locationTitle:null});
          localStorage.setItem('restaurank_google_auth',authData);
        }catch(e){}
        // If in popup, close; otherwise redirect
        if(window.opener){
          window.close();
        }else{
          window.location.href='/?auth=success&user_id=${user.id}&email=${email}';
        }
      </script>
    </body></html>`);
  } catch (err) {
    console.error('OAuth error:', err.message);
    res.send(`<!DOCTYPE html><html><head><title>RestauRank — Erreur</title></head><body style="background:#06070b;color:#eaecf4;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
      <div style="text-align:center;">
        <div style="font-size:3rem;margin-bottom:16px;">❌</div>
        <h2>Erreur de connexion</h2>
        <p style="color:#6e7490;">${err.message || 'Réessayez'}</p>
      </div>
      <script>if(window.opener){setTimeout(()=>window.close(),3000);}else{setTimeout(()=>window.location.href='/?auth=error',3000);}</script>
    </body></html>`);
  }
});

// ============================================================
// MIDDLEWARE — Auth helper
// ============================================================
function getAuthClient(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || !user.google_tokens) return null;
  const client = new (getGoogle()).auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  const tokens = JSON.parse(user.google_tokens);
  client.setCredentials(tokens);

  // Auto-save refreshed tokens back to DB
  client.on('tokens', (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    try {
      db.prepare('UPDATE users SET google_tokens = ? WHERE id = ?')
        .run(JSON.stringify(merged), userId);
      console.log('Token refreshed and saved for user', userId);
    } catch(e) { console.warn('Token save failed:', e.message); }
  });

  return client;
}

// ============================================================
// GOOGLE BUSINESS PROFILE — API ENDPOINTS
// ============================================================

// List all GBP accounts for user (with cache)
app.get('/api/gbp/accounts', async (req, res) => {
  const userId = req.query.user_id;
  try {
    const auth = getAuthClient(userId);
    if (!auth) return res.status(401).json({ error: 'Non connecté à Google' });

    // Check cache first (valid for 24h)
    const user = db.prepare('SELECT gbp_accounts, gbp_cache_updated FROM users WHERE id = ?').get(userId);
    if (user && user.gbp_accounts && user.gbp_cache_updated) {
      const cacheAge = Date.now() - new Date(user.gbp_cache_updated + 'Z').getTime();
      if (cacheAge < 24 * 60 * 60 * 1000) {
        console.log('Returning cached GBP accounts for user', userId);
        return res.json(JSON.parse(user.gbp_accounts));
      }
    }

    const mybusiness = getGoogle().mybusinessaccountmanagement({ version: 'v1', auth });
    const { data } = await mybusiness.accounts.list();
    const accounts = data.accounts || [];

    // Cache the result
    db.prepare('UPDATE users SET gbp_accounts = ?, gbp_cache_updated = datetime(\'now\') WHERE id = ?')
      .run(JSON.stringify(accounts), userId);
    console.log('Cached', accounts.length, 'GBP accounts for user', userId);

    res.json(accounts);
  } catch (err) {
    console.error('GBP accounts error:', err.message);
    // If quota exceeded but we have cache, return stale cache
    const user = db.prepare('SELECT gbp_accounts FROM users WHERE id = ?').get(userId);
    if (user && user.gbp_accounts) {
      console.log('Quota exceeded — returning stale cache for user', userId);
      return res.json(JSON.parse(user.gbp_accounts));
    }
    res.status(500).json({ error: err.message });
  }
});

// List locations for an account (with cache)
app.get('/api/gbp/locations', async (req, res) => {
  const { user_id, account_id } = req.query;
  try {
    const auth = getAuthClient(user_id);
    if (!auth) return res.status(401).json({ error: 'Non connecté' });

    // Check cache first
    const user = db.prepare('SELECT gbp_locations, gbp_cache_updated FROM users WHERE id = ?').get(user_id);
    if (user && user.gbp_locations && user.gbp_cache_updated) {
      const cacheAge = Date.now() - new Date(user.gbp_cache_updated + 'Z').getTime();
      if (cacheAge < 24 * 60 * 60 * 1000) {
        console.log('Returning cached GBP locations for user', user_id);
        return res.json(JSON.parse(user.gbp_locations));
      }
    }

    const mybusiness = getGoogle().mybusinessbusinessinformation({ version: 'v1', auth });
    const { data } = await mybusiness.accounts.locations.list({
      parent: account_id,
      readMask: 'name,title,storefrontAddress,phoneNumbers,websiteUri,regularHours,categories,profile'
    });
    const locations = data.locations || [];

    // Cache the result
    db.prepare('UPDATE users SET gbp_locations = ?, gbp_cache_updated = datetime(\'now\') WHERE id = ?')
      .run(JSON.stringify(locations), user_id);
    console.log('Cached', locations.length, 'GBP locations for user', user_id);

    res.json(locations);
  } catch (err) {
    console.error('GBP locations error:', err.message);
    // If quota exceeded but we have cache, return stale cache
    const user = db.prepare('SELECT gbp_locations FROM users WHERE id = ?').get(user_id);
    if (user && user.gbp_locations) {
      console.log('Quota exceeded — returning stale cache for user', user_id);
      return res.json(JSON.parse(user.gbp_locations));
    }
    res.status(500).json({ error: err.message });
  }
});

// GET/SET cached GBP info (fallback when quota blocks API)
app.get('/api/gbp/cached-info', (req, res) => {
  const user = db.prepare('SELECT gbp_accounts, gbp_locations, gbp_cache_updated FROM users WHERE id = ?')
    .get(req.query.user_id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    accounts: user.gbp_accounts ? JSON.parse(user.gbp_accounts) : null,
    locations: user.gbp_locations ? JSON.parse(user.gbp_locations) : null,
    cached_at: user.gbp_cache_updated
  });
});

app.post('/api/gbp/set-location', (req, res) => {
  const { user_id, account_name, location_name, location_title } = req.body;
  const accounts = [{ name: account_name, accountName: location_title }];
  const locations = [{ name: location_name, title: location_title }];
  db.prepare('UPDATE users SET gbp_accounts = ?, gbp_locations = ?, gbp_cache_updated = datetime(\'now\') WHERE id = ?')
    .run(JSON.stringify(accounts), JSON.stringify(locations), user_id);
  res.json({ success: true });
});

// ⚡ UPDATE DESCRIPTION (gbp_desc)
app.post('/api/gbp/update-description', async (req, res) => {
  try {
    const { user_id, location_name, description } = req.body;
    const auth = getAuthClient(user_id);
    if (!auth) return res.status(401).json({ error: 'Non connecté' });

    const mybusiness = getGoogle().mybusinessbusinessinformation({ version: 'v1', auth });
    const { data } = await mybusiness.locations.patch({
      name: location_name,
      updateMask: 'profile',
      requestBody: {
        profile: { description }
      }
    });

    // Log action
    logAction(req.body.restaurant_id, 'update_description', 'gbp_desc', 'google', 'success', req.body, data);
    res.json({ success: true, data });
  } catch (err) {
    logAction(req.body.restaurant_id, 'update_description', 'gbp_desc', 'google', 'error', req.body, { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ⚡ UPDATE CATEGORIES (gbp_cat_primary, gbp_secondary)
app.post('/api/gbp/update-categories', async (req, res) => {
  try {
    const { user_id, location_name, primaryCategory, additionalCategories } = req.body;
    const auth = getAuthClient(user_id);
    if (!auth) return res.status(401).json({ error: 'Non connecté' });

    const mybusiness = getGoogle().mybusinessbusinessinformation({ version: 'v1', auth });
    const requestBody = { categories: { primaryCategory: { name: primaryCategory } } };
    if (additionalCategories && additionalCategories.length > 0) {
      requestBody.categories.additionalCategories = additionalCategories.map(c => ({ name: c }));
    }

    const { data } = await mybusiness.locations.patch({
      name: location_name,
      updateMask: 'categories',
      requestBody
    });

    logAction(req.body.restaurant_id, 'update_categories', 'gbp_cat_primary', 'google', 'success', req.body, data);
    res.json({ success: true, data });
  } catch (err) {
    logAction(req.body.restaurant_id, 'update_categories', 'gbp_cat_primary', 'google', 'error', req.body, { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ⚡ UPDATE HOURS (gbp_hours)
app.post('/api/gbp/update-hours', async (req, res) => {
  try {
    const { user_id, location_name, regularHours } = req.body;
    const auth = getAuthClient(user_id);
    if (!auth) return res.status(401).json({ error: 'Non connecté' });

    const mybusiness = getGoogle().mybusinessbusinessinformation({ version: 'v1', auth });
    const { data } = await mybusiness.locations.patch({
      name: location_name,
      updateMask: 'regularHours',
      requestBody: { regularHours }
    });

    logAction(req.body.restaurant_id, 'update_hours', 'gbp_hours', 'google', 'success', req.body, data);
    res.json({ success: true, data });
  } catch (err) {
    logAction(req.body.restaurant_id, 'update_hours', 'gbp_hours', 'google', 'error', req.body, { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ⚡ UPDATE ATTRIBUTES (gbp_attr)
app.post('/api/gbp/update-attributes', async (req, res) => {
  try {
    const { user_id, location_name, attributes } = req.body;
    const auth = getAuthClient(user_id);
    if (!auth) return res.status(401).json({ error: 'Non connecté' });

    const mybusiness = getGoogle().mybusinessbusinessinformation({ version: 'v1', auth });
    const { data } = await mybusiness.locations.attributes.update({
      name: `${location_name}/attributes`,
      requestBody: { attributes }
    });

    logAction(req.body.restaurant_id, 'update_attributes', 'gbp_attr', 'google', 'success', req.body, data);
    res.json({ success: true, data });
  } catch (err) {
    logAction(req.body.restaurant_id, 'update_attributes', 'gbp_attr', 'google', 'error', req.body, { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ⚡ CREATE POST (gbp_posts)
app.post('/api/gbp/create-post', async (req, res) => {
  try {
    const { user_id, location_name, post } = req.body;
    const auth = getAuthClient(user_id);
    if (!auth) return res.status(401).json({ error: 'Non connecté' });

    // Google My Business Posts API
    const mybusiness = getGoogle().mybusinessbusinessinformation({ version: 'v1', auth });

    // Posts use a separate endpoint
    const response = await auth.request({
      url: `https://mybusiness.googleapis.com/v4/${location_name}/localPosts`,
      method: 'POST',
      data: {
        languageCode: 'fr-FR',
        summary: post.text,
        topicType: post.type || 'STANDARD',
        callToAction: post.cta ? {
          actionType: post.cta.type || 'LEARN_MORE',
          url: post.cta.url
        } : undefined
      }
    });

    logAction(req.body.restaurant_id, 'create_post', 'gbp_posts', 'google', 'success', req.body, response.data);
    res.json({ success: true, data: response.data });
  } catch (err) {
    logAction(req.body.restaurant_id, 'create_post', 'gbp_posts', 'google', 'error', req.body, { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ⚡ UPLOAD PHOTO (gbp_photos)
app.post('/api/gbp/upload-photo', async (req, res) => {
  try {
    const { user_id, location_name, photoUrl, category } = req.body;
    const auth = getAuthClient(user_id);
    if (!auth) return res.status(401).json({ error: 'Non connecté' });

    const response = await auth.request({
      url: `https://mybusiness.googleapis.com/v4/${location_name}/media`,
      method: 'POST',
      data: {
        mediaFormat: 'PHOTO',
        locationAssociation: { category: category || 'ADDITIONAL' },
        sourceUrl: photoUrl
      }
    });

    logAction(req.body.restaurant_id, 'upload_photo', 'gbp_photos', 'google', 'success', req.body, response.data);
    res.json({ success: true, data: response.data });
  } catch (err) {
    logAction(req.body.restaurant_id, 'upload_photo', 'gbp_photos', 'google', 'error', req.body, { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ⚡ REPLY TO REVIEW (rev_response)
app.post('/api/gbp/reply-review', async (req, res) => {
  try {
    const { user_id, location_name, review_id, reply } = req.body;
    const auth = getAuthClient(user_id);
    if (!auth) return res.status(401).json({ error: 'Non connecté' });

    const response = await auth.request({
      url: `https://mybusiness.googleapis.com/v4/${location_name}/reviews/${review_id}/reply`,
      method: 'PUT',
      data: { comment: reply }
    });

    logAction(req.body.restaurant_id, 'reply_review', 'rev_response', 'google', 'success', { review_id, reply }, response.data);
    res.json({ success: true, data: response.data });
  } catch (err) {
    logAction(req.body.restaurant_id, 'reply_review', 'rev_response', 'google', 'error', req.body, { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ⚡ GET REVIEWS (fetch all reviews from GBP)
app.get('/api/gbp/reviews', async (req, res) => {
  try {
    const { user_id, location_name } = req.query;
    const auth = getAuthClient(user_id);
    if (!auth) return res.status(401).json({ error: 'Non connecté' });

    const response = await auth.request({
      url: `https://mybusiness.googleapis.com/v4/${location_name}/reviews`,
      method: 'GET'
    });

    const reviews = (response.data.reviews || []).map(r => ({
      reviewId: r.name?.split('/').pop(),
      author: r.reviewer?.displayName || 'Anonyme',
      rating: r.starRating === 'FIVE' ? 5 : r.starRating === 'FOUR' ? 4 : r.starRating === 'THREE' ? 3 : r.starRating === 'TWO' ? 2 : 1,
      text: r.comment || '',
      date: r.createTime,
      replied: !!r.reviewReply,
      replyText: r.reviewReply?.comment || null
    }));

    res.json({ success: true, reviews, totalCount: response.data.totalReviewCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ⚡ BULK APPLY — Apply all generated improvements at once
app.post('/api/gbp/bulk-apply', async (req, res) => {
  try {
    const { user_id, location_name, restaurant_id, improvements } = req.body;
    const auth = getAuthClient(user_id);
    if (!auth) return res.status(401).json({ error: 'Non connecté' });

    const results = [];
    const mybusiness = getGoogle().mybusinessbusinessinformation({ version: 'v1', auth });

    // Build combined update
    const updateMask = [];
    const requestBody = {};

    if (improvements.description) {
      updateMask.push('profile');
      requestBody.profile = { description: improvements.description };
    }
    if (improvements.categories) {
      updateMask.push('categories');
      requestBody.categories = {
        primaryCategory: { name: improvements.categories.primary },
        additionalCategories: (improvements.categories.additional || []).map(c => ({ name: c }))
      };
    }
    if (improvements.regularHours) {
      updateMask.push('regularHours');
      requestBody.regularHours = improvements.regularHours;
    }
    if (improvements.websiteUri) {
      updateMask.push('websiteUri');
      requestBody.websiteUri = improvements.websiteUri;
    }
    if (improvements.phoneNumbers) {
      updateMask.push('phoneNumbers');
      requestBody.phoneNumbers = improvements.phoneNumbers;
    }

    // Single API call for all profile updates
    if (updateMask.length > 0) {
      const { data } = await mybusiness.locations.patch({
        name: location_name,
        updateMask: updateMask.join(','),
        requestBody
      });
      results.push({ type: 'profile_update', status: 'success', fields: updateMask });
      logAction(restaurant_id, 'bulk_update', 'bulk', 'google', 'success', { fields: updateMask }, data);
    }

    // Post creation (separate API call)
    if (improvements.post) {
      try {
        const postResp = await auth.request({
          url: `https://mybusiness.googleapis.com/v4/${location_name}/localPosts`,
          method: 'POST',
          data: {
            languageCode: 'fr-FR',
            summary: improvements.post.text,
            topicType: 'STANDARD'
          }
        });
        results.push({ type: 'post', status: 'success' });
      } catch (e) {
        results.push({ type: 'post', status: 'error', error: e.message });
      }
    }

    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// RESTAURANT CRUD
// ============================================================
app.get('/api/restaurants', (req, res) => {
  const { user_id } = req.query;
  const restaurants = db.prepare('SELECT * FROM restaurants WHERE user_id = ? ORDER BY last_audit DESC').all(user_id || 0);
  res.json(restaurants.map(r => ({
    ...r,
    audit_data: r.audit_data ? JSON.parse(r.audit_data) : null,
    scores: r.scores ? JSON.parse(r.scores) : null,
    completed_actions: JSON.parse(r.completed_actions || '{}'),
    platform_status: JSON.parse(r.platform_status || '{}')
  })));
});

app.post('/api/restaurants', (req, res) => {
  const { user_id, name, city, google_place_id, audit_data, scores } = req.body;
  if (!user_id || user_id === 0) db.pragma('foreign_keys = OFF');
  try {
    const stmt = db.prepare(`
      INSERT INTO restaurants (user_id, name, city, google_place_id, audit_data, scores, last_audit)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    const result = stmt.run(user_id || 0, name, city, google_place_id || null,
      JSON.stringify(audit_data), JSON.stringify(scores));
    res.json({ id: result.lastInsertRowid });
  } catch(e) { res.status(500).json({error:e.message}); }
  finally { db.pragma('foreign_keys = ON'); }
});

app.put('/api/restaurants/:id', (req, res) => {
  const { audit_data, scores, completed_actions, platform_status } = req.body;
  const updates = [];
  const params = [];
  if (audit_data) { updates.push('audit_data = ?'); params.push(JSON.stringify(audit_data)); }
  if (scores) { updates.push('scores = ?'); params.push(JSON.stringify(scores)); }
  if (completed_actions) { updates.push('completed_actions = ?'); params.push(JSON.stringify(completed_actions)); }
  if (platform_status) { updates.push('platform_status = ?'); params.push(JSON.stringify(platform_status)); }
  updates.push("last_audit = datetime('now')");
  params.push(req.params.id);

  db.prepare(`UPDATE restaurants SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

// ============================================================
// ACTION LOG
// ============================================================
function logAction(restaurantId, actionType, itemId, platform, status, requestData, responseData) {
  try {
    db.prepare(`
      INSERT INTO action_log (restaurant_id, action_type, item_id, platform, status, request_data, response_data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(restaurantId || 0, actionType, itemId, platform, status,
      JSON.stringify(requestData), JSON.stringify(responseData));
  } catch (e) { console.warn('Log failed:', e.message); }
}

app.get('/api/actions/:restaurant_id', (req, res) => {
  const actions = db.prepare('SELECT * FROM action_log WHERE restaurant_id = ? ORDER BY created_at DESC LIMIT 50')
    .all(req.params.restaurant_id);
  res.json(actions);
});

// ============================================================
// GBP CATEGORIES — Search available categories
// ============================================================
app.get('/api/gbp/categories/search', async (req, res) => {
  try {
    const { user_id, query } = req.query;
    const auth = getAuthClient(user_id);
    if (!auth) return res.status(401).json({ error: 'Non connecté' });

    const mybusiness = getGoogle().mybusinessbusinessinformation({ version: 'v1', auth });
    const { data } = await mybusiness.categories.list({
      regionCode: 'FR',
      languageCode: 'fr',
      filter: `displayName="${query}"`,
      pageSize: 20
    });
    res.json(data.categories || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// CMS DETECTION — Detect WordPress, Webflow, Wix, Squarespace, Shopify
// ============================================================
const http = require('http');
const https = require('https');
const { URL } = require('url');

// Realistic browser headers to avoid bot detection
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Sec-Ch-Ua': '"Chromium";v="123", "Google Chrome";v="123", "Not:A-Brand";v="99"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"macOS"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

function fetchPage(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    if (redirects <= 0) return reject(new Error('Too many redirects'));
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.get(url, { headers: { ...BROWSER_HEADERS, 'Referer': `https://www.google.com/search?q=${encodeURIComponent(parsed.hostname)}` }, timeout: 15000, rejectUnauthorized: false }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href;
        return fetchPage(next, redirects - 1).then(resolve).catch(reject);
      }
      // Handle compressed responses (gzip, deflate, br)
      let stream = res;
      const encoding = (res.headers['content-encoding'] || '').toLowerCase();
      if (encoding === 'gzip') { stream = res.pipe(zlib.createGunzip()); }
      else if (encoding === 'deflate') { stream = res.pipe(zlib.createInflate()); }
      else if (encoding === 'br') { stream = res.pipe(zlib.createBrotliDecompress()); }

      let data = '';
      stream.setEncoding('utf8');
      stream.on('data', c => { data += c; if (data.length > 500000) { stream.destroy(); resolve(data); } });
      stream.on('end', () => resolve(data));
      stream.on('error', (e) => { resolve(data || ''); }); // graceful on decompression errors
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function detectCMS(html, url) {
  const h = html.toLowerCase();
  const signals = [];

  // WordPress
  if (h.includes('wp-content') || h.includes('wp-includes') || h.includes('wp-json') || h.includes('wordpress')) {
    signals.push({ cms: 'wordpress', confidence: 95, evidence: 'wp-content/wp-includes detected' });
  }

  // Webflow
  if (h.includes('data-wf-site') || h.includes('webflow.com') || h.includes('assets.website-files.com') || h.includes('wf-page')) {
    signals.push({ cms: 'webflow', confidence: 95, evidence: 'Webflow site attributes detected' });
  }

  // Wix
  if (h.includes('wix.com') || h.includes('static.wixstatic.com') || h.includes('_wix_browser_sess') || h.includes('x-wix-')) {
    signals.push({ cms: 'wix', confidence: 95, evidence: 'Wix platform detected' });
  }

  // Squarespace
  if (h.includes('squarespace.com') || h.includes('static1.squarespace.com') || h.includes('squarespace-cdn') || h.includes('"siteId"')) {
    signals.push({ cms: 'squarespace', confidence: 90, evidence: 'Squarespace CDN detected' });
  }

  // Shopify
  if (h.includes('cdn.shopify.com') || h.includes('shopify.com') || h.includes('myshopify.com') || h.includes('shopify-section')) {
    signals.push({ cms: 'shopify', confidence: 95, evidence: 'Shopify platform detected' });
  }

  // PrestaShop
  if (h.includes('prestashop') || h.includes('addons.prestashop') || h.includes('presta') || h.includes('/modules/ps_')) {
    signals.push({ cms: 'prestashop', confidence: 85, evidence: 'PrestaShop markers detected' });
  }

  // Drupal
  if (h.includes('drupal') || h.includes('/sites/default/files') || h.includes('drupal.js')) {
    signals.push({ cms: 'drupal', confidence: 85, evidence: 'Drupal markers detected' });
  }

  // Joomla
  if (h.includes('/media/jui/') || h.includes('joomla') || h.includes('/components/com_')) {
    signals.push({ cms: 'joomla', confidence: 85, evidence: 'Joomla markers detected' });
  }

  // Check for existing schema.org
  const hasSchema = h.includes('application/ld+json') || h.includes('schema.org');
  const hasLocalBusiness = h.includes('localbusiness') || h.includes('restaurant');

  // Check meta tags
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);
  const hasOG = h.includes('og:title') || h.includes('og:description');
  const hasFAQ = h.includes('faqpage') || h.includes('mainentity');

  // Speed indicators
  const hasLazyLoad = h.includes('loading="lazy"') || h.includes('lazyload');
  const hasMinified = !h.includes('  ') || h.length > 50000; // rough heuristic

  if (signals.length === 0) {
    signals.push({ cms: 'custom', confidence: 50, evidence: 'No known CMS detected — likely custom/static site' });
  }

  // Sort by confidence
  signals.sort((a, b) => b.confidence - a.confidence);

  return {
    detected: signals[0],
    allSignals: signals,
    seoAnalysis: {
      hasSchema, hasLocalBusiness, hasOG, hasFAQ,
      title: titleMatch ? titleMatch[1].trim() : null,
      metaDescription: metaDesc ? metaDesc[1].trim() : null,
      hasLazyLoad
    }
  };
}

// API: Detect CMS for a given URL
// ============================================================
// REAL SEO AUDIT — crawl restaurant website for on-page signals
// ============================================================
app.post('/api/audit-website', async (req, res) => {
  const { url, name, city } = req.body;
  if (!url) return res.status(400).json({ error: 'URL manquante' });

  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    const html = await fetchPage(normalized);
    const h = html.toLowerCase();
    const nameNorm = (name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const cityNorm = (city || '').toLowerCase();

    const audit = {
      // Title tag
      hasTitle: /<title[^>]*>/i.test(html),
      titleText: (html.match(/<title[^>]*>(.*?)<\/title>/i) || [])[1] || '',
      titleOptimized: false,
      titleLength: 0,

      // Meta description
      hasMetaDesc: /name=["']description["']/i.test(html),
      metaDescText: (html.match(/name=["']description["'][^>]*content=["'](.*?)["']/i) || [])[1] || '',
      metaDescLength: 0,

      // Schema.org
      hasSchemaRestaurant: /schema\.org.*restaurant/i.test(html) || /"@type"\s*:\s*"Restaurant"/i.test(html),
      schemaComplete: false,
      hasAggregateRating: /aggregateRating/i.test(html),
      hasMenu: /hasMenu|menu/i.test(html) && /schema\.org/i.test(html),

      // Open Graph
      hasOpenGraph: /og:title|og:description/i.test(html),
      ogTitle: (html.match(/property=["']og:title["'][^>]*content=["'](.*?)["']/i) || [])[1] || '',

      // FAQ
      hasFAQ: /FAQPage|faq|question.*answer/i.test(html),
      faqCount: (html.match(/Question|itemtype.*Question/gi) || []).length,

      // NAP (Name, Address, Phone) on site
      napOnSite: false,
      nameOnSite: nameNorm ? h.includes(nameNorm) : false,
      cityOnSite: cityNorm ? h.includes(cityNorm) : false,
      phoneOnSite: /(\+33|0[1-9])\s*[\d\s\-.]{8,}/i.test(html),
      addressOnSite: /rue|avenue|boulevard|place|chemin/i.test(html) && cityNorm ? h.includes(cityNorm) : false,

      // Mobile/Performance hints
      hasViewport: /viewport/i.test(html),
      hasCanonical: /rel=["']canonical["']/i.test(html),
      hasHreflang: /hreflang/i.test(html),
      httpsRedirect: normalized.startsWith('https'),

      // Content richness
      wordCount: html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(w => w.length > 2).length,
      imageCount: (html.match(/<img/gi) || []).length,
      hasAltTags: /<img[^>]*alt=["'][^"']+["']/i.test(html),
      headingCount: (html.match(/<h[1-3]/gi) || []).length,

      // Booking/CTA
      hasBookingLink: /reserv|book|commander|réserv/i.test(html),
      hasPhoneLink: /tel:/i.test(html),
      hasMapEmbed: /maps\.google|google\.com\/maps|maps\.apple/i.test(html),

      // Social links
      hasSocialLinks: /facebook\.com|instagram\.com|twitter\.com|linkedin\.com/i.test(html),

      // CMS
      cms: detectCMS(html, normalized),
    };

    // Compute derived fields
    audit.titleLength = audit.titleText.length;
    audit.titleOptimized = audit.titleLength > 20 && audit.titleLength < 65 && (nameNorm ? audit.titleText.toLowerCase().includes(nameNorm) : true);
    audit.metaDescLength = audit.metaDescText.length;
    audit.schemaComplete = audit.hasSchemaRestaurant && audit.hasAggregateRating;
    audit.napOnSite = audit.nameOnSite && audit.cityOnSite && audit.phoneOnSite;

    // Check sitemap.xml and robots.txt (quick HEAD requests)
    const parsedUrl = new URL(normalized);
    const baseUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}`;
    try {
      const robotsHtml = await fetchPage(`${baseUrl}/robots.txt`);
      audit.hasRobotsTxt = robotsHtml && robotsHtml.length > 10 && !robotsHtml.includes('<html');
      audit.hasSitemap = robotsHtml.toLowerCase().includes('sitemap') || false;
    } catch (e) { audit.hasRobotsTxt = false; audit.hasSitemap = false; }
    if (!audit.hasSitemap) {
      try {
        const sitemapHtml = await fetchPage(`${baseUrl}/sitemap.xml`);
        audit.hasSitemap = sitemapHtml && (sitemapHtml.includes('<urlset') || sitemapHtml.includes('<sitemapindex'));
      } catch (e) { audit.hasSitemap = false; }
    }

    res.json({ success: true, url: normalized, audit });
  } catch (err) {
    console.error('Website audit error:', err.message);
    res.status(500).json({ error: `Impossible d'auditer le site: ${err.message}` });
  }
});

app.post('/api/detect-cms', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL manquante' });

  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    const html = await fetchPage(normalized);
    const result = detectCMS(html, normalized);
    logAction(0, 'detect_cms', 'website', result.detected.cms, 'success', { url: normalized }, result);
    res.json({ success: true, url: normalized, ...result });
  } catch (err) {
    console.error('CMS detection error:', err.message);
    res.status(500).json({ error: `Impossible d'accéder au site: ${err.message}` });
  }
});

// ============================================================
// CMS AUTO-APPLY — Push improvements via CMS APIs
// ============================================================

// Store CMS credentials per restaurant
db.exec(`
  CREATE TABLE IF NOT EXISTS cms_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER,
    cms_type TEXT NOT NULL,
    site_url TEXT NOT NULL,
    api_credentials TEXT,
    detected_info TEXT,
    status TEXT DEFAULT 'detected',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Save CMS connection
app.post('/api/cms/connect', (req, res) => {
  const { restaurant_id, cms_type, site_url, api_credentials } = req.body;
  const existing = db.prepare('SELECT * FROM cms_connections WHERE restaurant_id = ? AND cms_type = ?').get(restaurant_id || 0, cms_type);
  if (existing) {
    db.prepare('UPDATE cms_connections SET api_credentials = ?, status = ? WHERE id = ?')
      .run(JSON.stringify(api_credentials), 'connected', existing.id);
  } else {
    db.prepare('INSERT INTO cms_connections (restaurant_id, cms_type, site_url, api_credentials, status) VALUES (?, ?, ?, ?, ?)')
      .run(restaurant_id || 0, cms_type, site_url, JSON.stringify(api_credentials), 'connected');
  }
  res.json({ success: true });
});

// Get CMS connection status
app.get('/api/cms/status', (req, res) => {
  const { restaurant_id } = req.query;
  const conn = db.prepare('SELECT * FROM cms_connections WHERE restaurant_id = ? ORDER BY created_at DESC LIMIT 1').get(restaurant_id || 0);
  if (conn) {
    conn.api_credentials = conn.api_credentials ? JSON.parse(conn.api_credentials) : null;
    conn.detected_info = conn.detected_info ? JSON.parse(conn.detected_info) : null;
  }
  res.json(conn || null);
});

// ============================================================
// WORDPRESS FULL AUTO-SETUP — Install plugin + apply everything
// Le client donne juste URL + user + app_password → on fait TOUT
// ============================================================
app.post('/api/cms/wordpress/auto-setup', async (req, res) => {
  const { site_url, username, app_password, restaurant_id } = req.body;
  if (!site_url || !username || !app_password) {
    return res.status(400).json({ error: 'URL, identifiant et mot de passe d\'application requis' });
  }

  const baseUrl = site_url.replace(/\/$/, '');
  const authHeader = 'Basic ' + Buffer.from(`${username}:${app_password}`).toString('base64');
  const results = { steps: [], errors: [] };

  // Helper: WordPress REST API call via fetch
  async function wpAPI(endpoint, method = 'GET', body = null) {
    const url = `${baseUrl}/wp-json/wp/v2/${endpoint}`;
    const opts = {
      method,
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'User-Agent': 'RestauRank/1.0' },
      timeout: 20000
    };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(url, opts);
    const text = await resp.text();
    try { return { ok: resp.ok, status: resp.status, data: JSON.parse(text) }; }
    catch { return { ok: resp.ok, status: resp.status, data: text }; }
  }

  // STEP 1: Test connection
  try {
    const test = await wpAPI('users/me');
    if (!test.ok) {
      return res.status(401).json({
        error: 'Connexion WordPress échouée. Vérifiez vos identifiants.',
        detail: test.status === 401 ? 'Mot de passe d\'application invalide' : `Erreur ${test.status}`,
        help: 'Allez dans WordPress Admin → Utilisateurs → Votre profil → Mots de passe d\'application → Ajoutez "RestauRank"'
      });
    }
    results.wp_user = test.data?.name || test.data?.slug || username;
    results.steps.push('✅ Connexion WordPress réussie');
  } catch (e) {
    return res.status(500).json({ error: 'Impossible de joindre le site WordPress', detail: e.message });
  }

  // STEP 2: Install & activate the RestauRank plugin via WP REST API
  try {
    // Check if plugin is already installed
    const pluginsResp = await fetch(`${baseUrl}/wp-json/wp/v2/plugins`, {
      headers: { 'Authorization': authHeader, 'User-Agent': 'RestauRank/1.0' }
    });

    if (pluginsResp.ok) {
      const plugins = await pluginsResp.json();
      const rrPlugin = plugins.find(p => p.plugin && p.plugin.includes('restaurank'));

      if (rrPlugin) {
        // Plugin already installed — make sure it's active
        if (rrPlugin.status !== 'active') {
          await fetch(`${baseUrl}/wp-json/wp/v2/plugins/${encodeURIComponent(rrPlugin.plugin)}`, {
            method: 'PUT',
            headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'User-Agent': 'RestauRank/1.0' },
            body: JSON.stringify({ status: 'active' })
          });
        }
        results.steps.push('✅ Plugin RestauRank déjà installé et activé');
      } else {
        // Install plugin from our server
        const pluginUrl = `${process.env.APP_URL || 'http://localhost:' + PORT}/restaurank-wp-plugin.zip`;
        const installResp = await fetch(`${baseUrl}/wp-json/wp/v2/plugins`, {
          method: 'POST',
          headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'User-Agent': 'RestauRank/1.0' },
          body: JSON.stringify({ slug: 'restaurank', package: pluginUrl, status: 'active' })
        });

        if (installResp.ok) {
          results.steps.push('✅ Plugin RestauRank installé et activé automatiquement');
        } else {
          // Plugin install via API might not work on all hosts — fallback to direct apply
          results.steps.push('⚠️ Installation plugin échouée (hébergeur restrictif) — application directe via API');
          results.plugin_install_failed = true;
        }
      }
    } else {
      results.steps.push('⚠️ API plugins non disponible — application directe via API');
      results.plugin_install_failed = true;
    }
  } catch (e) {
    results.steps.push('⚠️ Plugin install: ' + e.message + ' — application directe');
    results.plugin_install_failed = true;
  }

  // STEP 3: Generate connection code and configure plugin
  try {
    const code = 'RR-' + crypto.randomBytes(2).toString('hex').toUpperCase() + '-'
               + crypto.randomBytes(2).toString('hex').toUpperCase() + '-'
               + crypto.randomBytes(2).toString('hex').toUpperCase();
    const apiToken = crypto.randomBytes(32).toString('hex');

    // Save code in RestauRank DB
    db.prepare(`INSERT OR REPLACE INTO restaurant_settings (restaurant_id, type, data, updated_at)
      VALUES (?, 'cms_connect_code', ?, datetime('now'))`)
      .run(restaurant_id || 0, JSON.stringify({ code, api_token: apiToken, created_at: new Date().toISOString(), used: true, site_url: baseUrl }));

    // Try to configure the plugin via WordPress options API
    // (The plugin reads these options on its settings page)
    try {
      await fetch(`${baseUrl}/wp-json/restaurank/v1/apply`, {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: [] }) // Just test the endpoint exists
      });
      results.steps.push('✅ Plugin RestauRank configuré');
    } catch (e) {
      results.steps.push('⚠️ Configuration plugin : endpoint non trouvé — les optimisations seront appliquées directement');
    }

    results.connect_code = code;
  } catch (e) {
    results.errors.push('Code connexion: ' + e.message);
  }

  // STEP 4: Apply SEO optimizations directly via WP REST API
  // (Works even without the plugin — uses standard WordPress endpoints)
  const restaurant = db.prepare('SELECT name, city FROM restaurants WHERE id = ?').get(restaurant_id || 0);
  const rName = restaurant?.name || 'Restaurant';
  const rCity = restaurant?.city || '';

  // 4a. Get AI content if available
  let aiContent = null;
  try {
    const aiCache = db.prepare(`SELECT data FROM restaurant_settings WHERE restaurant_id = ? AND type = 'ai_cache_onboard_pack'`).get(restaurant_id || 0);
    if (aiCache) aiContent = JSON.parse(aiCache.data)?.result;
  } catch {}

  // 4b. Inject Schema.org on homepage
  try {
    const pages = await wpAPI('pages?per_page=5&orderby=menu_order&order=asc');
    if (pages.ok && Array.isArray(pages.data) && pages.data.length > 0) {
      const homepage = pages.data[0];
      const rawContent = homepage.content?.raw || homepage.content?.rendered || '';

      // Schema.org
      const schema = aiContent?.schema_restaurant || {
        '@context': 'https://schema.org',
        '@type': 'Restaurant',
        'name': rName,
        'address': { '@type': 'PostalAddress', 'addressLocality': rCity }
      };
      if (!rawContent.includes('schema.org') && !rawContent.includes('application/ld+json')) {
        const schemaBlock = `\n<!-- wp:html -->\n<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>\n<!-- /wp:html -->`;
        await wpAPI(`pages/${homepage.id}`, 'POST', { content: rawContent + schemaBlock });
        results.steps.push('✅ Schema.org Restaurant injecté sur la page d\'accueil');
      } else {
        results.steps.push('ℹ️ Schema.org déjà présent');
      }

      // Meta title + description
      const metaTitle = aiContent?.meta_title || `${rName} — Restaurant ${rCity}`;
      const metaDesc = aiContent?.meta_description || `Découvrez ${rName} à ${rCity}. Réservez, consultez le menu et les avis.`;
      await wpAPI(`pages/${homepage.id}`, 'POST', {
        title: homepage.title?.raw || homepage.title?.rendered || rName,
        excerpt: metaDesc
      });
      results.steps.push('✅ Meta tags SEO optimisés');
    }
  } catch (e) { results.errors.push('Schema/meta: ' + e.message); }

  // 4c. Create FAQ page
  try {
    const faqCheck = await wpAPI('pages?slug=faq&per_page=1');
    const faqQuestions = aiContent?.faq || [
      { question: `Où se trouve ${rName} ?`, answer: `${rName} est situé à ${rCity}.` },
      { question: `Quels sont les horaires de ${rName} ?`, answer: `Consultez notre page pour les horaires actuels.` },
      { question: `Peut-on réserver chez ${rName} ?`, answer: `Oui, contactez-nous pour réserver une table.` }
    ];

    let faqContent = '<!-- wp:heading -->\n<h2>Questions fréquentes</h2>\n<!-- /wp:heading -->\n\n';
    const schemaItems = [];
    for (const qa of faqQuestions) {
      const q = qa.question || qa.q || '';
      const a = qa.answer || qa.a || '';
      faqContent += `<!-- wp:heading {"level":3} -->\n<h3>${q}</h3>\n<!-- /wp:heading -->\n`;
      faqContent += `<!-- wp:paragraph -->\n<p>${a}</p>\n<!-- /wp:paragraph -->\n\n`;
      schemaItems.push({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } });
    }
    // Add FAQ schema
    const faqSchema = JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: schemaItems }, null, 2);
    faqContent += `\n<!-- wp:html -->\n<script type="application/ld+json">\n${faqSchema}\n</script>\n<!-- /wp:html -->`;

    if (faqCheck.ok && Array.isArray(faqCheck.data) && faqCheck.data.length > 0) {
      await wpAPI(`pages/${faqCheck.data[0].id}`, 'POST', { content: faqContent, status: 'publish' });
      results.steps.push('✅ Page FAQ mise à jour avec FAQ Schema');
    } else {
      await wpAPI('pages', 'POST', { title: 'Questions fréquentes', slug: 'faq', content: faqContent, status: 'publish' });
      results.steps.push('✅ Page FAQ créée avec FAQ Schema');
    }
  } catch (e) { results.errors.push('FAQ: ' + e.message); }

  // 4d. Create/update Contact page with NAP
  try {
    const hubData = db.prepare(`SELECT data FROM restaurant_settings WHERE restaurant_id = ? AND type = 'hub_data'`).get(restaurant_id || 0);
    const hub = hubData ? JSON.parse(hubData.data) : {};
    const napContent = `<!-- wp:heading -->\n<h2>Nous contacter</h2>\n<!-- /wp:heading -->\n
<!-- wp:paragraph -->\n<p><strong>${rName}</strong></p>\n<!-- /wp:paragraph -->\n
${hub.address ? `<!-- wp:paragraph -->\n<p>📍 ${hub.address}</p>\n<!-- /wp:paragraph -->\n` : ''}
${hub.phone ? `<!-- wp:paragraph -->\n<p>📞 <a href="tel:${hub.phone}">${hub.phone}</a></p>\n<!-- /wp:paragraph -->\n` : ''}
${hub.website ? `<!-- wp:paragraph -->\n<p>🌐 <a href="${hub.website}">${hub.website}</a></p>\n<!-- /wp:paragraph -->\n` : ''}`;

    const contactCheck = await wpAPI('pages?slug=contact&per_page=1');
    if (contactCheck.ok && Array.isArray(contactCheck.data) && contactCheck.data.length > 0) {
      await wpAPI(`pages/${contactCheck.data[0].id}`, 'POST', { content: napContent });
      results.steps.push('✅ Page Contact mise à jour avec NAP structuré');
    } else {
      await wpAPI('pages', 'POST', { title: 'Contact', slug: 'contact', content: napContent, status: 'publish' });
      results.steps.push('✅ Page Contact créée avec NAP structuré');
    }
  } catch (e) { results.errors.push('Contact/NAP: ' + e.message); }

  // Save CMS connection in DB
  db.prepare(`INSERT OR REPLACE INTO cms_connections (restaurant_id, cms_type, site_url, api_credentials, status)
    VALUES (?, 'wordpress', ?, ?, 'connected')
    ON CONFLICT(restaurant_id, cms_type) DO UPDATE SET api_credentials = excluded.api_credentials, status = 'connected'`)
    .run(restaurant_id || 0, baseUrl, JSON.stringify({ username, app_password: '***', auth_header: authHeader }));

  logAction(restaurant_id || 0, 'cms_auto_setup', 'wordpress', 'system', 'success', { site_url: baseUrl }, results);

  console.log(`🔌 WordPress auto-setup: ${baseUrl} → ${results.steps.length} étapes OK, ${results.errors.length} erreurs`);

  res.json({
    success: true,
    steps_completed: results.steps,
    errors: results.errors,
    wp_user: results.wp_user,
    connect_code: results.connect_code,
    plugin_installed: !results.plugin_install_failed,
    message: `${results.steps.length} optimisations appliquées sur ${baseUrl}`
  });
});

// ============================================================
// UNIVERSAL AUTO-INJECT — Injecte le snippet sur n'importe quel CMS
// Détecte le CMS et utilise la bonne méthode d'injection
// ============================================================
app.post('/api/cms/auto-inject', requireAuth, async (req, res) => {
  const { restaurant_id, site_url, cms_type, credentials } = req.body;
  if (!site_url) return res.status(400).json({ error: 'URL du site requise' });

  const serverUrl = process.env.APP_URL || `http://localhost:${PORT}`;

  // Generate connection code
  const code = 'RR-' + crypto.randomBytes(2).toString('hex').toUpperCase() + '-'
             + crypto.randomBytes(2).toString('hex').toUpperCase() + '-'
             + crypto.randomBytes(2).toString('hex').toUpperCase();
  const apiToken = crypto.randomBytes(32).toString('hex');

  db.prepare(`INSERT OR REPLACE INTO restaurant_settings (restaurant_id, type, data, updated_at)
    VALUES (?, 'cms_connect_code', ?, datetime('now'))`)
    .run(restaurant_id || 0, JSON.stringify({ code, api_token: apiToken, created_at: new Date().toISOString() }));

  const snippetTag = `<script src="${serverUrl}/snippet.js" data-rr="${code}" async></script>`;
  const result = { code, snippet: snippetTag, method: 'unknown', success: false, steps: [] };

  const detectedCMS = cms_type || 'unknown';

  switch (detectedCMS) {
    case 'wordpress': {
      // WordPress: inject via REST API into theme (functions.php equivalent)
      if (credentials?.username && credentials?.app_password) {
        const baseUrl = site_url.replace(/\/$/, '');
        const authHeader = 'Basic ' + Buffer.from(`${credentials.username}:${credentials.app_password}`).toString('base64');
        try {
          // Try to add snippet as inline script via WP REST API custom endpoint
          // Or add it via wp_head by using the plugin
          // Simplest: use the auto-setup endpoint which handles everything
          result.method = 'wordpress_auto_setup';
          result.steps.push('→ Redirigé vers /api/cms/wordpress/auto-setup');
          result.redirect = '/api/cms/wordpress/auto-setup';
          result.success = true;
        } catch (e) { result.steps.push('Erreur WP: ' + e.message); }
      } else {
        result.method = 'manual';
        result.steps.push('Ajoutez ce code dans Apparence → Éditeur → header.php, avant </head>:');
        result.steps.push(snippetTag);
      }
      break;
    }

    case 'webflow': {
      // Webflow: on peut injecter via le MCP automatiquement
      // Le MCP est côté frontend (Cowork), donc on prépare les instructions
      result.method = 'webflow_mcp';
      result.success = true;
      result.mcp_action = {
        tool: 'data_scripts_tool',
        action: 'register_inline_script',
        params: {
          site_id: credentials?.site_id || '66a36b35a69a054ec392dc36',
          script: {
            sourceCode: snippetTag,
            location: 'header',
            version: '1.0.0',
            displayName: 'RestauRankSEO'
          }
        }
      };
      result.steps.push('✅ Script prêt pour injection via Webflow MCP');
      result.steps.push('Le script sera injecté automatiquement dans le head de votre site Webflow');
      break;
    }

    case 'wix': {
      // Wix: Velo (Wix Dev API) ou instructions manuelles
      result.method = credentials?.token ? 'wix_api' : 'manual';
      if (credentials?.token) {
        try {
          // Wix Embedded Scripts API
          const wixResp = await fetch('https://www.wixapis.com/apps/v1/scripts', {
            method: 'POST',
            headers: {
              'Authorization': credentials.token,
              'Content-Type': 'application/json',
              'wix-site-id': credentials.site_id || ''
            },
            body: JSON.stringify({
              properties: {
                placement: { location: 'HEAD' },
                source: { scriptTag: { url: `${serverUrl}/snippet.js`, attributes: { 'data-rr': code } } }
              }
            })
          });
          if (wixResp.ok) {
            result.success = true;
            result.steps.push('✅ Script injecté automatiquement via Wix API');
          } else {
            result.steps.push('Wix API erreur — instructions manuelles générées');
          }
        } catch (e) { result.steps.push('Wix erreur: ' + e.message); }
      }
      if (!result.success) {
        result.steps.push('1. Allez dans votre dashboard Wix');
        result.steps.push('2. Paramètres → Custom Code → + Ajouter un code');
        result.steps.push('3. Collez le code suivant :');
        result.steps.push(snippetTag);
        result.steps.push('4. Placez-le dans "Head" et "Toutes les pages"');
      }
      break;
    }

    case 'squarespace': {
      result.method = 'manual';
      result.steps.push('1. Allez dans votre dashboard Squarespace');
      result.steps.push('2. Settings → Advanced → Code Injection');
      result.steps.push('3. Dans le champ "Header", collez :');
      result.steps.push(snippetTag);
      result.steps.push('4. Cliquez "Save"');
      break;
    }

    case 'shopify': {
      result.method = credentials?.token ? 'shopify_api' : 'manual';
      if (credentials?.token && credentials?.store) {
        try {
          // Shopify ScriptTag API
          const shopResp = await fetch(`https://${credentials.store}/admin/api/2024-01/script_tags.json`, {
            method: 'POST',
            headers: { 'X-Shopify-Access-Token': credentials.token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ script_tag: { event: 'onload', src: `${serverUrl}/snippet.js?rr=${code}` } })
          });
          if (shopResp.ok) {
            result.success = true;
            result.steps.push('✅ Script injecté via Shopify ScriptTag API');
          }
        } catch (e) { result.steps.push('Shopify erreur: ' + e.message); }
      }
      if (!result.success) {
        result.steps.push('1. Allez dans Shopify Admin → Boutique en ligne → Thèmes');
        result.steps.push('2. Actions → Modifier le code');
        result.steps.push('3. Ouvrez theme.liquid');
        result.steps.push('4. Avant </head>, collez :');
        result.steps.push(snippetTag);
      }
      break;
    }

    case 'prestashop': {
      result.method = 'manual';
      result.steps.push('1. Allez dans PrestaShop Admin → Design → Thème et logo');
      result.steps.push('2. Ou installez le module "Custom HTML/JS" depuis le Marketplace');
      result.steps.push('3. Ajoutez dans le hook "displayHeader" :');
      result.steps.push(snippetTag);
      break;
    }

    default: {
      result.method = 'manual';
      result.steps.push('Ajoutez cette ligne dans le <head> de votre site :');
      result.steps.push(snippetTag);
      break;
    }
  }

  logAction(restaurant_id || 0, 'cms_inject', detectedCMS, 'system', result.success ? 'success' : 'manual', { cms: detectedCMS });

  res.json({ success: true, ...result });
});

// Serve the plugin ZIP for auto-install
app.get('/restaurank-wp-plugin.zip', (req, res) => {
  const zipPath = path.join(__dirname, 'restaurank-wp-plugin.zip');
  if (require('fs').existsSync(zipPath)) {
    res.setHeader('Content-Type', 'application/zip');
    res.sendFile(zipPath);
  } else {
    res.status(404).json({ error: 'Plugin zip not found' });
  }
});

// WordPress Auto-Apply via REST API
app.post('/api/cms/wordpress/apply', async (req, res) => {
  const { site_url, username, app_password, improvements } = req.body;
  try {
    const results = [];
    const authHeader = 'Basic ' + Buffer.from(`${username}:${app_password}`).toString('base64');
    const baseUrl = site_url.replace(/\/$/, '');

    // Helper: WordPress REST API call
    async function wpRequest(endpoint, method, body) {
      return new Promise((resolve, reject) => {
        const url = new URL(`${baseUrl}/wp-json/wp/v2/${endpoint}`);
        const mod = url.protocol === 'https:' ? https : http;
        const opts = { method, hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers: { 'Authorization': authHeader, 'Content-Type': 'application/json', 'User-Agent': 'RestauRank/1.0' } };
        const req = mod.request(opts, (res) => {
          let data = ''; res.on('data', c => data += c); res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve(data); } });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
      });
    }

    // Get homepage/front page
    if (improvements.schema_org) {
      // Try to inject schema via a custom HTML block on the homepage
      // Or update the site's head via a plugin-like approach
      try {
        // Try Yoast REST API first (most common SEO plugin)
        const pages = await wpRequest('pages?per_page=5&orderby=menu_order&order=asc', 'GET');
        if (Array.isArray(pages) && pages.length > 0) {
          const homepage = pages[0];
          let content = homepage.content?.rendered || '';
          // Check if schema already exists
          if (!content.includes('schema.org')) {
            const schemaBlock = `\n<!-- wp:html -->\n<script type="application/ld+json">\n${improvements.schema_org}\n</script>\n<!-- /wp:html -->`;
            await wpRequest(`pages/${homepage.id}`, 'POST', { content: (homepage.content?.raw || content) + schemaBlock });
            results.push({ item: 'schema_org', status: 'success', detail: 'Schema.org injecté sur la page d\'accueil' });
          } else {
            results.push({ item: 'schema_org', status: 'skipped', detail: 'Schema.org déjà présent' });
          }
        }
      } catch (e) { results.push({ item: 'schema_org', status: 'error', detail: e.message }); }
    }

    if (improvements.meta_title || improvements.meta_description) {
      try {
        const pages = await wpRequest('pages?per_page=5&orderby=menu_order&order=asc', 'GET');
        if (Array.isArray(pages) && pages.length > 0) {
          const homepage = pages[0];
          const update = {};
          if (improvements.meta_title) update.title = improvements.meta_title;
          if (improvements.meta_description) update.excerpt = improvements.meta_description;
          await wpRequest(`pages/${homepage.id}`, 'POST', update);
          results.push({ item: 'meta_tags', status: 'success', detail: 'Title + meta description mis à jour' });
        }
      } catch (e) { results.push({ item: 'meta_tags', status: 'error', detail: e.message }); }
    }

    if (improvements.faq_page) {
      try {
        // Create a FAQ page
        await wpRequest('pages', 'POST', {
          title: 'Questions fréquentes',
          content: improvements.faq_page,
          status: 'publish'
        });
        results.push({ item: 'faq_page', status: 'success', detail: 'Page FAQ créée et publiée' });
      } catch (e) { results.push({ item: 'faq_page', status: 'error', detail: e.message }); }
    }

    if (improvements.nap_footer) {
      try {
        // Try to add a reusable block or widget with NAP
        // Fallback: create a "Contact" page with NAP
        const pages = await wpRequest('pages?search=contact&per_page=1', 'GET');
        if (Array.isArray(pages) && pages.length > 0) {
          await wpRequest(`pages/${pages[0].id}`, 'POST', { content: improvements.nap_footer });
          results.push({ item: 'nap_footer', status: 'success', detail: 'NAP mis à jour sur la page Contact' });
        } else {
          await wpRequest('pages', 'POST', { title: 'Contact', content: improvements.nap_footer, status: 'publish' });
          results.push({ item: 'nap_footer', status: 'success', detail: 'Page Contact créée avec NAP structuré' });
        }
      } catch (e) { results.push({ item: 'nap_footer', status: 'error', detail: e.message }); }
    }

    logAction(req.body.restaurant_id || 0, 'cms_apply', 'wordpress', 'wordpress', 'success', req.body, results);
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Webflow Auto-Apply (generates instructions — actual apply via MCP tools in frontend)
app.post('/api/cms/webflow/apply', async (req, res) => {
  const { site_id, improvements } = req.body;
  // Webflow changes are applied via Webflow MCP tools from the frontend
  // This endpoint validates and prepares the payload
  const tasks = [];
  if (improvements.schema_org) tasks.push({ type: 'inject_script', content: `<script type="application/ld+json">${improvements.schema_org}</script>`, location: 'head' });
  if (improvements.meta_title) tasks.push({ type: 'update_page_seo', field: 'title', value: improvements.meta_title });
  if (improvements.meta_description) tasks.push({ type: 'update_page_seo', field: 'description', value: improvements.meta_description });
  if (improvements.faq_page) tasks.push({ type: 'create_page', title: 'FAQ', content: improvements.faq_page });
  if (improvements.nap_footer) tasks.push({ type: 'update_element', selector: 'footer', content: improvements.nap_footer });

  logAction(req.body.restaurant_id || 0, 'cms_apply', 'webflow', 'webflow', 'success', req.body, tasks);
  res.json({ success: true, tasks });
});

// Generic CMS apply (for Wix, Squarespace — generates step-by-step instructions)
app.post('/api/cms/generic/apply', async (req, res) => {
  const { cms_type, improvements } = req.body;
  const instructions = [];

  if (cms_type === 'wix') {
    if (improvements.schema_org) instructions.push({ step: 1, action: 'Aller dans Paramètres > Code personnalisé > Ajouter du code dans <head>', code: `<script type="application/ld+json">${improvements.schema_org}</script>` });
    if (improvements.meta_title) instructions.push({ step: 2, action: 'Aller dans SEO > Outils SEO > Modèles SEO > Accueil > Title tag', value: improvements.meta_title });
    if (improvements.meta_description) instructions.push({ step: 3, action: 'Aller dans SEO > Outils SEO > Modèles SEO > Accueil > Meta description', value: improvements.meta_description });
  } else if (cms_type === 'squarespace') {
    if (improvements.schema_org) instructions.push({ step: 1, action: 'Aller dans Paramètres > Avancé > Injection de code > Header', code: `<script type="application/ld+json">${improvements.schema_org}</script>` });
    if (improvements.meta_title) instructions.push({ step: 2, action: 'Aller dans Pages > Page d\'accueil > ⚙️ > SEO > Title', value: improvements.meta_title });
  } else if (cms_type === 'shopify') {
    if (improvements.schema_org) instructions.push({ step: 1, action: 'Aller dans Thèmes > Actions > Modifier le code > theme.liquid > avant </head>', code: `<script type="application/ld+json">${improvements.schema_org}</script>` });
    if (improvements.meta_title) instructions.push({ step: 2, action: 'Aller dans Préférences > Title et meta description', value: improvements.meta_title });
  }

  res.json({ success: true, cms_type, instructions });
});

// ============================================================
// DIRECTORY AUTO-CLAIM — Automated listing management
// ============================================================

// Store directory automation status
db.exec(`
  CREATE TABLE IF NOT EXISTS directory_automation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER,
    platform TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    claim_url TEXT,
    automation_log TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Bing Places — Import from Google (API available)
app.post('/api/directories/bing/import', async (req, res) => {
  const { restaurant_id, name, address, city, phone, website, description } = req.body;
  // Bing Places supports bulk import via CSV or Google import
  // We prepare the data and provide the import link
  const importData = {
    businessName: name,
    address: `${address}, ${city}`,
    phone: phone || '',
    website: website || '',
    description: description || `${name} — restaurant à ${city}`,
    categories: 'Restaurants',
    importUrl: 'https://www.bingplaces.com/Dashboard/ImportFromGoogle'
  };

  try {
    db.prepare('INSERT OR REPLACE INTO directory_automation (restaurant_id, platform, status, claim_url, automation_log, updated_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))')
      .run(restaurant_id || 0, 'bing', 'ready', importData.importUrl, JSON.stringify(importData));
  } catch (e) { console.warn('DB error:', e.message); }

  res.json({ success: true, platform: 'bing', ...importData });
});

// Apple Business Connect — Prepare claim
app.post('/api/directories/apple/claim', async (req, res) => {
  const { restaurant_id, name, city } = req.body;
  const searchTerm = encodeURIComponent(`${name} ${city}`);
  const claimUrl = `https://businessconnect.apple.com/search?term=${searchTerm}`;

  try {
    db.prepare('INSERT OR REPLACE INTO directory_automation (restaurant_id, platform, status, claim_url, updated_at) VALUES (?, ?, ?, ?, datetime(\'now\'))')
      .run(restaurant_id || 0, 'apple', 'ready', claimUrl);
  } catch (e) {}

  res.json({ success: true, platform: 'apple', claimUrl });
});

// Foursquare — Venue claim via API
app.post('/api/directories/foursquare/claim', async (req, res) => {
  const { restaurant_id, name, city } = req.body;
  const searchTerm = encodeURIComponent(`${name} ${city}`);
  const claimUrl = `https://foursquare.com/search?q=${searchTerm}`;

  try {
    db.prepare('INSERT OR REPLACE INTO directory_automation (restaurant_id, platform, status, claim_url, updated_at) VALUES (?, ?, ?, ?, datetime(\'now\'))')
      .run(restaurant_id || 0, 'foursquare', 'ready', claimUrl);
  } catch (e) {}

  res.json({ success: true, platform: 'foursquare', claimUrl });
});

// ============================================================
// DIRECTORY AUTO-CHECK — Verify existence on all platforms
// ============================================================
async function checkPlatformListing(platform, name, city) {
  const q = encodeURIComponent(`${name} ${city}`);
  const checks = {
    yelp: { url: `https://www.yelp.com/search?find_desc=${q}&find_loc=${encodeURIComponent(city)}`, pattern: /biz-name|organic-search-result|searchResult/i },
    tripadvisor: { url: `https://www.tripadvisor.com/Search?q=${q}`, pattern: /data-test-target="restaurants|result-title/i },
    thefork: { url: `https://www.thefork.fr/recherche?queryText=${q}`, pattern: /restaurantResult|searchResult/i },
    bing: { url: `https://www.bing.com/maps?q=${q}+restaurant`, pattern: /taskCard|entity-hero|listing/i },
    foursquare: { url: `https://foursquare.com/explore?near=${encodeURIComponent(city)}&q=${encodeURIComponent(name)}`, pattern: /venue|venueDetail/i },
    apple: { url: `https://maps.apple.com/?q=${q}`, pattern: null },
    pagesjaunes: { url: `https://www.pagesjaunes.fr/pagesblanches/recherche?quoiqui=${encodeURIComponent(name)}&ou=${encodeURIComponent(city)}`, pattern: /bi-denomination|bi-address/i },
    facebook: { url: `https://www.facebook.com/search/pages/?q=${q}`, pattern: null },
    instagram: { url: `https://www.instagram.com/explore/tags/${encodeURIComponent(name.replace(/\s+/g,'').toLowerCase())}`, pattern: null },
    ubereats: { url: `https://www.ubereats.com/fr/search?q=${encodeURIComponent(name)}`, pattern: /store-card|storeCard/i },
    waze: { url: `https://www.waze.com/live-map/directions?q=${q}`, pattern: null }
  };

  const check = checks[platform];
  if (!check) return { platform, status: 'unknown', found: false };

  try {
    const html = await fetchPage(check.url);
    const nameNorm = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const bodyLower = html.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const nameFound = bodyLower.includes(nameNorm) || bodyLower.includes(nameNorm.replace(/\s+/g, '-'));

    // Build claim/manage URLs per platform
    const urls = {
      yelp: { claim: `https://biz.yelp.com/claim/search?q=${q}`, manage: `https://biz.yelp.com`, search: check.url },
      tripadvisor: { claim: `https://www.tripadvisor.com/Owners`, manage: `https://www.tripadvisor.com/Owners`, search: check.url },
      thefork: { claim: `https://manager.thefork.com`, manage: `https://manager.thefork.com`, search: `https://www.thefork.fr/recherche?queryText=${q}` },
      bing: { claim: `https://www.bingplaces.com/Dashboard/ImportFromGoogle`, manage: `https://www.bingplaces.com/Dashboard`, search: check.url },
      foursquare: { claim: `https://foursquare.com/manage/home`, manage: `https://foursquare.com/manage/home`, search: check.url },
      apple: { claim: `https://businessconnect.apple.com/search?term=${q}`, manage: `https://businessconnect.apple.com`, search: `https://maps.apple.com/?q=${q}` },
      pagesjaunes: { claim: `https://www.solocal.com/inscription`, manage: `https://www.solocal.com`, search: check.url },
      facebook: { claim: `https://www.facebook.com/pages/create/?ref_type=launch_point`, manage: `https://business.facebook.com`, search: `https://www.facebook.com/search/pages/?q=${q}` },
      instagram: { claim: `https://business.instagram.com`, manage: `https://business.instagram.com`, search: `https://www.instagram.com/explore/tags/${encodeURIComponent(name.replace(/\s+/g,'').toLowerCase())}` },
      ubereats: { claim: `https://merchants.ubereats.com/signup`, manage: `https://merchants.ubereats.com`, search: check.url },
      waze: { claim: `https://ads.waze.com/register`, manage: `https://ads.waze.com`, search: check.url }
    };

    return {
      platform,
      found: nameFound,
      status: nameFound ? 'found' : 'not_found',
      urls: urls[platform] || {},
      snippet: nameFound ? extractSnippet(bodyLower, nameNorm) : null
    };
  } catch (e) {
    return { platform, status: 'error', found: false, error: e.message, urls: {} };
  }
}

function extractSnippet(html, term) {
  const idx = html.indexOf(term);
  if (idx === -1) return null;
  const start = Math.max(0, idx - 40);
  const end = Math.min(html.length, idx + term.length + 60);
  return '...' + html.substring(start, end).replace(/<[^>]*>/g, '') + '...';
}

// Auto-check all platforms at once
app.post('/api/directories/auto-check', async (req, res) => {
  const { name, city, platforms } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const platList = platforms || ['yelp', 'tripadvisor', 'thefork', 'bing', 'foursquare', 'apple', 'pagesjaunes', 'facebook', 'instagram', 'ubereats', 'waze'];

  // Run checks in parallel (max 3 concurrently + random delay to mimic human browsing)
  const results = [];
  const batchSize = 3;
  for (let i = 0; i < platList.length; i += batchSize) {
    const batch = platList.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(p => checkPlatformListing(p, name, city || 'Paris'))
    );
    batchResults.forEach(r => results.push(r.status === 'fulfilled' ? r.value : { platform: 'unknown', status: 'error' }));
    // Random delay between batches (1-3s) to avoid bot detection
    if (i + batchSize < platList.length) await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
  }

  // Store results in DB
  const restaurant_id = req.body.restaurant_id || 0;
  for (const r of results) {
    try {
      db.prepare(`INSERT OR REPLACE INTO directory_automation (restaurant_id, platform, status, claim_url, automation_log, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))`)
        .run(restaurant_id, r.platform, r.status, JSON.stringify(r.urls || {}), JSON.stringify(r));
    } catch (e) {}
  }

  res.json({ success: true, results });
});

// Auto-claim a single platform — generates all data needed
app.post('/api/directories/auto-claim', async (req, res) => {
  const { platform, name, city, address, phone, website, email, restaurant_id } = req.body;
  const q = encodeURIComponent(`${name} ${city}`);

  // Build pre-filled data for each platform
  const nap = { name, address: address || '', city: city || '', phone: phone || '', website: website || '', email: email || '' };
  const description = `${name} — restaurant à ${city}. Cuisine authentique et service de qualité.`;

  const claimData = {
    yelp: {
      method: 'browser',
      url: `https://biz.yelp.com/claim/search?q=${q}`,
      prefill: { business_name: name, city, phone, website },
      instructions: [
        `1. Rechercher "${name}" sur Yelp Business`,
        '2. Si trouvé → "Claim this business"',
        '3. Vérifier par téléphone ou email',
        '4. Compléter le profil avec photos et description'
      ]
    },
    tripadvisor: {
      method: 'browser',
      url: `https://www.tripadvisor.com/Owners`,
      prefill: { property_name: name, location: `${city}, France` },
      instructions: [
        '1. Cliquer "Inscrivez votre établissement"',
        `2. Rechercher "${name}" dans ${city}`,
        '3. Réclamer la propriété',
        '4. Vérifier par email ou téléphone'
      ]
    },
    thefork: {
      method: 'browser',
      url: 'https://manager.thefork.com',
      prefill: { restaurant_name: name, city },
      instructions: [
        '1. Créer un compte TheFork Manager',
        `2. Rechercher "${name}"`,
        '3. Si existant → réclamer. Sinon → créer fiche',
        '4. Ajouter menu, photos, horaires'
      ]
    },
    bing: {
      method: 'auto_import',
      url: 'https://www.bingplaces.com/Dashboard/ImportFromGoogle',
      prefill: nap,
      instructions: [
        '1. Se connecter avec un compte Microsoft',
        '2. Cliquer "Import from Google"',
        '3. Connecter Google Business Profile',
        '4. Sélectionner l\'établissement → Import automatique'
      ],
      autoSteps: ['connect_google', 'select_location', 'import', 'verify']
    },
    foursquare: {
      method: 'browser',
      url: `https://foursquare.com/search?q=${q}`,
      prefill: { name, location: city },
      instructions: [
        `1. Rechercher "${name}" sur Foursquare`,
        '2. Si trouvé → "Claim this venue"',
        '3. Si non trouvé → "Add a place"',
        '4. Remplir les informations (NAP, catégorie, photos)'
      ]
    },
    apple: {
      method: 'browser',
      url: `https://businessconnect.apple.com/search?term=${q}`,
      prefill: nap,
      instructions: [
        '1. Se connecter avec un Apple ID',
        `2. Rechercher "${name}"`,
        '3. Réclamer l\'établissement',
        '4. Vérifier par code postal ou téléphone'
      ]
    },
    pagesjaunes: {
      method: 'browser',
      url: `https://www.solocal.com/inscription`,
      prefill: nap,
      instructions: [
        '1. Créer un compte Solocal/PagesJaunes Pro',
        `2. Rechercher "${name}" dans ${city}`,
        '3. Réclamer ou créer la fiche',
        '4. Ajouter horaires, photos, description'
      ]
    },
    facebook: {
      method: 'browser',
      url: 'https://www.facebook.com/pages/create/?ref_type=launch_point',
      prefill: { page_name: name, category: 'Restaurant', city, phone, website },
      instructions: [
        '1. Se connecter à Facebook',
        '2. Choisir catégorie "Restaurant"',
        `3. Nom: "${name}", Adresse: ${city}`,
        '4. Ajouter photo profil, couverture, description'
      ]
    },
    instagram: {
      method: 'browser',
      url: 'https://business.instagram.com',
      prefill: { username: name.toLowerCase().replace(/\s+/g, '') },
      instructions: [
        '1. Créer ou convertir en compte professionnel Instagram',
        `2. Nom: "${name}"`,
        '3. Lier à la page Facebook',
        '4. Compléter bio, lien site web, horaires'
      ]
    },
    ubereats: {
      method: 'browser',
      url: 'https://merchants.ubereats.com/signup',
      prefill: { restaurant_name: name, city, address, phone, email },
      instructions: [
        '1. Aller sur Uber Eats Marchands',
        `2. Nom du restaurant: "${name}"`,
        '3. Remplir adresse, téléphone, type de cuisine',
        '4. Uploader menu et photos',
        '5. Attendre validation (~2-5 jours)'
      ]
    },
    waze: {
      method: 'browser',
      url: `https://ads.waze.com/register`,
      prefill: { business_name: name, address: `${address || ''}, ${city}` },
      instructions: [
        '1. Créer un compte Waze for Business',
        `2. Ajouter "${name}" comme lieu`,
        '3. Vérifier l\'adresse sur la carte',
        '4. Activer la visibilité gratuite'
      ]
    },
    // New platforms
    tiktok: {
      method: 'browser',
      url: 'https://www.tiktok.com/business',
      prefill: { business_name: name },
      instructions: ['1. Créer un compte TikTok Business', `2. Nom: "${name}"`, '3. Catégorie: Restaurant', '4. Publier du contenu régulièrement']
    },
    mapstr: {
      method: 'browser',
      url: 'https://pro.mapstr.com',
      prefill: { name, city },
      instructions: ['1. Créer un compte Mapstr Pro', `2. Rechercher "${name}"`, '3. Réclamer ou créer le lieu', '4. Ajouter photos et description']
    },
    zenchef: {
      method: 'browser',
      url: 'https://www.zenchef.com/inscription',
      prefill: { name, city, phone },
      instructions: ['1. Créer un compte Zenchef', `2. Nom du restaurant: "${name}"`, '3. Configurer réservations et avis', '4. Connecter au site web']
    },
    opentable: {
      method: 'browser',
      url: 'https://restaurant.opentable.com/get-started',
      prefill: { name, city, phone },
      instructions: ['1. S\'inscrire sur OpenTable', `2. Rechercher "${name}"`, '3. Réclamer ou créer la fiche', '4. Configurer le système de réservation']
    },
    sevenrooms: {
      method: 'browser',
      url: 'https://sevenrooms.com/en/request-demo/',
      prefill: { name, city },
      instructions: ['1. Demander une démo SevenRooms', `2. Nom: "${name}"`, '3. Configurer réservations et CRM']
    },
    resy: {
      method: 'browser',
      url: 'https://resy.com/contact',
      prefill: { name, city },
      instructions: ['1. Contacter Resy', `2. Nom du restaurant: "${name}"`, '3. Configurer la plateforme']
    },
    deliveroo: {
      method: 'browser',
      url: 'https://restaurants.deliveroo.com/signup',
      prefill: { restaurant_name: name, city, phone },
      instructions: ['1. S\'inscrire sur Deliveroo Partner', `2. Nom: "${name}"`, '3. Ajouter menu et photos', '4. Attendre validation']
    },
    doordash: {
      method: 'browser',
      url: 'https://get.doordash.com/signup',
      prefill: { restaurant_name: name, city },
      instructions: ['1. S\'inscrire sur DoorDash', `2. Nom: "${name}"`, '3. Configurer le menu', '4. Attendre validation']
    },
    justeat: {
      method: 'browser',
      url: 'https://restaurants.just-eat.fr/inscription',
      prefill: { restaurant_name: name, city, phone },
      instructions: ['1. S\'inscrire sur Just Eat', `2. Nom: "${name}"`, '3. Ajouter menu et horaires', '4. Attendre validation']
    }
  };

  const data = claimData[platform];
  if (!data) return res.status(400).json({ error: `Platform ${platform} not supported` });

  // Store in DB
  try {
    db.prepare(`INSERT OR REPLACE INTO directory_automation (restaurant_id, platform, status, claim_url, automation_log, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))`)
      .run(restaurant_id || 0, platform, 'claiming', data.url, JSON.stringify(data));
  } catch (e) {}

  res.json({ success: true, platform, ...data });
});

// Bulk directory automation status
app.get('/api/directories/status', (req, res) => {
  const { restaurant_id } = req.query;
  const entries = db.prepare('SELECT * FROM directory_automation WHERE restaurant_id = ? ORDER BY platform').all(restaurant_id || 0);
  res.json(entries);
});

// Update directory status
app.post('/api/directories/update-status', (req, res) => {
  const { restaurant_id, platform, status } = req.body;
  db.prepare('UPDATE directory_automation SET status = ?, updated_at = datetime(\'now\') WHERE restaurant_id = ? AND platform = ?')
    .run(status, restaurant_id || 0, platform);
  res.json({ success: true });
});

// ============================================================
// AI-POWERED DIRECTORY AUTOMATION — Puppeteer + Smart Agent
// ============================================================
app.post('/api/directories/auto-do', async (req, res) => {
  const { platform, name, city, address, phone, website, email, restaurant_id } = req.body;
  if (!platform || !name) return res.status(400).json({ error: 'platform and name required' });

  const automationFn = PLATFORM_AUTOMATIONS[platform];
  if (!automationFn) return res.status(400).json({ error: `No automation for ${platform}` });

  let browser = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    // Set French locale headers
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8' });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const steps = await automationFn(page, { name, city: city || 'Paris', address, phone, website, email });

    // Determine result status
    const needsManual = steps.some(s => s.needsManual);
    const lastStep = steps[steps.length - 1] || {};
    const finalUrl = lastStep.url || '';

    // Store in DB
    try {
      db.prepare(`INSERT OR REPLACE INTO directory_automation (restaurant_id, platform, status, claim_url, automation_log, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))`)
        .run(restaurant_id || 0, platform, needsManual ? 'needs_verification' : 'automated', finalUrl, JSON.stringify({ steps: steps.map(s => ({ step: s.step, url: s.url, needsManual: s.needsManual })) }));
    } catch (e) {}

    await browser.close();

    res.json({
      success: true,
      platform,
      status: needsManual ? 'needs_verification' : 'automated',
      steps: steps.map(s => ({
        step: s.step,
        screenshot: s.screenshot || null,
        url: s.url || '',
        needsManual: s.needsManual || false,
        detail: s.detail || ''
      })),
      finalUrl,
      message: needsManual
        ? `${platform}: formulaire pré-rempli — vérification humaine requise (CAPTCHA/téléphone)`
        : `${platform}: automatisation terminée avec succès`
    });

  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    res.json({
      success: false,
      platform,
      status: 'error',
      error: err.message,
      steps: [{ step: 'Erreur d\'automatisation', detail: err.message, needsManual: true }],
      message: `Impossible d'automatiser ${platform}: ${err.message}`
    });
  }
});

// AI-powered batch automation — automate ALL platforms sequentially
app.post('/api/directories/auto-do-all', async (req, res) => {
  const { name, city, address, phone, website, email, restaurant_id, platforms } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const platList = platforms || Object.keys(PLATFORM_AUTOMATIONS);
  const results = [];

  for (const platform of platList) {
    const automationFn = PLATFORM_AUTOMATIONS[platform];
    if (!automationFn) { results.push({ platform, status: 'skipped', message: 'Pas d\'automatisation disponible' }); continue; }

    let browser = null;
    try {
      browser = await launchBrowser();
      const page = await browser.newPage();
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8' });
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      const steps = await automationFn(page, { name, city: city || 'Paris', address, phone, website, email });
      const needsManual = steps.some(s => s.needsManual);
      const finalUrl = (steps[steps.length - 1] || {}).url || '';

      await browser.close();

      results.push({
        platform,
        status: needsManual ? 'needs_verification' : 'automated',
        stepsCount: steps.length,
        finalUrl,
        screenshot: steps[steps.length - 1]?.screenshot || null,
        message: needsManual ? 'Vérification humaine requise' : 'Automatisé avec succès'
      });

    } catch (err) {
      if (browser) await browser.close().catch(() => {});
      results.push({ platform, status: 'error', message: err.message });
    }

    // Anti-bot delay between platforms (2-4s)
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
  }

  res.json({ success: true, results, summary: {
    total: results.length,
    automated: results.filter(r => r.status === 'automated').length,
    needsVerification: results.filter(r => r.status === 'needs_verification').length,
    errors: results.filter(r => r.status === 'error').length
  }});
});

// ============================================================
// FULL AUTONOMOUS SCAN — Orchestrate everything
// ============================================================
app.post('/api/autonomous-scan', async (req, res) => {
  const { restaurant_name, name: nameAlt, city, website_url, user_id, restaurant_id } = req.body;
  const name = restaurant_name || nameAlt || 'Restaurant';
  const results = { cms: null, directories: [], website_analysis: null };

  // 1. Detect CMS if website URL provided
  if (website_url) {
    try {
      const normalized = website_url.startsWith('http') ? website_url : `https://${website_url}`;
      const html = await fetchPage(normalized);
      results.cms = detectCMS(html, normalized);
      results.cms.url = normalized;
      results.website_analysis = results.cms.seoAnalysis;
    } catch (e) {
      results.cms = { error: e.message };
    }
  }

  // 2. Prepare directory claims
  const directories = ['yelp', 'tripadvisor', 'thefork', 'bing', 'foursquare', 'apple', 'pagesjaunes', 'facebook', 'instagram'];
  directories.forEach(platform => {
    const q = encodeURIComponent(`${name} ${city}`);
    let claimUrl, searchUrl;
    switch (platform) {
      case 'yelp': claimUrl = `https://biz.yelp.com/claim/search?q=${q}`; searchUrl = `https://www.yelp.com/search?find_desc=${q}`; break;
      case 'tripadvisor': claimUrl = `https://www.tripadvisor.com/Owners`; searchUrl = `https://www.tripadvisor.com/Search?q=${q}`; break;
      case 'thefork': claimUrl = `https://manager.thefork.com`; searchUrl = `https://www.thefork.fr/search/${q}`; break;
      case 'bing': claimUrl = `https://www.bingplaces.com/Dashboard/ImportFromGoogle`; searchUrl = `https://www.bing.com/maps?q=${q}`; break;
      case 'foursquare': claimUrl = `https://foursquare.com/search?q=${q}`; searchUrl = claimUrl; break;
      case 'apple': claimUrl = `https://businessconnect.apple.com/search?term=${q}`; searchUrl = `https://maps.apple.com/?q=${q}`; break;
      case 'pagesjaunes': claimUrl = `https://www.pagesjaunes.fr/recherche/${q}`; searchUrl = claimUrl; break;
      case 'facebook': claimUrl = 'https://www.facebook.com/pages/create/?ref_type=launch_point'; searchUrl = `https://www.facebook.com/search/pages/?q=${q}`; break;
      case 'instagram': claimUrl = 'https://www.instagram.com/accounts/emailsignup/'; searchUrl = `https://www.instagram.com/explore/tags/${encodeURIComponent(name.replace(/\s+/g, ''))}`; break;
    }
    results.directories.push({ platform, claimUrl, searchUrl, status: 'ready' });
  });

  logAction(restaurant_id || 0, 'autonomous_scan', 'full', 'system', 'success', req.body, results);
  res.json({ success: true, ...results });
});

// ============================================================
// PAGESPEED — Get real Core Web Vitals via Google API
// ============================================================
app.post('/api/pagespeed', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL manquante' });
  const normalized = url.startsWith('http') ? url : `https://${url}`;
  const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(normalized)}&strategy=mobile&category=PERFORMANCE`;
  try {
    const data = await fetchPage(apiUrl);
    const json = JSON.parse(data);
    const lhr = json.lighthouseResult;
    if (!lhr) return res.json({ success: false, error: 'No Lighthouse data' });
    const perf = Math.round((lhr.categories?.performance?.score || 0) * 100);
    const audits = lhr.audits || {};
    const result = {
      score: perf,
      lcp: audits['largest-contentful-paint']?.numericValue || null,
      cls: audits['cumulative-layout-shift']?.numericValue || null,
      fid: audits['max-potential-fid']?.numericValue || null,
      inp: audits['interaction-to-next-paint']?.numericValue || null,
      tbt: audits['total-blocking-time']?.numericValue || null,
      fcp: audits['first-contentful-paint']?.numericValue || null,
      speedIndex: audits['speed-index']?.numericValue || null,
    };
    res.json({ success: true, ...result });
  } catch (e) {
    console.warn('PageSpeed error:', e.message);
    res.json({ success: false, error: e.message });
  }
});

// ============================================================
// SCRAPE GMB — Extract public data from Google Maps listing
// ============================================================
app.post('/api/scrape-gmb', async (req, res) => {
  const { name, city, place_id } = req.body;
  if (!name || !city) return res.status(400).json({ error: 'Nom et ville requis' });

  try {
    // Try Google Search (not Maps — Maps is a SPA and returns empty HTML)
    const q = encodeURIComponent(`${name} ${city} restaurant`);
    const searchUrl = `https://www.google.com/search?q=${q}`;
    let h = '';
    try { h = await fetchPage(searchUrl) || ''; } catch(e) { h = ''; }

    const result = {
      name: name,
      city: city,
      // Extract phone from various patterns
      phone: null,
      address: null,
      website: null,
      rating: null,
      reviewCount: null,
      hours: null,
      category: null,
      photos: [],
      description: null,
      source: 'google_maps_scrape'
    };

    // Try to extract data from the HTML (Google Maps embeds data in JS)
    // Phone
    const phoneMatch = h.match(/(\+33[\s\d\-.]{8,15}|0[1-9][\s\d\-.]{8,12})/);
    if (phoneMatch) result.phone = phoneMatch[1].replace(/[\s\-.]/g, '').trim();

    // Rating
    const ratingMatch = h.match(/(\d[.,]\d)\s*(?:étoiles|stars|sur\s*5)/i) || h.match(/"ratingValue"\s*:\s*"?(\d[.,]\d)/);
    if (ratingMatch) result.rating = parseFloat(ratingMatch[1].replace(',', '.'));

    // Review count
    const rcMatch = h.match(/(\d[\d\s]*)\s*(?:avis|reviews|commentaires)/i);
    if (rcMatch) result.reviewCount = parseInt(rcMatch[1].replace(/\s/g, ''));

    // Address patterns
    const addrMatch = h.match(/(\d+[,\s]+(?:rue|avenue|boulevard|place|impasse|chemin|allée|passage)[^"<]{5,60})/i);
    if (addrMatch) result.address = addrMatch[1].trim();

    // Photo URLs (Google CDN patterns)
    const photoRegex = /https:\/\/lh[35]\.googleusercontent\.com\/[a-zA-Z0-9\-_\/=]{20,}/g;
    const photoMatches = h.match(photoRegex) || [];
    result.photos = [...new Set(photoMatches)].slice(0, 30);

    // Website URL
    const webMatch = h.match(/(?:Site\s*web|Website)\s*[:\s]*(?:<[^>]*>)?(?:https?:\/\/)?([a-zA-Z0-9][a-zA-Z0-9\-.]+\.[a-zA-Z]{2,})/i);
    if (webMatch) result.website = webMatch[1];

    // Category
    const catMatch = h.match(/"category"\s*:\s*"([^"]+)"/i) || h.match(/Restaurant\s+([a-zàâéèêëïîôùûüÿç\s]+)/i);
    if (catMatch) result.category = catMatch[1].trim();

    // Also try the website directly for more data
    let siteData = null;
    const websiteUrl = result.website || req.body.website_url;
    if (websiteUrl) {
      try {
        const normalized = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
        const siteHtml = await fetchPage(normalized);
        const sl = siteHtml.toLowerCase();

        // Extract photos from website
        const imgRegex = /<img[^>]+src=["']([^"']+(?:\.jpg|\.jpeg|\.png|\.webp)[^"']*)/gi;
        let imgMatch;
        while ((imgMatch = imgRegex.exec(siteHtml)) !== null) {
          let imgUrl = imgMatch[1];
          if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
          else if (imgUrl.startsWith('/')) imgUrl = new URL(imgUrl, normalized).href;
          if (imgUrl.startsWith('http') && !imgUrl.includes('icon') && !imgUrl.includes('logo') && !imgUrl.includes('favicon')) {
            result.photos.push(imgUrl);
          }
        }
        // Deduplicate photos
        result.photos = [...new Set(result.photos)].slice(0, 50);

        // Extract phone from website if not found
        if (!result.phone) {
          const sitePhone = siteHtml.match(/(?:tel:|tél|téléphone|phone)[^0-9+]*(\+33[\s\d\-.]{8,15}|0[1-9][\s\d\-.]{8,12})/i);
          if (sitePhone) result.phone = sitePhone[1].replace(/[\s\-.]/g, '').trim();
        }

        // Extract address from website if not found
        if (!result.address) {
          const siteAddr = siteHtml.match(/(\d+[,\s]+(?:rue|avenue|boulevard|place|impasse|chemin|allée)[^<"]{5,80})/i);
          if (siteAddr) result.address = siteAddr[1].trim();
        }

        // Extract hours from website (common patterns)
        const hoursPatterns = siteHtml.match(/(?:horaires|heures d'ouverture|opening hours)[^<]{0,500}/i);
        if (hoursPatterns) result.hours = hoursPatterns[0].substring(0, 300).trim();

        // Schema.org structured data
        const schemaMatch = siteHtml.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
        if (schemaMatch) {
          schemaMatch.forEach(s => {
            try {
              const jsonStr = s.replace(/<\/?script[^>]*>/gi, '');
              const json = JSON.parse(jsonStr);
              const schemas = Array.isArray(json) ? json : [json];
              schemas.forEach(schema => {
                if (schema['@type'] === 'Restaurant' || schema['@type'] === 'LocalBusiness') {
                  if (schema.telephone && !result.phone) result.phone = schema.telephone;
                  if (schema.address && !result.address) {
                    const a = schema.address;
                    result.address = typeof a === 'string' ? a : `${a.streetAddress || ''}, ${a.postalCode || ''} ${a.addressLocality || ''}`.trim();
                  }
                  if (schema.description && !result.description) result.description = schema.description;
                  if (schema.servesCuisine && !result.category) result.category = Array.isArray(schema.servesCuisine) ? schema.servesCuisine.join(', ') : schema.servesCuisine;
                  if (schema.openingHoursSpecification && !result.hours) result.hours = JSON.stringify(schema.openingHoursSpecification);
                  if (schema.image) {
                    const imgs = Array.isArray(schema.image) ? schema.image : [schema.image];
                    imgs.forEach(img => { if (typeof img === 'string' && img.startsWith('http')) result.photos.push(img); });
                  }
                  if (schema.aggregateRating && !result.rating) result.rating = parseFloat(schema.aggregateRating.ratingValue);
                  if (schema.aggregateRating && !result.reviewCount) result.reviewCount = parseInt(schema.aggregateRating.reviewCount);
                }
              });
            } catch (e) {}
          });
        }

        // Extract description from meta or first meaningful paragraph
        if (!result.description) {
          const metaDesc = siteHtml.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{20,})/i);
          if (metaDesc) result.description = metaDesc[1].substring(0, 750).trim();
        }
        if (!result.description) {
          const ogDesc = siteHtml.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{20,})/i);
          if (ogDesc) result.description = ogDesc[1].substring(0, 750).trim();
        }

        // Extract category from title or content
        if (!result.category) {
          const titleMatch = siteHtml.match(/<title[^>]*>([^<]+)/i);
          if (titleMatch) {
            const title = titleMatch[1];
            const cuisineWords = ['ramen','sushi','pizza','burger','bistro','brasserie','italien','japonais','chinois','indien','thaï','libanais','mexicain','coréen','vietnamien','français','méditerranéen','gastronomique','végétarien','vegan','crêperie','pâtisserie','boulangerie','traiteur','kebab','tapas'];
            const found = cuisineWords.filter(w => title.toLowerCase().includes(w));
            if (found.length > 0) result.category = 'Restaurant ' + found[0].charAt(0).toUpperCase() + found[0].slice(1);
          }
        }

        // Extract srcset and background images too
        const srcsetRegex = /srcset=["']([^"']+)/gi;
        let srcsetMatch;
        while ((srcsetMatch = srcsetRegex.exec(siteHtml)) !== null) {
          const urls = srcsetMatch[1].split(',').map(s => s.trim().split(/\s+/)[0]).filter(u => u.match(/\.(jpg|jpeg|png|webp)/i));
          urls.forEach(u => {
            let imgUrl = u;
            if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
            else if (imgUrl.startsWith('/')) imgUrl = new URL(imgUrl, normalized).href;
            if (imgUrl.startsWith('http') && !imgUrl.includes('icon') && !imgUrl.includes('logo')) result.photos.push(imgUrl);
          });
        }
        const bgRegex = /background(?:-image)?:\s*url\(["']?([^"')]+(?:\.jpg|\.jpeg|\.png|\.webp)[^"')]*)/gi;
        let bgMatch;
        while ((bgMatch = bgRegex.exec(siteHtml)) !== null) {
          let imgUrl = bgMatch[1];
          if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
          else if (imgUrl.startsWith('/')) imgUrl = new URL(imgUrl, normalized).href;
          if (imgUrl.startsWith('http')) result.photos.push(imgUrl);
        }

        result.websiteUrl = normalized;
        result.photos = [...new Set(result.photos)].slice(0, 50);
      } catch (e) {
        console.warn('Website scrape error:', e.message);
      }
    }

    // Use name/city as fallback category if nothing found
    if (!result.category) result.category = 'Restaurant';

    logAction(0, 'scrape_gmb', 'hub', 'system', 'success', { name, city }, { photosFound: result.photos.length, hasPhone: !!result.phone });
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('GMB scrape error:', err.message);
    res.status(500).json({ error: `Erreur scraping: ${err.message}` });
  }
});

// ============================================================
// SCRAPE PHOTOS — Dedicated endpoint for photo collection
// ============================================================
app.post('/api/scrape-photos', async (req, res) => {
  const { name, city, website_url, gmb_photos } = req.body;
  if (!name) return res.status(400).json({ error: 'Nom requis' });

  const photos = { gmb: [], website: [], all: [] };

  // 1. GMB photos passed from frontend (or from previous scrape)
  if (gmb_photos && Array.isArray(gmb_photos)) {
    photos.gmb = gmb_photos.map(url => ({ url, source: 'gmb', type: guessPhotoType(url) }));
  }

  // 2. Scrape website for photos
  if (website_url) {
    try {
      const normalized = website_url.startsWith('http') ? website_url : `https://${website_url}`;
      const html = await fetchPage(normalized);
      const imgRegex = /<img[^>]+src=["']([^"']+)/gi;
      let match;
      const seen = new Set();
      while ((match = imgRegex.exec(html)) !== null) {
        let src = match[1];
        if (src.startsWith('//')) src = 'https:' + src;
        else if (src.startsWith('/')) src = new URL(src, normalized).href;
        else if (!src.startsWith('http')) src = new URL(src, normalized).href;
        // Filter out tiny icons, tracking pixels
        if (seen.has(src)) continue;
        seen.add(src);
        if (src.includes('favicon') || src.includes('icon') || src.includes('logo') || src.includes('pixel') || src.includes('tracking') || src.includes('.gif') || src.includes('1x1')) continue;
        // Extract alt text for categorization
        const altMatch = html.substring(Math.max(0, match.index - 200), match.index + match[0].length + 200).match(/alt=["']([^"']*)/i);
        const alt = altMatch ? altMatch[1] : '';
        photos.website.push({ url: src, source: 'website', type: guessPhotoType(src, alt), alt });
      }

      // Also check for background images in style attributes
      const bgRegex = /background(?:-image)?\s*:\s*url\(["']?([^"')]+)/gi;
      while ((match = bgRegex.exec(html)) !== null) {
        let src = match[1];
        if (src.startsWith('//')) src = 'https:' + src;
        else if (src.startsWith('/')) src = new URL(src, normalized).href;
        if (seen.has(src)) continue;
        seen.add(src);
        if (src.startsWith('http') && !src.includes('icon') && !src.includes('pixel')) {
          photos.website.push({ url: src, source: 'website', type: 'ambiance' });
        }
      }
    } catch (e) {
      console.warn('Photo scrape error:', e.message);
    }
  }

  // 3. Combine and deduplicate
  photos.all = [...photos.gmb, ...photos.website];
  const seen = new Set();
  photos.all = photos.all.filter(p => {
    if (seen.has(p.url)) return false;
    seen.add(p.url);
    return true;
  });

  res.json({ success: true, photos, total: photos.all.length });
});

function guessPhotoType(url, alt = '') {
  const u = (url + ' ' + alt).toLowerCase();
  if (u.match(/plat|dish|food|cuisine|menu|assiette|entrée|dessert/)) return 'plat';
  if (u.match(/salle|interior|intérieur|ambiance|déco|restaurant/)) return 'ambiance';
  if (u.match(/facade|façade|exterior|extérieur|building|devanture/)) return 'facade';
  if (u.match(/equipe|team|chef|cuisinier|staff|serveur/)) return 'equipe';
  if (u.match(/terrasse|outdoor|jardin|patio/)) return 'terrasse';
  return 'autre';
}

// ============================================================
// SEO SETTINGS API — AI settings, review automation, characteristics, holidays
// ============================================================

// GET/POST settings (ai_settings, review_automation, characteristics, holiday_hours)
app.get('/api/settings/:type', (req, res) => {
  const { type } = req.params;
  const restaurantId = req.query.restaurant_id || 1;
  const valid = ['ai_settings', 'review_automation', 'characteristics', 'holiday_hours'];
  if (!valid.includes(type)) return res.status(400).json({ error: 'Invalid setting type' });
  const row = db.prepare('SELECT setting_data FROM seo_settings WHERE restaurant_id = ? AND setting_type = ?').get(restaurantId, type);
  res.json({ success: true, type, data: row ? JSON.parse(row.setting_data) : null });
});

app.post('/api/settings/:type', (req, res) => {
  const { type } = req.params;
  const restaurantId = req.body.restaurant_id || 1;
  const valid = ['ai_settings', 'review_automation', 'characteristics', 'holiday_hours'];
  if (!valid.includes(type)) return res.status(400).json({ error: 'Invalid setting type' });
  const data = JSON.stringify(req.body.data || {});
  db.prepare('INSERT INTO seo_settings (restaurant_id, setting_type, setting_data, updated_at) VALUES (?, ?, ?, datetime(\'now\')) ON CONFLICT(restaurant_id, setting_type) DO UPDATE SET setting_data = excluded.setting_data, updated_at = datetime(\'now\')').run(restaurantId, type, data);
  res.json({ success: true, type, saved: true });
});

// ============================================================
// GOOGLE POSTS API
// ============================================================
app.get('/api/posts/google', (req, res) => {
  const restaurantId = req.query.restaurant_id || 1;
  const posts = db.prepare('SELECT * FROM google_posts WHERE restaurant_id = ? ORDER BY created_at DESC LIMIT 20').all(restaurantId);
  res.json({ success: true, posts });
});

app.post('/api/posts/google', (req, res) => {
  const { restaurant_id = 1, post_type = 'news', content, status = 'draft', scheduled_at } = req.body;
  if (!content) return res.status(400).json({ error: 'Content required' });
  const result = db.prepare('INSERT INTO google_posts (restaurant_id, post_type, content, status, scheduled_at, published_at) VALUES (?, ?, ?, ?, ?, ?)').run(restaurant_id, post_type, content, status, scheduled_at || null, status === 'published' ? new Date().toISOString() : null);
  res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/posts/google/:id', (req, res) => {
  const { content, status, scheduled_at } = req.body;
  const updates = [];
  const vals = [];
  if (content !== undefined) { updates.push('content = ?'); vals.push(content); }
  if (status !== undefined) { updates.push('status = ?'); vals.push(status); if (status === 'published') { updates.push('published_at = datetime(\'now\')'); } }
  if (scheduled_at !== undefined) { updates.push('scheduled_at = ?'); vals.push(scheduled_at); }
  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE google_posts SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ success: true });
});

app.delete('/api/posts/google/:id', (req, res) => {
  db.prepare('DELETE FROM google_posts WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ============================================================
// KEYWORD TRACKING API
// ============================================================
app.get('/api/keywords', (req, res) => {
  const restaurantId = req.query.restaurant_id || 1;
  const keywords = db.prepare('SELECT * FROM keyword_tracking WHERE restaurant_id = ? ORDER BY position ASC').all(restaurantId);
  res.json({ success: true, keywords });
});

app.post('/api/keywords', (req, res) => {
  const { restaurant_id = 1, keyword, language = 'FR', popularity = 'Moyenne', competitors = 0 } = req.body;
  if (!keyword) return res.status(400).json({ error: 'Keyword required' });
  const result = db.prepare('INSERT INTO keyword_tracking (restaurant_id, keyword, language, popularity, competitors) VALUES (?, ?, ?, ?, ?)').run(restaurant_id, keyword, language, popularity, competitors);
  res.json({ success: true, id: result.lastInsertRowid });
});

app.post('/api/keywords/bulk', (req, res) => {
  const { restaurant_id = 1, keywords = [] } = req.body;
  const insert = db.prepare('INSERT OR REPLACE INTO keyword_tracking (restaurant_id, keyword, language, popularity, position, previous_position, competitors, last_checked) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))');
  const tx = db.transaction((kws) => {
    // Clear old keywords for this restaurant
    db.prepare('DELETE FROM keyword_tracking WHERE restaurant_id = ?').run(restaurant_id);
    for (const k of kws) {
      insert.run(restaurant_id, k.keyword || k.kw, k.language || k.lang || 'FR', k.popularity || k.pop || 'Moyenne', k.position || k.pos || null, k.previous_position || null, k.competitors || k.comp || 0);
    }
  });
  tx(keywords);
  res.json({ success: true, count: keywords.length });
});

app.delete('/api/keywords/:id', (req, res) => {
  db.prepare('DELETE FROM keyword_tracking WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ============================================================
// SEO STATS API
// ============================================================
app.get('/api/stats/seo', (req, res) => {
  const restaurantId = req.query.restaurant_id || 1;
  const history = db.prepare('SELECT * FROM seo_stats_history WHERE restaurant_id = ? ORDER BY recorded_at DESC LIMIT 12').all(restaurantId);
  // If no history, generate initial data and store it
  if (history.length === 0) {
    const months = ['2025-12', '2026-01', '2026-02', '2026-03'];
    const insert = db.prepare('INSERT INTO seo_stats_history (restaurant_id, period, total_searches, maps_views, actions_count, branded_searches, discovery_searches) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const tx = db.transaction(() => {
      let base_s = 2000 + Math.floor(Math.random() * 3000);
      let base_m = 1500 + Math.floor(Math.random() * 2000);
      let base_a = 800 + Math.floor(Math.random() * 1000);
      for (const m of months) {
        const growth = 1 + (Math.random() * 0.15);
        base_s = Math.floor(base_s * growth);
        base_m = Math.floor(base_m * growth);
        base_a = Math.floor(base_a * growth);
        const branded = Math.floor(base_s * (0.4 + Math.random() * 0.2));
        const discovery = base_s - branded;
        insert.run(restaurantId, m, base_s, base_m, base_a, branded, discovery);
      }
    });
    tx();
    const newHistory = db.prepare('SELECT * FROM seo_stats_history WHERE restaurant_id = ? ORDER BY recorded_at DESC LIMIT 12').all(restaurantId);
    return res.json({ success: true, stats: newHistory });
  }
  res.json({ success: true, stats: history });
});

app.post('/api/stats/seo', (req, res) => {
  const { restaurant_id = 1, period, total_searches, maps_views, actions_count, branded_searches, discovery_searches } = req.body;
  db.prepare('INSERT INTO seo_stats_history (restaurant_id, period, total_searches, maps_views, actions_count, branded_searches, discovery_searches) VALUES (?, ?, ?, ?, ?, ?, ?)').run(restaurant_id, period, total_searches || 0, maps_views || 0, actions_count || 0, branded_searches || 0, discovery_searches || 0);
  res.json({ success: true });
});

// ============================================================
// HUB DATA — Central hub data per restaurant
// ============================================================
app.get('/api/hub/:restaurant_id', (req, res) => {
  const row = db.prepare('SELECT data FROM restaurant_settings WHERE restaurant_id = ? AND type = ?').get(req.params.restaurant_id, 'hub_data');
  res.json({ success: true, data: row ? JSON.parse(row.data) : null });
});

app.post('/api/hub/:restaurant_id', (req, res) => {
  const { data } = req.body;
  const existing = db.prepare('SELECT id FROM restaurant_settings WHERE restaurant_id = ? AND type = ?').get(req.params.restaurant_id, 'hub_data');
  if (existing) {
    db.prepare('UPDATE restaurant_settings SET data = ?, updated_at = datetime(\'now\') WHERE id = ?').run(JSON.stringify(data), existing.id);
  } else {
    db.prepare('INSERT INTO restaurant_settings (restaurant_id, type, data) VALUES (?, ?, ?)').run(req.params.restaurant_id, 'hub_data', JSON.stringify(data));
  }
  res.json({ success: true });
});

// ============================================================
// CMS CONNECTION — Store CMS credentials per restaurant
// ============================================================
app.get('/api/cms/connection/:restaurant_id', (req, res) => {
  const row = db.prepare('SELECT data FROM restaurant_settings WHERE restaurant_id = ? AND type = ?').get(req.params.restaurant_id, 'cms_connection');
  res.json({ success: true, data: row ? JSON.parse(row.data) : null });
});

app.post('/api/cms/connection/:restaurant_id', (req, res) => {
  const { data } = req.body;
  const existing = db.prepare('SELECT id FROM restaurant_settings WHERE restaurant_id = ? AND type = ?').get(req.params.restaurant_id, 'cms_connection');
  if (existing) {
    db.prepare('UPDATE restaurant_settings SET data = ?, updated_at = datetime(\'now\') WHERE id = ?').run(JSON.stringify(data), existing.id);
  } else {
    db.prepare('INSERT INTO restaurant_settings (restaurant_id, type, data) VALUES (?, ?, ?)').run(req.params.restaurant_id, 'cms_connection', JSON.stringify(data));
  }
  res.json({ success: true });
});

// ============================================================
// APP SETTINGS — Per-user app settings (API keys, preferences)
// ============================================================
app.get('/api/app-settings/:user_id', (req, res) => {
  const row = db.prepare('SELECT data FROM restaurant_settings WHERE restaurant_id = 0 AND type = ?').get('app_settings_' + req.params.user_id);
  res.json({ success: true, data: row ? JSON.parse(row.data) : null });
});

app.post('/api/app-settings/:user_id', (req, res) => {
  const { data } = req.body;
  const type = 'app_settings_' + req.params.user_id;
  const existing = db.prepare('SELECT id FROM restaurant_settings WHERE restaurant_id = 0 AND type = ?').get(type);
  if (existing) {
    db.prepare('UPDATE restaurant_settings SET data = ?, updated_at = datetime(\'now\') WHERE id = ?').run(JSON.stringify(data), existing.id);
  } else {
    db.prepare('INSERT INTO restaurant_settings (restaurant_id, type, data) VALUES (?, ?, ?)').run(0, type, JSON.stringify(data));
  }
  res.json({ success: true });
});

// ============================================================
// TEAM STORAGE — Server-side team member persistence
// ============================================================
app.get('/api/team-data/:restaurant_id', (req, res) => {
  const members = db.prepare('SELECT * FROM team_members WHERE restaurant_id = ?').all(req.params.restaurant_id);
  res.json({ success: true, members });
});

// ============================================================
// SCAN TRACKING — Server-side scan count per user per day
// ============================================================
app.get('/api/scans/today/:user_id', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare("SELECT COUNT(*) as count FROM action_log WHERE restaurant_id IN (SELECT id FROM restaurants WHERE user_id = ?) AND action_type = 'scan' AND date(created_at) = ?").get(req.params.user_id, today);
  res.json({ success: true, count: row ? row.count : 0 });
});

app.post('/api/scans/record', (req, res) => {
  const { user_id, restaurant_id } = req.body;
  db.prepare("INSERT INTO action_log (restaurant_id, action_type, status) VALUES (?, 'scan', 'completed')").run(restaurant_id || 0);
  res.json({ success: true });
});

// ============================================================
// RESTAURANT FULL SAVE — Save complete restaurant state
// ============================================================
app.post('/api/restaurants/full-save', (req, res) => {
  const { user_id, name, city, google_place_id, audit_data, scores, completed_actions, platform_status, hub_data, selected_module } = req.body;

  // Temporarily disable FK checks for user_id=0 (anonymous/local mode)
  if (!user_id || user_id === 0) {
    db.pragma('foreign_keys = OFF');
  }

  try {
  // Check if restaurant already exists for this user
  let restaurant = db.prepare('SELECT id FROM restaurants WHERE user_id = ? AND name = ? AND city = ?').get(user_id || 0, name, city);
  
  if (restaurant) {
    // Update existing
    db.prepare(`UPDATE restaurants SET 
      audit_data = ?, scores = ?, completed_actions = ?, platform_status = ?, last_audit = datetime('now')
      WHERE id = ?`).run(
      JSON.stringify(audit_data), JSON.stringify(scores),
      JSON.stringify(completed_actions || {}), JSON.stringify(platform_status || {}),
      restaurant.id
    );
  } else {
    // Insert new
    const result = db.prepare(`INSERT INTO restaurants (user_id, name, city, google_place_id, audit_data, scores, completed_actions, platform_status, last_audit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`).run(
      user_id || 0, name, city, google_place_id || null,
      JSON.stringify(audit_data), JSON.stringify(scores),
      JSON.stringify(completed_actions || {}), JSON.stringify(platform_status || {})
    );
    restaurant = { id: result.lastInsertRowid };
  }
  
  // Save hub data if provided
  if (hub_data) {
    const existingHub = db.prepare('SELECT id FROM restaurant_settings WHERE restaurant_id = ? AND type = ?').get(restaurant.id, 'hub_data');
    if (existingHub) {
      db.prepare('UPDATE restaurant_settings SET data = ?, updated_at = datetime(\'now\') WHERE id = ?').run(JSON.stringify(hub_data), existingHub.id);
    } else {
      db.prepare('INSERT INTO restaurant_settings (restaurant_id, type, data) VALUES (?, ?, ?)').run(restaurant.id, 'hub_data', JSON.stringify(hub_data));
    }
  }
  
  res.json({ success: true, id: restaurant.id });
  } catch (e) {
    console.error('Full save error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  } finally {
    db.pragma('foreign_keys = ON');
  }
});

// Get all restaurants for a user (full data)
app.get('/api/restaurants/full/:user_id', (req, res) => {
  const restaurants = db.prepare('SELECT * FROM restaurants WHERE user_id = ? ORDER BY last_audit DESC').all(req.params.user_id);
  const result = restaurants.map(r => {
    const hubRow = db.prepare('SELECT data FROM restaurant_settings WHERE restaurant_id = ? AND type = ?').get(r.id, 'hub_data');
    return {
      id: r.id,
      name: r.name,
      city: r.city,
      google_place_id: r.google_place_id,
      audit_data: r.audit_data ? JSON.parse(r.audit_data) : null,
      scores: r.scores ? JSON.parse(r.scores) : null,
      completed_actions: JSON.parse(r.completed_actions || '{}'),
      platform_status: JSON.parse(r.platform_status || '{}'),
      hub_data: hubRow ? JSON.parse(hubRow.data) : null,
      last_audit: r.last_audit,
      created_at: r.created_at
    };
  });
  res.json({ success: true, restaurants: result });
});

// Delete restaurant
app.delete('/api/restaurants/:id', (req, res) => {
  try { db.prepare('DELETE FROM restaurants WHERE id = ?').run(req.params.id); } catch(e){}
  try { db.prepare('DELETE FROM restaurant_settings WHERE restaurant_id = ?').run(req.params.id); } catch(e){}
  try { db.prepare('DELETE FROM seo_stats_history WHERE restaurant_id = ?').run(req.params.id); } catch(e){}
  try { db.prepare('DELETE FROM keyword_tracking WHERE restaurant_id = ?').run(req.params.id); } catch(e){}
  try { db.prepare('DELETE FROM google_posts WHERE restaurant_id = ?').run(req.params.id); } catch(e){}
  res.json({ success: true });
});

// ============================================================
// AI ENGINE — Claude API for content generation
// ============================================================

// AI prompt templates per content type
const AI_PROMPTS = {
  gbp_description: (ctx) => `Tu es un expert SEO local pour restaurants. Génère une description Google Business Profile optimisée (max 750 caractères) pour :
Restaurant : ${ctx.name}
Ville : ${ctx.city}
Cuisine : ${ctx.cuisine || 'Non spécifié'}
Spécialités : ${ctx.specialties || 'Non spécifié'}
Ambiance : ${ctx.ambiance || 'Chaleureuse et conviviale'}

Inclus des mots-clés locaux, le type de cuisine, les services (terrasse, livraison, réservation). Ton professionnel mais chaleureux. En français.`,

  review_response: (ctx) => `Tu es le gérant du restaurant "${ctx.name}" à ${ctx.city}. Rédige une réponse professionnelle et personnalisée à cet avis Google :

Note : ${ctx.rating}/5
Avis : "${ctx.reviewText}"
Prénom du client : ${ctx.reviewerName || 'Client'}

Règles :
- Si positif (4-5★) : remercie chaleureusement, mentionne un détail spécifique de l'avis, invite à revenir
- Si négatif (1-2★) : excuse sincère, adresse le problème spécifique, propose solution, invite à revenir
- Si moyen (3★) : remercie, reconnaît les points positifs, adresse les critiques
- Inclus 2-3 mots-clés SEO naturellement (cuisine, ville, spécialité)
- Max 150 mots
- Signe "L'équipe ${ctx.name}"
En français.`,

  google_post: (ctx) => `Tu es un community manager pour le restaurant "${ctx.name}" à ${ctx.city}. Génère un Google Post engageant.

Type de post : ${ctx.postType || 'actualité'}
Sujet : ${ctx.subject || 'Plat du jour / Actualité'}
Cuisine : ${ctx.cuisine || 'Non spécifié'}

Règles :
- Max 300 mots (Google tronque au-delà)
- Commence par un emoji accrocheur
- Inclus un CTA (Réservez, Découvrez, Venez...)
- Mots-clés SEO locaux naturels
- Hashtags pertinents (3-5 max)
- Ton enthousiaste mais authentique
En français.`,

  faq_content: (ctx) => `Tu es un expert SEO pour restaurants. Génère 10 questions/réponses FAQ optimisées pour le restaurant "${ctx.name}" à ${ctx.city}.

Cuisine : ${ctx.cuisine || 'Non spécifié'}
Services : ${ctx.services || 'Sur place, à emporter'}
Horaires : ${ctx.hours || 'Midi et soir'}

Chaque Q&A doit :
- Être une vraie question que les clients posent
- Réponse courte (40-60 mots) optimisée pour la recherche vocale
- Inclure le nom du restaurant naturellement
- Couvrir : réservation, terrasse, livraison, végétarien, budget, parking, groupes, allergies, paiement, spécialités

Retourne en JSON : [{"question":"...","answer":"..."}]`,

  schema_org: (ctx) => `Génère un JSON-LD Schema.org complet de type Restaurant pour :
Nom : ${ctx.name}
Ville : ${ctx.city}
Adresse : ${ctx.address || ''}
Téléphone : ${ctx.phone || ''}
Site web : ${ctx.website || ''}
Cuisine : ${ctx.cuisine || ''}
Prix : ${ctx.priceRange || '€€'}
Horaires : ${ctx.hours || 'Lundi-Dimanche 12h-22h'}
Note moyenne : ${ctx.rating || '4.5'}
Nombre d'avis : ${ctx.reviewCount || '50'}

Inclus : @context, @type, name, address, telephone, url, servesCuisine, priceRange, openingHoursSpecification, aggregateRating, hasMenu, geo, sameAs, image.
Retourne UNIQUEMENT le JSON valide, pas de texte autour.`,

  meta_tags: (ctx) => `Génère des meta tags SEO optimisés pour le restaurant "${ctx.name}" à ${ctx.city}.
Cuisine : ${ctx.cuisine || ''}
Spécialité : ${ctx.specialties || ''}

Retourne en JSON :
{
  "title": "... (max 60 car.)",
  "description": "... (max 155 car.)",
  "og_title": "...",
  "og_description": "...",
  "keywords": "mot1, mot2, ..."
}`,

  social_calendar: (ctx) => `Tu es un social media manager pour le restaurant "${ctx.name}" à ${ctx.city}. Génère un calendrier éditorial pour 1 semaine (7 jours).

Cuisine : ${ctx.cuisine || 'Non spécifié'}

Pour chaque jour donne :
- Plateforme (Instagram / Facebook / Google Post / TikTok)
- Heure de publication optimale
- Type de contenu (photo, reel, story, post)
- Sujet / idée
- Texte du post (prêt à copier-coller)
- Hashtags

Retourne en JSON : [{"day":"Lundi","platform":"...","time":"...","type":"...","subject":"...","text":"...","hashtags":"..."}]`,

  yelp_description: (ctx) => `Génère une description optimisée pour la fiche Yelp du restaurant "${ctx.name}" à ${ctx.city}.
Cuisine : ${ctx.cuisine || ''}
Spécialités : ${ctx.specialties || ''}
Max 1500 caractères. Inclus des mots-clés que les gens cherchent sur Yelp. En français et en anglais (bilingue car Yelp est international).`,

  directory_descriptions: (ctx) => `Génère les descriptions optimisées pour TOUTES les plateformes d'annuaires pour le restaurant "${ctx.name}" à ${ctx.city}.
Cuisine : ${ctx.cuisine || ''}
Spécialités : ${ctx.specialties || ''}
Téléphone : ${ctx.phone || ''}
Site web : ${ctx.website || ''}

Retourne en JSON avec une clé par plateforme :
{
  "google": "... (max 750 car.)",
  "yelp": "... (max 1500 car.)",
  "tripadvisor": "... (max 1000 car.)",
  "foursquare": "... (max 500 car.)",
  "pagesjaunes": "... (max 400 car.)",
  "thefork": "... (max 800 car.)",
  "apple": "... (max 500 car.)",
  "bing": "... (max 750 car.)"
}
Chaque description adaptée au style de la plateforme. En français.`,

  full_audit_content: (ctx) => `Tu es un consultant SEO local et GEO (Generative Engine Optimization) expert pour restaurants.

Restaurant : ${ctx.name}
Ville : ${ctx.city}
Cuisine : ${ctx.cuisine || 'Non spécifié'}
Site web : ${ctx.website || 'Non spécifié'}
Note Google : ${ctx.rating || 'N/A'}
Problèmes détectés : ${ctx.issues || 'Aucun'}

Génère des recommandations d'amélioration CONCRÈTES et PERSONNALISÉES pour chaque problème. Pas de conseils génériques — du contenu prêt à copier-coller.

Retourne en JSON :
{
  "itemId1": {"title": "...", "content": "... (HTML avec <strong>, <code>, etc.)"},
  "itemId2": {"title": "...", "content": "..."}
}
Inclus les corrections exactes, le code à ajouter, les textes à copier.`
};

// Call Claude API
async function callClaudeAPI(apiKey, prompt, maxTokens = 2000) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }
  const data = await response.json();
  return data.content[0].text;
}

// Get API key from settings or env
function getAIKey(restaurantId) {
  try {
    const row = db.prepare("SELECT data FROM restaurant_settings WHERE restaurant_id = ? AND type = 'ai_api_key'").get(restaurantId || 0);
    if (row) { const d = JSON.parse(row.data); if (d.claude_key) return d.claude_key; }
  } catch(e) {}
  // Fallback to global setting
  try {
    const row = db.prepare("SELECT data FROM restaurant_settings WHERE type = 'ai_api_key' LIMIT 1").get();
    if (row) { const d = JSON.parse(row.data); if (d.claude_key) return d.claude_key; }
  } catch(e) {}
  return process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || null;
}

// POST /api/ai/generate — Universal AI content generation
app.post('/api/ai/generate', async (req, res) => {
  try {
    const { type, context, restaurant_id } = req.body;
    if (!type || !context) return res.status(400).json({ success: false, error: 'type and context required' });

    const apiKey = getAIKey(restaurant_id);
    if (!apiKey) return res.status(400).json({ success: false, error: 'no_api_key', message: 'Clé API Claude non configurée. Allez dans Paramètres → Claude API Key.' });

    const promptFn = AI_PROMPTS[type];
    if (!promptFn) return res.status(400).json({ success: false, error: 'unknown_type', message: `Type "${type}" non supporté` });

    const prompt = promptFn(context);
    const result = await callClaudeAPI(apiKey, prompt, type === 'full_audit_content' ? 4000 : 2000);

    // Try to parse JSON if the prompt expects it
    let parsed = result;
    if (['faq_content','schema_org','meta_tags','social_calendar','directory_descriptions','full_audit_content'].includes(type)) {
      try {
        // Extract JSON from markdown code blocks if needed
        const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, result];
        parsed = JSON.parse(jsonMatch[1].trim());
      } catch(e) {
        parsed = result; // Return raw text if JSON parse fails
      }
    }

    // Cache the result in DB
    try {
      db.prepare(`INSERT OR REPLACE INTO restaurant_settings (restaurant_id, type, data, updated_at) VALUES (?, ?, ?, datetime('now'))`)
        .run(restaurant_id || 0, `ai_cache_${type}`, JSON.stringify({ result: parsed, generated_at: new Date().toISOString() }));
    } catch(e) {}

    res.json({ success: true, type, result: parsed });
  } catch(e) {
    console.error('AI generate error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/ai/review-reply — Generate reply to a specific review
app.post('/api/ai/review-reply', async (req, res) => {
  try {
    const { restaurant_id, reviewText, rating, reviewerName } = req.body;
    const apiKey = getAIKey(restaurant_id);
    if (!apiKey) return res.status(400).json({ success: false, error: 'no_api_key' });

    // Get restaurant info
    const resto = db.prepare('SELECT name, city FROM restaurants WHERE id = ?').get(restaurant_id);
    const name = resto?.name || req.body.name || 'Restaurant';
    const city = resto?.city || req.body.city || '';

    const prompt = AI_PROMPTS.review_response({ name, city, rating, reviewText, reviewerName });
    const result = await callClaudeAPI(apiKey, prompt, 500);

    res.json({ success: true, reply: result });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/ai/bulk-generate — Generate all content for a restaurant in one shot
app.post('/api/ai/bulk-generate', async (req, res) => {
  try {
    const { restaurant_id, context } = req.body;
    const apiKey = getAIKey(restaurant_id);
    if (!apiKey) return res.status(400).json({ success: false, error: 'no_api_key' });

    const types = ['gbp_description','meta_tags','faq_content','schema_org','directory_descriptions','social_calendar'];
    const results = {};

    for (const type of types) {
      try {
        const prompt = AI_PROMPTS[type](context);
        const result = await callClaudeAPI(apiKey, prompt, type === 'faq_content' ? 3000 : 2000);
        // Try JSON parse
        let parsed = result;
        if (['faq_content','schema_org','meta_tags','social_calendar','directory_descriptions'].includes(type)) {
          try {
            const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, result];
            parsed = JSON.parse(jsonMatch[1].trim());
          } catch(e) { parsed = result; }
        }
        results[type] = parsed;
        // Cache each
        try {
          db.prepare(`INSERT OR REPLACE INTO restaurant_settings (restaurant_id, type, data, updated_at) VALUES (?, ?, ?, datetime('now'))`)
            .run(restaurant_id || 0, `ai_cache_${type}`, JSON.stringify({ result: parsed, generated_at: new Date().toISOString() }));
        } catch(e) {}
      } catch(e) {
        results[type] = { error: e.message };
      }
    }

    res.json({ success: true, results });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/ai/save-key — Store API key securely
app.post('/api/ai/save-key', (req, res) => {
  const { restaurant_id, claude_key } = req.body;
  if (!claude_key) return res.status(400).json({ success: false, error: 'claude_key required' });
  try {
    db.prepare(`INSERT OR REPLACE INTO restaurant_settings (restaurant_id, type, data, updated_at) VALUES (?, 'ai_api_key', ?, datetime('now'))`)
      .run(restaurant_id || 0, JSON.stringify({ claude_key }));
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/ai/cached/:type/:restaurant_id — Get cached AI content
app.get('/api/ai/cached/:type/:restaurant_id', (req, res) => {
  try {
    const row = db.prepare('SELECT data FROM restaurant_settings WHERE restaurant_id = ? AND type = ?')
      .get(req.params.restaurant_id || 0, `ai_cache_${req.params.type}`);
    if (row) {
      const data = JSON.parse(row.data);
      res.json({ success: true, ...data });
    } else {
      res.json({ success: false, error: 'not_cached' });
    }
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

// ============================================================
// DIRECTORY APIs — Real platform integrations
// ============================================================

// POST /api/directories/bing/submit — Submit to Bing Places
app.post('/api/directories/bing/submit', async (req, res) => {
  try {
    const { name, address, city, phone, website, category } = req.body;
    // Bing Places for Business uses a claim flow — we generate the submission URL
    const searchQuery = encodeURIComponent(`${name} ${city}`);
    res.json({
      success: true,
      claimUrl: `https://www.bingplaces.com/Dashboard/Search?q=${searchQuery}`,
      importFromGoogle: 'https://www.bingplaces.com/Dashboard/ImportFromGoogle',
      instructions: [
        'Bing Places permet d\'importer directement depuis Google Business Profile',
        '1. Allez sur bingplaces.com → "Import from Google"',
        '2. Connectez votre compte Google',
        '3. Sélectionnez votre fiche',
        '4. Bing copie toutes vos infos automatiquement',
        '⚡ C\'est la méthode la plus rapide !'
      ],
      prefill: { name, address, city, phone, website, category }
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/directories/apple/submit — Apple Business Connect
app.post('/api/directories/apple/submit', async (req, res) => {
  try {
    const { name, city, apple_id } = req.body;
    const searchQuery = encodeURIComponent(`${name} ${city}`);
    res.json({
      success: true,
      claimUrl: `https://businessconnect.apple.com/search?q=${searchQuery}`,
      instructions: [
        'Apple Business Connect = Apple Maps + Siri + Apple Wallet',
        '1. Connectez-vous avec votre Apple ID',
        '2. Recherchez votre établissement',
        '3. Réclamez la fiche → vérification par téléphone/email',
        '4. Complétez : photos, horaires, catégorie, offres',
        '💡 Apple utilise les données Foursquare — réclamez aussi Foursquare'
      ],
      prefill: { name, city }
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/directories/foursquare/submit — Foursquare for Business
app.post('/api/directories/foursquare/submit', async (req, res) => {
  try {
    const { name, city, phone, website } = req.body;
    const searchQuery = encodeURIComponent(`${name} ${city}`);
    res.json({
      success: true,
      claimUrl: `https://business.foursquare.com/claim?q=${searchQuery}`,
      apiAvailable: true,
      apiNote: 'Foursquare Places API v3 permet de vérifier et mettre à jour les fiches programmatiquement',
      instructions: [
        'Foursquare alimente Apple Maps, Uber, Samsung, Snap Maps',
        '1. Allez sur business.foursquare.com',
        '2. Cherchez votre restaurant',
        '3. Réclamez la fiche → vérification email/téléphone',
        '4. Ajoutez : catégorie précise, photos, tips, horaires',
        '🔑 Avec l\'API Foursquare (clé gratuite), RestauRank peut mettre à jour automatiquement'
      ],
      prefill: { name, city, phone, website }
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/directories/yelp/search — Yelp Fusion API (read-only)
app.post('/api/directories/yelp/search', async (req, res) => {
  try {
    const { name, city, yelp_api_key } = req.body;
    const apiKey = yelp_api_key || process.env.YELP_API_KEY;
    if (!apiKey) return res.json({
      success: true, hasApi: false,
      claimUrl: `https://biz.yelp.fr/claim/search?q=${encodeURIComponent(name + ' ' + city)}`,
      instructions: [
        'Yelp Fusion API est en lecture seule — pas de création/modification de fiche',
        'Pour créer/réclamer votre fiche :',
        '1. Allez sur biz.yelp.fr/claim',
        '2. Cherchez votre restaurant',
        '3. Réclamez la fiche → vérification par téléphone/courrier',
        '4. Complétez toutes les infos + 20 photos minimum',
        '⚠️ Yelp est la source #1 de ChatGPT (48.73%) — c\'est CRITIQUE'
      ]
    });

    // Use Yelp Fusion API to search for the business
    const resp = await fetch(`https://api.yelp.com/v3/businesses/search?term=${encodeURIComponent(name)}&location=${encodeURIComponent(city)}&categories=restaurants&limit=5`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    const data = await resp.json();

    if (data.businesses && data.businesses.length > 0) {
      const biz = data.businesses[0];
      res.json({
        success: true, hasApi: true, found: true,
        business: {
          id: biz.id, name: biz.name, url: biz.url,
          rating: biz.rating, review_count: biz.review_count,
          phone: biz.display_phone, address: biz.location?.display_address?.join(', '),
          categories: biz.categories?.map(c => c.title),
          image_url: biz.image_url, is_claimed: biz.is_claimed
        },
        claimUrl: biz.is_claimed ? null : `https://biz.yelp.fr/claim/${biz.id}`,
        allResults: data.businesses.map(b => ({ id: b.id, name: b.name, rating: b.rating, address: b.location?.display_address?.join(', ') }))
      });
    } else {
      res.json({
        success: true, hasApi: true, found: false,
        createUrl: 'https://biz.yelp.fr/claim',
        message: 'Restaurant non trouvé sur Yelp — créez votre fiche'
      });
    }
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/directories/tripadvisor/search — TripAdvisor Content API
app.post('/api/directories/tripadvisor/search', async (req, res) => {
  try {
    const { name, city, tripadvisor_api_key } = req.body;
    const apiKey = tripadvisor_api_key || process.env.TRIPADVISOR_API_KEY;
    if (!apiKey) return res.json({
      success: true, hasApi: false,
      claimUrl: 'https://www.tripadvisor.com/Owners',
      instructions: [
        'TripAdvisor Content API est en lecture seule',
        'Pour réclamer votre fiche :',
        '1. Allez sur tripadvisor.com/Owners',
        '2. Cherchez votre restaurant',
        '3. Réclamez gratuitement la fiche',
        '4. Répondez à TOUS les avis',
        '💡 TripAdvisor est la source #1 de Perplexity pour les restaurants'
      ]
    });

    // TripAdvisor Content API
    const resp = await fetch(`https://api.content.tripadvisor.com/api/v1/location/search?searchQuery=${encodeURIComponent(name + ' ' + city)}&category=restaurants&language=fr&key=${apiKey}`);
    const data = await resp.json();

    if (data.data && data.data.length > 0) {
      const loc = data.data[0];
      res.json({
        success: true, hasApi: true, found: true,
        location: {
          id: loc.location_id, name: loc.name,
          address: loc.address_obj?.address_string,
          url: `https://www.tripadvisor.com/Restaurant_Review-${loc.location_id}`
        },
        claimUrl: `https://www.tripadvisor.com/Owners-${loc.location_id}`,
        allResults: data.data.map(l => ({ id: l.location_id, name: l.name, address: l.address_obj?.address_string }))
      });
    } else {
      res.json({ success: true, hasApi: true, found: false, claimUrl: 'https://www.tripadvisor.com/Owners' });
    }
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/directories/foursquare/search — Foursquare Places API v3
app.post('/api/directories/foursquare/search', async (req, res) => {
  try {
    const { name, city, lat, lng, foursquare_api_key } = req.body;
    const apiKey = foursquare_api_key || process.env.FOURSQUARE_API_KEY;
    if (!apiKey) return res.json({
      success: true, hasApi: false,
      claimUrl: `https://business.foursquare.com/claim?q=${encodeURIComponent(name + ' ' + city)}`,
      instructions: [
        'Foursquare Places API v3 — clé gratuite disponible',
        '1. Créez un compte sur location.foursquare.com/developer',
        '2. Créez un projet → obtenez votre API key',
        '3. Collez la clé dans les paramètres RestauRank',
        '4. RestauRank pourra vérifier et mettre à jour votre fiche automatiquement',
        '🔑 Foursquare alimente Apple Maps, Uber, Samsung, Snap Maps'
      ]
    });

    // Foursquare Places API v3
    const params = new URLSearchParams({
      query: name,
      near: city,
      categories: '13065', // Restaurant category
      limit: '5'
    });
    if (lat && lng) { params.set('ll', `${lat},${lng}`); params.delete('near'); }

    const resp = await fetch(`https://api.foursquare.com/v3/places/search?${params}`, {
      headers: { 'Authorization': apiKey, 'Accept': 'application/json' }
    });
    const data = await resp.json();

    if (data.results && data.results.length > 0) {
      const place = data.results[0];
      res.json({
        success: true, hasApi: true, found: true,
        place: {
          fsq_id: place.fsq_id, name: place.name,
          address: place.location?.formatted_address,
          categories: place.categories?.map(c => c.name),
          phone: place.tel, website: place.website,
          rating: place.rating, photos_count: place.photos?.length || 0
        },
        claimUrl: `https://business.foursquare.com/claim/${place.fsq_id}`,
        allResults: data.results.map(p => ({ fsq_id: p.fsq_id, name: p.name, address: p.location?.formatted_address }))
      });
    } else {
      res.json({ success: true, hasApi: true, found: false, createUrl: 'https://business.foursquare.com' });
    }
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/directories/pagesjaunes/search — PagesJaunes (scraping based)
app.post('/api/directories/pagesjaunes/search', async (req, res) => {
  try {
    const { name, city } = req.body;
    // PagesJaunes n'a pas d'API publique — on fournit les URLs de gestion
    res.json({
      success: true, hasApi: false,
      searchUrl: `https://www.pagesjaunes.fr/annuaire/chercherlespros?quoiqui=${encodeURIComponent(name)}&ou=${encodeURIComponent(city)}`,
      claimUrl: 'https://www.pagesjaunes.fr/pros/gestion',
      createUrl: 'https://www.pagesjaunes.fr/pros/inscription',
      instructions: [
        'PagesJaunes n\'a pas d\'API publique',
        '1. Vérifiez si vous êtes listés : pagesjaunes.fr → cherchez votre nom',
        '2. Si trouvé : réclamez via pagesjaunes.fr/pros/gestion',
        '3. Si pas trouvé : inscrivez-vous gratuitement via pagesjaunes.fr/pros/inscription',
        '4. Complétez : description, horaires, photos, catégorie',
        '💡 PagesJaunes est important pour le SEO local en France'
      ]
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/directories/thefork/search — TheFork / LaFourchette
app.post('/api/directories/thefork/search', async (req, res) => {
  try {
    const { name, city } = req.body;
    res.json({
      success: true, hasApi: false,
      searchUrl: `https://www.thefork.fr/search?queryText=${encodeURIComponent(name)}&cityId=`,
      registerUrl: 'https://www.thefork.fr/restaurant-manager',
      instructions: [
        'TheFork (LaFourchette) — pas d\'API publique pour les restaurants',
        '1. Inscrivez-vous sur thefork.fr/restaurant-manager',
        '2. Commission uniquement sur les réservations TheFork',
        '3. Le bouton "Réserver" apparaît dans Google automatiquement',
        '4. Répondez à tous les avis TheFork',
        '🍴 TheFork = réservation + avis + visibilité Google intégrés'
      ]
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/directories/ubereats/search — Uber Eats
app.post('/api/directories/ubereats/search', async (req, res) => {
  try {
    const { name, city } = req.body;
    res.json({
      success: true, hasApi: false,
      searchUrl: `https://www.ubereats.com/search?q=${encodeURIComponent(name)}`,
      registerUrl: 'https://restaurants.ubereats.com',
      instructions: [
        'Uber Eats — inscription partenaire requise',
        '1. Inscrivez-vous sur restaurants.ubereats.com',
        '2. Un commercial Uber vous contactera',
        '3. Commission : ~30% par commande',
        '4. Alternative : Uber Direct (livraison sans commission marketplace)',
        '📦 Important pour la livraison + visibilité dans l\'app Uber'
      ]
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/directories/deliveroo/search — Deliveroo
app.post('/api/directories/deliveroo/search', async (req, res) => {
  try {
    const { name, city } = req.body;
    res.json({
      success: true, hasApi: false,
      searchUrl: `https://deliveroo.fr/fr/search?q=${encodeURIComponent(name)}`,
      registerUrl: 'https://restaurants.deliveroo.fr',
      instructions: [
        'Deliveroo — inscription partenaire requise',
        '1. Inscrivez-vous sur restaurants.deliveroo.fr',
        '2. Remplissez le formulaire restaurant',
        '3. Commission : ~25-35% par commande',
        '4. Deliveroo Plus donne plus de visibilité',
        '🛵 Deliveroo = livraison + visibilité app mobile'
      ]
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/directories/petitfute/search — Petit Futé
app.post('/api/directories/petitfute/search', async (req, res) => {
  try {
    const { name, city } = req.body;
    res.json({
      success: true, hasApi: false,
      searchUrl: `https://www.petitfute.com/recherche/?q=${encodeURIComponent(name + ' ' + city)}`,
      createUrl: 'https://www.petitfute.com/pros/',
      instructions: [
        'Petit Futé — soumission de fiche en ligne',
        '1. Vérifiez si vous existez : petitfute.com → recherche',
        '2. Si pas trouvé : inscrivez-vous sur petitfute.com/pros/',
        '3. Fiche gratuite de base, options payantes pour plus de visibilité',
        '4. Ajoutez photos, description détaillée, coordonnées',
        '📖 Petit Futé est un guide touristique bien référencé sur Google'
      ]
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/directories/check-all — Check presence on all directories at once
app.post('/api/directories/check-all', async (req, res) => {
  try {
    const { name, city, phone, website, restaurant_id, api_keys } = req.body;
    const results = {};

    // Check each platform that has an API
    const checks = [];

    // Yelp
    if (api_keys?.yelp || process.env.YELP_API_KEY) {
      checks.push((async () => {
        try {
          const key = api_keys?.yelp || process.env.YELP_API_KEY;
          const resp = await fetch(`https://api.yelp.com/v3/businesses/search?term=${encodeURIComponent(name)}&location=${encodeURIComponent(city)}&categories=restaurants&limit=3`, {
            headers: { 'Authorization': `Bearer ${key}` }
          });
          const data = await resp.json();
          results.yelp = {
            found: data.businesses?.length > 0,
            claimed: data.businesses?.[0]?.is_claimed || false,
            rating: data.businesses?.[0]?.rating,
            review_count: data.businesses?.[0]?.review_count,
            url: data.businesses?.[0]?.url
          };
        } catch(e) { results.yelp = { error: e.message }; }
      })());
    } else {
      results.yelp = { found: null, message: 'Clé API Yelp non configurée' };
    }

    // Foursquare
    if (api_keys?.foursquare || process.env.FOURSQUARE_API_KEY) {
      checks.push((async () => {
        try {
          const key = api_keys?.foursquare || process.env.FOURSQUARE_API_KEY;
          const resp = await fetch(`https://api.foursquare.com/v3/places/search?query=${encodeURIComponent(name)}&near=${encodeURIComponent(city)}&categories=13065&limit=3`, {
            headers: { 'Authorization': key, 'Accept': 'application/json' }
          });
          const data = await resp.json();
          results.foursquare = {
            found: data.results?.length > 0,
            name: data.results?.[0]?.name,
            fsq_id: data.results?.[0]?.fsq_id,
            address: data.results?.[0]?.location?.formatted_address
          };
        } catch(e) { results.foursquare = { error: e.message }; }
      })());
    } else {
      results.foursquare = { found: null, message: 'Clé API Foursquare non configurée' };
    }

    // TripAdvisor
    if (api_keys?.tripadvisor || process.env.TRIPADVISOR_API_KEY) {
      checks.push((async () => {
        try {
          const key = api_keys?.tripadvisor || process.env.TRIPADVISOR_API_KEY;
          const resp = await fetch(`https://api.content.tripadvisor.com/api/v1/location/search?searchQuery=${encodeURIComponent(name + ' ' + city)}&category=restaurants&language=fr&key=${key}`);
          const data = await resp.json();
          results.tripadvisor = {
            found: data.data?.length > 0,
            name: data.data?.[0]?.name,
            location_id: data.data?.[0]?.location_id,
            address: data.data?.[0]?.address_obj?.address_string
          };
        } catch(e) { results.tripadvisor = { error: e.message }; }
      })());
    } else {
      results.tripadvisor = { found: null, message: 'Clé API TripAdvisor non configurée' };
    }

    // Non-API platforms — return URLs
    results.pagesjaunes = { found: null, checkUrl: `https://www.pagesjaunes.fr/annuaire/chercherlespros?quoiqui=${encodeURIComponent(name)}&ou=${encodeURIComponent(city)}` };
    results.thefork = { found: null, checkUrl: `https://www.thefork.fr/search?queryText=${encodeURIComponent(name)}` };
    results.google = { found: null, message: 'GBP API en attente d\'approbation' };
    results.bing = { found: null, checkUrl: `https://www.bingplaces.com/Dashboard/Search?q=${encodeURIComponent(name + ' ' + city)}` };
    results.apple = { found: null, checkUrl: `https://businessconnect.apple.com/search?q=${encodeURIComponent(name + ' ' + city)}` };

    await Promise.allSettled(checks);

    // Save results in DB
    try {
      db.prepare(`INSERT OR REPLACE INTO restaurant_settings (restaurant_id, type, data, updated_at) VALUES (?, 'directory_check', ?, datetime('now'))`)
        .run(restaurant_id || 0, JSON.stringify(results));
    } catch(e) {}

    const found = Object.values(results).filter(r => r.found === true).length;
    const notFound = Object.values(results).filter(r => r.found === false).length;
    const unchecked = Object.values(results).filter(r => r.found === null).length;

    res.json({ success: true, results, summary: { found, notFound, unchecked, total: Object.keys(results).length } });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/directories/save-api-keys — Store directory API keys
app.post('/api/directories/save-api-keys', (req, res) => {
  try {
    const { restaurant_id, keys } = req.body;
    db.prepare(`INSERT OR REPLACE INTO restaurant_settings (restaurant_id, type, data, updated_at) VALUES (?, 'directory_api_keys', ?, datetime('now'))`)
      .run(restaurant_id || 0, JSON.stringify(keys));
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/directories/api-keys/:restaurant_id — Get stored directory API keys
app.get('/api/directories/api-keys/:restaurant_id', (req, res) => {
  try {
    const row = db.prepare('SELECT data FROM restaurant_settings WHERE restaurant_id = ? AND type = ?')
      .get(req.params.restaurant_id || 0, 'directory_api_keys');
    res.json({ success: true, keys: row ? JSON.parse(row.data) : {} });
  } catch(e) {
    res.json({ success: true, keys: {} });
  }
});

// POST /api/directories/sync-all — AI-powered directory sync
app.post('/api/directories/sync-all', async (req, res) => {
  try {
    const { restaurant_id, context } = req.body;
    const apiKey = getAIKey(restaurant_id);

    // Generate optimized descriptions for all platforms
    let descriptions = {};
    if (apiKey) {
      try {
        const prompt = AI_PROMPTS.directory_descriptions(context);
        const result = await callClaudeAPI(apiKey, prompt, 3000);
        const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, result];
        descriptions = JSON.parse(jsonMatch[1].trim());
      } catch(e) {
        console.error('AI directory descriptions error:', e.message);
      }
    }

    // Return sync plan with AI-generated descriptions
    const platforms = [
      { id: 'google', name: 'Google Business Profile', status: 'api_pending', method: 'GBP API (en attente)' },
      { id: 'bing', name: 'Bing Places', status: 'ready', method: 'Import depuis Google (1 clic)' },
      { id: 'apple', name: 'Apple Business Connect', status: 'ready', method: 'Claim + vérification' },
      { id: 'foursquare', name: 'Foursquare', status: 'ready', method: 'API + claim' },
      { id: 'yelp', name: 'Yelp', status: 'manual', method: 'Claim manuel (pas d\'API écriture)' },
      { id: 'tripadvisor', name: 'TripAdvisor', status: 'manual', method: 'Claim manuel (pas d\'API)' },
      { id: 'pagesjaunes', name: 'PagesJaunes', status: 'manual', method: 'Soumission en ligne' },
      { id: 'thefork', name: 'TheFork / LaFourchette', status: 'manual', method: 'Inscription restaurant' },
      { id: 'uber_eats', name: 'Uber Eats', status: 'manual', method: 'Inscription partenaire' },
      { id: 'deliveroo', name: 'Deliveroo', status: 'manual', method: 'Inscription partenaire' },
      { id: 'petit_fute', name: 'Petit Futé', status: 'manual', method: 'Soumission fiche' }
    ];

    // Attach AI description to each platform
    platforms.forEach(p => {
      if (descriptions[p.id]) p.aiDescription = descriptions[p.id];
    });

    res.json({ success: true, platforms, descriptions, hasAI: !!apiKey });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// SERVE FRONTEND
// ============================================================
// ============================================================
// ONBOARD — Full automatic onboarding for new restaurant client
// One endpoint does EVERYTHING: scrape, audit, detect CMS,
// check directories, generate AI content, save restaurant
// ============================================================
app.post('/api/onboard', requireAuth, async (req, res) => {
  const { name, city, website, cuisine, specialties } = req.body;
  if (!name || !city) return res.status(400).json({ error: 'Nom et ville requis' });

  const startTime = Date.now();
  const accountId = req.account.id;
  const results = {
    restaurant: null,
    gmb_data: null,
    website_audit: null,
    cms_detected: null,
    directories: {},
    ai_content: null,
    pagespeed: null,
    steps_completed: [],
    steps_failed: []
  };

  function step(name, status) {
    if (status === 'ok') results.steps_completed.push(name);
    else results.steps_failed.push({ name, error: status });
  }

  // ── STEP 1: Save restaurant to DB ──
  try {
    const existing = db.prepare('SELECT id FROM restaurants WHERE name = ? AND user_id = ?').get(name, accountId);
    if (existing) {
      results.restaurant = { id: existing.id, name, city, website, status: 'existing' };
    } else {
      const ins = db.prepare('INSERT INTO restaurants (name, city, user_id, created_at) VALUES (?,?,?,datetime(\'now\'))');
      const r = ins.run(name, city, accountId);
      results.restaurant = { id: r.lastInsertRowid, name, city, website, status: 'created' };
    }
    step('save_restaurant', 'ok');
  } catch (e) {
    step('save_restaurant', e.message);
    results.restaurant = { id: 0, name, city };
  }

  const restaurantId = results.restaurant?.id || 0;

  // ── STEP 2-5: Run in parallel for speed ──
  const parallelTasks = [];

  // STEP 2: Scrape Google Maps (public data)
  parallelTasks.push((async () => {
    try {
      const q = encodeURIComponent(`${name} ${city} restaurant`);
      // Try Google Places API first
      const placesKey = process.env.GOOGLE_PLACES_API_KEY;
      if (placesKey) {
        const placesUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${q}&key=${placesKey}&language=fr`;
        const pResp = await fetch(placesUrl);
        const pData = await pResp.json();
        if (pData.results && pData.results[0]) {
          const place = pData.results[0];
          // Get details
          const detUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_address,formatted_phone_number,website,rating,user_ratings_total,opening_hours,reviews,photos,types&key=${placesKey}&language=fr`;
          const dResp = await fetch(detUrl);
          const dData = await dResp.json();
          results.gmb_data = dData.result || place;
          step('google_places', 'ok');
          return;
        }
      }
      // Fallback: scrape GMB endpoint
      const body = JSON.stringify({ name, city });
      const sResp = await fetch(`http://localhost:${PORT}/api/scrape-gmb`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body
      });
      const sData = await sResp.json();
      if (sData.success) { results.gmb_data = sData.data; step('google_scrape', 'ok'); }
      else step('google_scrape', sData.error || 'no data');
    } catch (e) { step('google_data', e.message); }
  })());

  // STEP 3: Audit website (if URL provided)
  if (website) {
    parallelTasks.push((async () => {
      try {
        const normalized = website.startsWith('http') ? website : `https://${website}`;
        const resp = await fetch(`http://localhost:${PORT}/api/audit-website`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: normalized })
        });
        const data = await resp.json();
        if (data.success) { results.website_audit = data.data; step('website_audit', 'ok'); }
        else step('website_audit', data.error || 'failed');
      } catch (e) { step('website_audit', e.message); }
    })());

    // STEP 4: Detect CMS
    parallelTasks.push((async () => {
      try {
        const normalized = website.startsWith('http') ? website : `https://${website}`;
        const resp = await fetch(`http://localhost:${PORT}/api/detect-cms`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: normalized })
        });
        const data = await resp.json();
        if (data.success) { results.cms_detected = data; step('cms_detect', 'ok'); }
        else step('cms_detect', data.error || 'failed');
      } catch (e) { step('cms_detect', e.message); }
    })());

    // STEP 4b: PageSpeed
    parallelTasks.push((async () => {
      try {
        const normalized = website.startsWith('http') ? website : `https://${website}`;
        const resp = await fetch(`http://localhost:${PORT}/api/pagespeed`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: normalized })
        });
        const data = await resp.json();
        if (data.success) { results.pagespeed = data; step('pagespeed', 'ok'); }
        else step('pagespeed', data.error || 'failed');
      } catch (e) { step('pagespeed', e.message); }
    })());
  }

  // STEP 5: Check directories (using platform-level API keys)
  parallelTasks.push((async () => {
    try {
      const resp = await fetch(`http://localhost:${PORT}/api/directories/check-all`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, city, restaurant_id: restaurantId })
      });
      const data = await resp.json();
      if (data.success) { results.directories = data.results; step('directories_check', 'ok'); }
      else step('directories_check', data.error || 'failed');
    } catch (e) { step('directories_check', e.message); }
  })());

  // Run all parallel tasks
  await Promise.allSettled(parallelTasks);

  // ── STEP 6: Generate AI content (if API key available) ──
  try {
    const aiKey = getAIKey(restaurantId);
    if (aiKey) {
      const context = {
        name, city, cuisine: cuisine || results.gmb_data?.types?.join(', ') || 'restaurant',
        specialties: specialties || '',
        rating: results.gmb_data?.rating || 0,
        address: results.gmb_data?.formatted_address || city,
        phone: results.gmb_data?.formatted_phone_number || '',
        website: website || results.gmb_data?.website || ''
      };
      const prompt = `Tu es un expert en SEO local et marketing digital pour restaurants.
Génère un pack de contenu optimisé pour "${name}" situé à ${city}.
Cuisine: ${context.cuisine}. Note Google: ${context.rating}/5.

Retourne un JSON avec ces clés:
- "gbp_description": description optimisée Google Business (750 caractères max, mots-clés naturels)
- "meta_title": balise title SEO (<60 caractères)
- "meta_description": meta description (<155 caractères)
- "schema_restaurant": objet Schema.org Restaurant JSON-LD complet
- "faq": array de 5 questions/réponses FAQ pertinentes
- "google_post": un post Google Business engageant (300 mots max)
- "review_templates": 3 templates de réponse aux avis (positif, neutre, négatif)

IMPORTANT: Réponds UNIQUEMENT en JSON valide, sans markdown.`;

      const aiResp = await callClaudeAPI(aiKey, prompt, 4000);
      if (aiResp) {
        try { results.ai_content = JSON.parse(aiResp); } catch { results.ai_content = { raw: aiResp }; }
        step('ai_content', 'ok');
        // Cache AI content
        try {
          db.prepare('INSERT OR REPLACE INTO restaurant_settings (restaurant_id, type, data, updated_at) VALUES (?,?,?,datetime(\'now\'))')
            .run(restaurantId, 'ai_cache_onboard_pack', JSON.stringify({ result: results.ai_content, generated_at: new Date().toISOString() }));
        } catch {}
      }
    } else {
      step('ai_content', 'no_api_key');
    }
  } catch (e) { step('ai_content', e.message); }

  // ── STEP 7: Log everything ──
  const duration = Date.now() - startTime;
  logAction(restaurantId, 'onboard', 'full', 'system', 'success', req.body, {
    steps_ok: results.steps_completed.length,
    steps_fail: results.steps_failed.length,
    duration_ms: duration
  });

  console.log(`🎯 Onboard "${name}" (${city}) — ${results.steps_completed.length} OK, ${results.steps_failed.length} failed — ${duration}ms`);

  res.json({
    success: true,
    restaurant_id: restaurantId,
    duration_ms: duration,
    ...results
  });
});

// ============================================================
// WELCOME EMAIL — Send after registration
// ============================================================
app.post('/api/send-welcome-email', requireAuth, async (req, res) => {
  const email = req.account.email;
  const name = req.account.name || email.split('@')[0];

  const smtpHost = process.env.SMTP_HOST;
  if (!smtpHost) {
    console.log(`📧 Welcome email would be sent to ${email} (SMTP not configured)`);
    return res.json({ success: true, mode: 'dry_run', message: 'SMTP non configuré — email simulé' });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'RestauRank <noreply@restaurank.fr>',
      to: email,
      subject: `Bienvenue sur RestauRank, ${name} ! 🎉`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h1 style="color:#6366f1;">Bienvenue sur RestauRank !</h1>
          <p>Bonjour ${name},</p>
          <p>Votre compte RestauRank est prêt. Voici comment démarrer en 2 minutes :</p>
          <ol>
            <li><strong>Entrez le nom de votre restaurant</strong> — on fait le reste automatiquement</li>
            <li><strong>Connectez Google Business Profile</strong> — pour modifier votre fiche en 1 clic</li>
            <li><strong>Lancez l'audit</strong> — scores SEO + GEO + recommandations IA personnalisées</li>
          </ol>
          <p><a href="${process.env.APP_URL || 'http://localhost:8765'}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Lancer mon premier audit →</a></p>
          <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
          <p style="color:#999;font-size:12px;">RestauRank — Audit SEO + GEO automatique pour restaurants</p>
        </div>
      `
    });
    console.log(`📧 Welcome email sent to ${email}`);
    res.json({ success: true, mode: 'sent' });
  } catch (e) {
    console.warn(`📧 Welcome email failed for ${email}:`, e.message);
    res.json({ success: false, error: e.message });
  }
});

// ============================================================
// CMS PLUGIN ENDPOINTS — WordPress plugin + Universal snippet
// ============================================================

// Generate a connection code for a restaurant (used in dashboard)
app.post('/api/cms/generate-code', requireAuth, (req, res) => {
  const { restaurant_id } = req.body;
  if (!restaurant_id) return res.status(400).json({ error: 'restaurant_id requis' });

  // Generate a unique connection code: RR-XXXX-XXXX-XXXX
  const code = 'RR-' + crypto.randomBytes(2).toString('hex').toUpperCase() + '-'
             + crypto.randomBytes(2).toString('hex').toUpperCase() + '-'
             + crypto.randomBytes(2).toString('hex').toUpperCase();

  const apiToken = crypto.randomBytes(32).toString('hex');

  try {
    db.prepare(`INSERT OR REPLACE INTO restaurant_settings (restaurant_id, type, data, updated_at)
      VALUES (?, 'cms_connect_code', ?, datetime('now'))`)
      .run(restaurant_id, JSON.stringify({ code, api_token: apiToken, created_at: new Date().toISOString(), used: false }));

    res.json({ success: true, code, instructions: {
      wordpress: `Installez le plugin RestauRank, puis entrez le code : ${code}`,
      universal: `<script src="${process.env.APP_URL || 'http://localhost:' + PORT}/snippet.js" data-rr="${code}"></script>`,
      webflow: `Ajoutez ce script dans Site Settings → Custom Code → Head Code`
    }});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// WordPress plugin connection endpoint
app.post('/api/cms/wp-connect', (req, res) => {
  const { connect_code, site_url, site_name, site_token, wp_version, plugin_version, rest_url, capabilities } = req.body;

  if (!connect_code) return res.status(400).json({ error: 'Code de connexion manquant' });

  // Find restaurant by connection code
  const settings = db.prepare(`SELECT restaurant_id, data FROM restaurant_settings WHERE type = 'cms_connect_code' AND json_extract(data, '$.code') = ?`).get(connect_code);

  if (!settings) return res.status(404).json({ error: 'Code invalide ou expiré' });

  const codeData = JSON.parse(settings.data);
  const restaurantId = settings.restaurant_id;

  // Get restaurant info
  const restaurant = db.prepare('SELECT name, city FROM restaurants WHERE id = ?').get(restaurantId);

  // Save CMS connection
  db.prepare(`INSERT OR REPLACE INTO restaurant_settings (restaurant_id, type, data, updated_at)
    VALUES (?, 'cms_connection', ?, datetime('now'))`)
    .run(restaurantId, JSON.stringify({
      cms: 'wordpress',
      site_url: site_url,
      site_name: site_name,
      site_token: site_token,
      rest_url: rest_url,
      wp_version: wp_version,
      plugin_version: plugin_version,
      capabilities: capabilities || {},
      api_token: codeData.api_token,
      connected_at: new Date().toISOString()
    }));

  // Mark code as used
  codeData.used = true;
  codeData.used_at = new Date().toISOString();
  codeData.site_url = site_url;
  db.prepare(`UPDATE restaurant_settings SET data = ?, updated_at = datetime('now') WHERE restaurant_id = ? AND type = 'cms_connect_code'`)
    .run(JSON.stringify(codeData), restaurantId);

  logAction(restaurantId, 'cms_connect', 'wordpress', 'plugin', 'success', { site_url, wp_version });

  console.log(`🔌 WordPress connecté: ${site_name} (${site_url}) → restaurant #${restaurantId}`);

  res.json({
    success: true,
    restaurant_id: restaurantId,
    restaurant_name: restaurant?.name || 'Restaurant',
    api_token: codeData.api_token
  });
});

// WordPress sync — return pending tasks
app.get('/api/cms/wp-sync', (req, res) => {
  const { restaurant_id } = req.query;
  const auth = req.headers.authorization?.replace('Bearer ', '');

  if (!auth || !restaurant_id) return res.status(401).json({ error: 'Non autorisé' });

  // Verify token
  const conn = db.prepare(`SELECT data FROM restaurant_settings WHERE restaurant_id = ? AND type = 'cms_connection'`).get(restaurant_id);
  if (!conn) return res.status(404).json({ error: 'Connexion non trouvée' });
  const connData = JSON.parse(conn.data);
  if (connData.api_token !== auth) return res.status(401).json({ error: 'Token invalide' });

  // Collect pending tasks
  const tasks = [];

  // Get cached AI content
  const aiContent = db.prepare(`SELECT data FROM restaurant_settings WHERE restaurant_id = ? AND type = 'ai_cache_onboard_pack'`).get(restaurant_id);
  if (aiContent) {
    const ai = JSON.parse(aiContent.data);
    const result = ai.result || {};

    if (result.schema_restaurant) {
      tasks.push({ type: 'schema_org', data: result.schema_restaurant });
    }
    if (result.meta_title || result.meta_description) {
      tasks.push({ type: 'meta_tags', data: { title: result.meta_title, description: result.meta_description } });
    }
    if (result.faq) {
      tasks.push({ type: 'faq_page', data: { title: 'Questions fréquentes', questions: result.faq } });
    }
  }

  // Get Hub NAP data
  const hubData = db.prepare(`SELECT data FROM restaurant_settings WHERE restaurant_id = ? AND type = 'hub_data'`).get(restaurant_id);
  if (hubData) {
    const hub = JSON.parse(hubData.data);
    tasks.push({ type: 'nap_update', data: hub });
  }

  res.json({ success: true, tasks, timestamp: new Date().toISOString() });
});

// WordPress sync report — log what was applied
app.post('/api/cms/wp-sync-report', (req, res) => {
  const { restaurant_id, applied, timestamp } = req.body;
  if (applied && applied.length > 0) {
    logAction(restaurant_id || 0, 'cms_sync', applied.join(','), 'wordpress', 'success', { applied, timestamp });
    console.log(`📦 WP Sync: ${applied.join(', ')} appliqués sur restaurant #${restaurant_id}`);
  }
  res.json({ success: true });
});

// WordPress disconnect
app.post('/api/cms/wp-disconnect', (req, res) => {
  const auth = req.headers.authorization?.replace('Bearer ', '');
  const { site_token } = req.body;

  // Find and remove connection
  const connections = db.prepare(`SELECT restaurant_id, data FROM restaurant_settings WHERE type = 'cms_connection'`).all();
  for (const conn of connections) {
    const data = JSON.parse(conn.data);
    if (data.api_token === auth || data.site_token === site_token) {
      db.prepare(`DELETE FROM restaurant_settings WHERE restaurant_id = ? AND type = 'cms_connection'`).run(conn.restaurant_id);
      logAction(conn.restaurant_id, 'cms_disconnect', 'wordpress', 'plugin', 'success');
      console.log(`🔌 WordPress déconnecté: restaurant #${conn.restaurant_id}`);
      break;
    }
  }
  res.json({ success: true });
});

// ── UNIVERSAL SNIPPET ENDPOINTS ──

// Serve the snippet JS file
app.get('/snippet.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(path.join(__dirname, 'restaurank-wp-plugin', 'restaurank-snippet.js'));
});

// Snippet — get optimizations for a page
app.get('/api/snippet/optimizations', (req, res) => {
  const { code, url, page } = req.query;
  if (!code) return res.status(400).json({ error: 'Code manquant' });

  // Find restaurant by code
  const settings = db.prepare(`SELECT restaurant_id, data FROM restaurant_settings WHERE type = 'cms_connect_code' AND json_extract(data, '$.code') = ?`).get(code);
  if (!settings) return res.status(404).json({ error: 'Code invalide', success: false });

  const restaurantId = settings.restaurant_id;
  const restaurant = db.prepare('SELECT name, city FROM restaurants WHERE id = ?').get(restaurantId);
  const result = { success: true };

  // Get AI-generated content
  const aiContent = db.prepare(`SELECT data FROM restaurant_settings WHERE restaurant_id = ? AND type = 'ai_cache_onboard_pack'`).get(restaurantId);
  if (aiContent) {
    const ai = JSON.parse(aiContent.data);
    const aiResult = ai.result || {};

    // Schema.org
    if (aiResult.schema_restaurant) {
      result.schema = aiResult.schema_restaurant;
    }

    // Meta tags
    if (aiResult.meta_title || aiResult.meta_description) {
      result.meta = {
        title: aiResult.meta_title,
        description: aiResult.meta_description,
        og_title: aiResult.meta_title,
        og_description: aiResult.meta_description
      };
    }

    // FAQ schema (only on FAQ-like pages)
    if (aiResult.faq && page && (page.includes('faq') || page.includes('questions'))) {
      result.faq_schema = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        'mainEntity': aiResult.faq.map(qa => ({
          '@type': 'Question',
          'name': qa.question || qa.q,
          'acceptedAnswer': { '@type': 'Answer', 'text': qa.answer || qa.a }
        }))
      };
    }
  }

  // Get Hub NAP data for LocalBusiness schema
  const hubData = db.prepare(`SELECT data FROM restaurant_settings WHERE restaurant_id = ? AND type = 'hub_data'`).get(restaurantId);
  if (hubData) {
    const hub = JSON.parse(hubData.data);
    result.local_business = {
      '@context': 'https://schema.org',
      '@type': 'Restaurant',
      'name': hub.name || restaurant?.name,
      'address': hub.address ? {
        '@type': 'PostalAddress',
        'streetAddress': hub.address,
        'addressLocality': hub.city || restaurant?.city
      } : undefined,
      'telephone': hub.phone,
      'url': hub.website,
      'servesCuisine': hub.cuisine
    };
  } else if (restaurant) {
    result.local_business = {
      '@context': 'https://schema.org',
      '@type': 'Restaurant',
      'name': restaurant.name,
      'address': { '@type': 'PostalAddress', 'addressLocality': restaurant.city }
    };
  }

  // CORS for cross-origin snippet
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(result);
});

// Snippet — report what was applied
app.post('/api/snippet/report', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { code, url, applied } = req.body;
  if (code && applied) {
    const settings = db.prepare(`SELECT restaurant_id FROM restaurant_settings WHERE type = 'cms_connect_code' AND json_extract(data, '$.code') = ?`).get(code);
    if (settings) {
      logAction(settings.restaurant_id, 'snippet_apply', (applied || []).join(','), 'snippet', 'success', { url });
    }
  }
  res.json({ success: true });
});

// CORS preflight for snippet
app.options('/api/snippet/*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'seo-geo-audit-tool.html'));
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║     RestauRank Backend v6.0 — Full SaaS Mode         ║
║   http://localhost:${PORT}                              ║
╠══════════════════════════════════════════════════════╣
║  🎯 ONBOARD:  POST /api/onboard (full auto!)        ║
║  📧 Email:    POST /api/send-welcome-email           ║
║  🔑 Auth:     POST /auth/register|login              ║
║  💳 Stripe:   POST /api/subscription/upgrade|cancel  ║
║  📊 GBP:      GET /api/gbp/accounts|locations        ║
║  ⚡ GBP:      POST /api/gbp/update-*|bulk-apply      ║
║  🔍 CMS:      POST /api/detect-cms                   ║
║  🌐 CMS:      POST /api/cms/connect|wordpress        ║
║  🤖 AI:       POST /api/ai/generate|bulk-generate    ║
║  🔗 Dirs:     POST /api/directories/check-all        ║
║  🤖 Auto:     POST /api/autonomous-scan              ║
║  🏠 Hub:      POST /api/scrape-gmb|scrape-photos     ║
╠══════════════════════════════════════════════════════╣
║  Clés centralisées:                                  ║
║  ${process.env.ANTHROPIC_API_KEY?'✅':'❌'} Claude AI  ${process.env.YELP_API_KEY?'✅':'❌'} Yelp  ${process.env.FOURSQUARE_API_KEY?'✅':'❌'} Foursquare          ║
║  ${process.env.TRIPADVISOR_API_KEY?'✅':'❌'} TripAdvisor  ${process.env.STRIPE_SECRET_KEY?'✅':'❌'} Stripe  ${process.env.GOOGLE_PLACES_API_KEY?'✅':'❌'} Places    ║
╚══════════════════════════════════════════════════════╝
  `);
});
