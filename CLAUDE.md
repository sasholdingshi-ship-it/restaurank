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
├── seo-geo-audit-tool.html   # Frontend single-file (~11500 lignes)
├── server.js                  # Backend Node.js (~9180 lignes)
├── package.json               # express, better-sqlite3, stripe, puppeteer, nodemailer, googleapis
├── .env                       # Env vars locales (gitignored)
├── .env.example               # Template env vars
├── .gitignore                 # .env, node_modules/, *.db
├── Dockerfile                 # Docker Node 20
├── Procfile                   # `web: node server.js`
├── railway.json               # Config Railway (backup)
├── build.js                   # Obfuscation JS
├── deploy.sh                  # Script déploiement
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

## ✅ Ce qui fonctionne

- Landing → Google Maps confirmation → scan animé → dashboard SEO/GEO
- 7 catégories, 49 items d'audit avec contenu auto-généré
- Hub Central : NAP centralisé, photos, push all
- CMS Detection (8 CMS supportés)
- WordPress Auto-Apply via REST API
- Directory auto-check 11 plateformes + auto-claim
- Audit réel site web (crawl title, meta, schema, FAQ, NAP, OG)
- Auth complète (inscription, login, sessions, reset password)
- Email Resend fonctionnel (testé 2026-03-28)
- Stripe intégration (mode test)
- Admin dashboard
- Multi-site + localStorage persistence

## ⏳ En attente / À faire

- **GBP API access** : ticket #6569000040778 (2026-03-22)
- **DB persistante** : migrer SQLite → PostgreSQL (Render reset SQLite à chaque deploy)
- **Stripe Price IDs** : créer les plans dans Stripe dashboard
- **Domaine email custom** : vérifier domaine dans Resend
- **Wix/Squarespace/Shopify APIs** : actuellement instructions manuelles
- **Tests automatisés** : aucun test existant
- **Séparer le frontend** : 11500 lignes en un seul fichier

## 🐛 Problèmes connus

- Render cold start ~30s après 15 min d'inactivité
- SMTP bloqué sur Render → contourné via Resend
- Le .env local a un SMTP_PASS différent de celui sur Render
- Google Maps scrape limité (JS rendering) → GBP API résoudra ça

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
