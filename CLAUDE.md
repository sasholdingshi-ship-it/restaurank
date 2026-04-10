# RestauRank — Guide complet pour Claude Code

## TL;DR
SaaS webapp qui audite la visibilité en ligne d'un restaurant sur Google (SEO local) ET sur les moteurs IA (ChatGPT, Perplexity, Gemini, Claude). Single-file HTML frontend + Node.js/Express/SQLite backend. Déployé sur Render. 50 commits, ~20k lignes de code total.
**Vision** : outil 100% autonome — le client n'a presque rien à faire. RestauRank détecte le CMS, se connecte aux APIs, et applique les améliorations automatiquement.

---

## 🔑 ACCÈS CRITIQUES

> **⚠️ Les secrets (API keys, tokens, passwords) sont dans `.secrets.md` (gitignored) et `.env`.**
> Claude Code : lis `.secrets.md` pour les credentials. Ne jamais les mettre dans un fichier commité.

### GitHub
- **Repo** : `https://github.com/sasholdingshi-ship-it/restaurank.git`
- **Git config** : `git config user.name "James"` + `git config user.email "sasholdingshi@gmail.com"`
- PAT et clone URL → voir `.secrets.md`

### Render (hébergement)
- **URL live** : `https://restaurank.onrender.com`
- **Service ID** : `srv-d71tgi5m5p6s73a18kv0`
- **Dashboard** : `https://dashboard.render.com` (login avec GitHub)
- **Auto-deploy** : chaque push sur `main` → deploy en ~3-5 min
- **⚠️** : Render free tier reset SQLite à chaque deploy + bloque SMTP (587/465)
- Env vars configurées sur Render (20 vars) → voir `.secrets.md` pour la liste complète

### Resend (emails)
- **From actuel** : `RestauRank <onboarding@resend.dev>` (domaine test)
- **Pour production** : vérifier un domaine custom dans https://resend.com/domains
- Le code utilise `RESEND_FROM` séparé de `SMTP_FROM`. Sans `RESEND_FROM`, fallback sur `onboarding@resend.dev`

### Stripe (paiements — MODE TEST)
- Les Price IDs (STRIPE_PRICE_STARTER, PRO, PREMIUM) ne sont pas encore créés

### Google Cloud
- **GBP API** : demande d'accès soumise 2026-03-22, ticket #6569000040778, en attente (~2-4 semaines)

---

## 📁 Architecture des fichiers

```
restaurank/
├── seo-geo-audit-tool.html   # Frontend client (~12000 lignes)
├── admin.html                 # Dashboard admin séparé (/admin)
├── server.js                  # Backend Node.js (~11500 lignes)
├── db-adapter.js              # SQLite (runtime) + PostgreSQL (backup sync)
├── init-db.sql                # Schéma PostgreSQL natif (20 tables)
├── setup-db.js                # Migration SQLite → PostgreSQL
├── package.json               # express, better-sqlite3, pg, stripe, googleapis
├── .env                       # Env vars locales (gitignored)
├── .env.example               # Template env vars
├── .gitignore                 # .env, node_modules/, *.db
├── Dockerfile                 # Docker Node 20
├── Procfile                   # `web: node server.js`
├── restaurank-wp-plugin/      # Plugin WordPress auto-apply SEO
└── restaurank-wp-plugin.zip
```

### Structure du frontend (seo-geo-audit-tool.html)
```
[CSS]                    → lignes 1-450
[HTML screens]           → lignes 453-850
  #landing               → page d'accueil + historique + champ URL
  #confirmation          → vérification Google Maps
  #scanning              → animation scan 11 étapes
  #dashboard             → scores SEO/GEO + tabs
    tabAudit             → items par catégorie
    tabReviews           → gestion avis
    tabSocial            → Google Posts + social
    tabDispatch          → panneau autonome CMS + annuaires
    tabSettings          → paramètres
  #groupDash             → multi-sites
  #actionModal           → modal amélioration
  #cmdPanel              → command center annuaires (12 plateformes)
[JS]                     → lignes 850-11500
  CATEGORIES[]           → 7 catégories, ~49 items
  generateAuditData()    → données simulées (fallback)
  computeScores()        → calcul SEO/GEO scores
  renderDashboard()      → rendu (overridé 3x)
  showAction()           → modal avec auto-apply
  CMS_INFO{}             → config par CMS
  renderCMSPanel()       → CMS détecté + connexion
  runFullAutonomous()    → automatisation complète
  buildWebsiteImprovements() → schema.org, meta, FAQ, NAP
  dirClaimData{}         → cache claim par plateforme
  renderDirAutoGrid()    → grille annuaires
```

### Structure du backend (server.js)
```
[Imports + Setup]        → lignes 1-260
[Email system]           → lignes 263-340 (Resend + SMTP + dev_log)
[Database schema]        → lignes ~340-500 (SQLite tables)
[Auth routes]            → /auth/register, login, logout, me, forgot/reset-password
[Restaurant CRUD]        → /api/restaurants
[GBP API routes]         → /api/gbp/* (en attente d'accès)
[CMS routes]             → /api/detect-cms, /api/cms/connect, /api/cms/*/apply
[Directory routes]       → /api/directories/*
[AI routes]              → /api/ai/generate, bulk-generate
[Audit routes]           → /api/audit-website, /api/scrape-gmb, /api/scrape-photos
[Email routes]           → /api/send-welcome-email, /api/email-config
[Stripe routes]          → /api/subscription/*, /api/stripe/webhook
[Admin routes]           → /api/admin/*
[Static serving]         → seo-geo-audit-tool.html on GET /
[Startup banner]         → ASCII art avec status des API keys
```

---

## 🔧 Lancer en local

```bash
# Clone URL avec PAT → voir .secrets.md
git clone https://github.com/sasholdingshi-ship-it/restaurank.git
cd restaurank
npm install
node server.js
# → http://localhost:8765
# Login admin → voir .secrets.md
```

---

## 🎯 Patterns critiques

### 1. Override pattern (frontend)
```javascript
const _origFn = renderDashboard;
renderDashboard = function() { _origFn(); /* extensions */ };
```
Utilisé 3x pour renderDashboard, et pour renderHistory, goLanding, showAction.

### 2. Scores — TOUJOURS utiliser currentScores.categories
```javascript
computeScores()  // → { seo, geo, categories: [...items enrichis avec score/status/tip] }
// CORRECT : currentScores.categories[i].score
// FAUX :    CATEGORIES[i].score  ← le tableau statique n'a PAS de scores
```

### 3. PLATFORMS[].claimUrl sont des FONCTIONS
```javascript
platform.claimUrl(restaurantName)  // → URL string
// PAS : platform.claimUrl         // ← c'est une fonction !
```

### 4. Email fallback chain
```
Resend API (RESEND_API_KEY) → SMTP Nodemailer (SMTP_HOST) → console dev_log
```
`RESEND_FROM` et `SMTP_FROM` sont séparés car Resend refuse les domaines non vérifiés.

### 5. Auth
- Routes = `/auth/*` (PAS `/api/auth/*`)
- Header = `Authorization: Bearer <session_token>`
- Login retourne `{ session: "..." }` (PAS `{ token: "..." }`)
- Admin créé auto au startup via `ADMIN_EMAIL` + `ADMIN_PASSWORD`

---

### 6. Database Architecture
- **Runtime** : SQLite (better-sqlite3) — toutes les queries sont sync
- **Backup** : PostgreSQL Neon (si `DATABASE_URL` set) — sync async en arrière-plan
- **db-adapter.js** : `createDB()` retourne toujours SQLite. `setupPGSync(db)` fait :
  - Startup : restore PG → SQLite (récupère les données persistées)
  - Toutes les 5 min : backup SQLite → PG (persiste les nouvelles données)
- **Ne JAMAIS utiliser PG pour les queries runtime** — SQLite only
- Tables sync : accounts, restaurants, restaurant_settings, sessions

### 7. Admin Dashboard (`/admin`)
- Fichier séparé `admin.html` servi à `GET /admin`
- Login dédié (vérifie `role=admin`)
- Charte graphique ラグランパンチ : bleu marine `#1B2A4A`, orange `#D95B2B`, beige `#FAF3EB`
- Onglets : Clients, Restaurants, Invitations, Qualité Data, Paramètres
- Fiche client : Audit (49 items + IA), Hub Central (éditable), IA Contenu (8 types)
- Qualité Data : validation 11 règles, cross-check Google, sync quotidienne 3h AM

### 8. Social Login
- `GET /auth/social/google` → redirige vers Google OAuth avec `state=social_login`
- Le callback `/auth/google/callback` détecte `state=social_login` pour créer/connecter un compte client
- Réutilise le même redirect URI que GBP OAuth (pas besoin de config Google Console)
- Apple Sign-In : code prêt, besoin d'un Apple Developer Service ID

### 9. Hub Central Scraping
- `/api/scrape-gmb` : Google Places API (photos 1600px, toutes les données GMB)
- Logo : favicon, og:image, `<img>` avec class/alt/src "logo"
- Couleurs : theme-color, CSS variables, hex fréquents
- Polices : Google Fonts links, font-family CSS, @font-face
- Domain Authority : Moz API ou estimation heuristique
- Instagram : Graph API via Meta OAuth token (real, pas scrape HTML)

---

## ✅ Ce qui fonctionne

- Landing → Google Maps confirmation → scan animé → dashboard SEO/GEO
- 7 catégories, 49 items d'audit avec contenu auto-généré
- Hub Central : NAP, photos GMB/Instagram/site, logo, couleurs, polices, DA
- CMS Detection (8 CMS supportés) + WordPress Auto-Apply
- Directory auto-check 11 plateformes + auto-claim
- Audit réel site web (crawl title, meta, schema, FAQ, NAP, OG)
- Auth complète (inscription, login, sessions, reset password, Google Sign-In)
- Email Resend fonctionnel
- Stripe intégration (mode test)
- Admin dashboard séparé (`/admin`) avec charte graphique
- Data quality engine (11 règles + cross-check Google + sync quotidienne)
- Claude AI connecté à chaque fonction (génération, audit, bulk)
- Instagram Graph API (real photos, likes, captions)
- PG sync backup (SQLite runtime + Neon backup)

## ⏳ En attente / À faire

- **Meta App Review** (~1-2 semaines) — pour `pages_manage_posts` + `instagram_content_publish` en Standard. Privacy policy URL publique + screencast démo requis
- **Stripe Price IDs** : créer les plans dans Stripe dashboard
- **Apple Sign-In** : créer Service ID dans Apple Developer ($99/an)
- **Domaine email custom** : vérifier domaine dans Resend
- **Régénérer secrets leakés** (META_APP_SECRET, OPENPAGERANK_API_KEY) — voir security_rotate_secrets.md

## ✅ Résolu session 2026-04-10

- DB persistante : Render disk `/data` + Neon PG sync 5min, 8 tables synchronisées (`db-adapter.js`)
- Frontend split : 1388 lignes HTML + public/styles.css + public/app.js
- Tests : `npm test` (7 smoke tests, node:test)
- Hub Central SSOT : `getHubData()` 40+ champs, source unique pour blog/Reddit/annuaires
- Special hours : table dédiée + push GBP + détection trous 30j + jours fériés FR dynamiques (algo Meeus)
- Meta OAuth : app `RestauRank` (id `965770446105058`) live, env vars Render configurés, bouton Hub Central
- Logo detection : 6 stratégies (apple-touch-icon, header img, CSS bg, top 10KB, og:image, etc.)
- Domain Authority : Moz prioritaire + OpenPageRank fallback gratuit (1000 req/jour)
- `main` ↔ `main-sync` réconciliées sur `daedeff`

## 🐛 Problèmes connus

- Render cold start ~30s après 15 min d'inactivité
- SMTP bloqué sur Render → contourné via Resend
- ~~SQLite reset à chaque deploy Render~~ → résolu : disque `/data` + PG sync

---

## 📐 Conventions

- **UI** : français
- **Variables/fonctions** : anglais
- **Code compact** : one-liners, template literals
- **Zéro dépendances frontend** (sauf Google Fonts + Maps)
- **Try/catch** autour de localStorage
- **Single-file** : tout le frontend dans un fichier, tout le backend dans un autre

---

## 🚀 Workflow de déploiement

```bash
# Modifier → tester local → commit → push → Render auto-deploy (3-5 min)
git add server.js seo-geo-audit-tool.html
git commit -m "Description"
git push origin main
```

Test email après deploy :
```bash
TOKEN=$(curl -s -X POST https://restaurank.onrender.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"sasholdingshi@gmail.com","password":"RestauRank2026!"}' | jq -r '.session')
curl -X POST https://restaurank.onrender.com/api/send-welcome-email \
  -H "Authorization: Bearer $TOKEN"
```

---

## 📝 Décisions techniques

| Date | Décision | Raison |
|------|----------|--------|
| 2026-03-22 | Single-file HTML | Simplicité, pas de build step |
| 2026-03-23 | SQLite | Zéro config, suffisant pour MVP |
| 2026-03-23 | Render | Free tier avec Docker |
| 2026-03-24 | Sessions token (pas JWT) | Plus simple, invalidation instantanée |
| 2026-03-25 | Puppeteer scraping | JS rendering pour Google Maps |
| 2026-03-28 | Resend (pas SMTP) | Render bloque SMTP sortant |
| 2026-03-28 | RESEND_FROM séparé | Resend exige domaine vérifié |
| 2026-03-31 | Admin dashboard séparé | `/admin` invisible des clients |
| 2026-03-31 | SQLite runtime + PG backup | deasync incompatible Docker, SQLite = sync fiable |
| 2026-03-31 | Google Sign-In via state param | Réutilise le même redirect URI, 0 config Console |
| 2026-03-31 | Charte ラグランパンチ | Bleu marine + orange + beige |
| 2026-03-31 | Data quality engine | 11 règles validation + cross-check Google + cron 3h |

## Permissions
```json
{
  "permissions": {
    "defaultMode": "acceptEdits",
    "allow": ["Bash(npm run:*)", "Read", "Glob", "Grep", "Bash(git status:*)"],
    "deny": ["Bash(rm -rf:*)", "Bash(sudo:*)"]
  }
}
```
