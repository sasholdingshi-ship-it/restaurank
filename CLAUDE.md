# RestauRank — Audit SEO + GEO pour restaurants

## Contexte projet
SaaS webapp single-file HTML (`seo-geo-audit-tool.html`) qui audite la visibilité en ligne d'un restaurant sur Google (SEO local) ET sur les moteurs IA (ChatGPT, Perplexity, Gemini, Claude). Modèle économique : abonnement mensuel.
**Vision** : outil 100% autonome — le client n'a presque rien à faire. RestauRank détecte le CMS, se connecte aux APIs, et applique les améliorations automatiquement.

## Stack technique
- **Single-file HTML** (~3100 lignes) — pas de framework, pas de build
- Vanilla JS, CSS custom properties (dark theme)
- localStorage pour la persistance (`restaurank_data`)
- Backend Node.js (`server.js` ~1020 lignes) avec SQLite — OAuth Google, GBP API, CMS detection, auto-apply
- Audit simulé côté client via `generateAuditData()` (en attendant données réelles GBP)

## Architecture des fichiers

### seo-geo-audit-tool.html
```
[CSS]                    → lignes 1-450 (includes autonomous system styles)
[HTML screens]           → lignes 453-850
  - #landing             → page d'accueil + historique + champ URL site web
  - #confirmation        → vérification Google Maps
  - #scanning            → animation scan 11 étapes (inclut CMS detection)
  - #dashboard           → scores SEO/GEO + items détaillés + tabs
    - tabAudit           → audit items par catégorie
    - tabReviews         → gestion des avis
    - tabSocial          → Google Posts + social
    - tabDispatch        → 🤖 PANNEAU AUTONOME (CMS + auto-apply + directories)
    - tabSettings        → paramètres
  - #groupDash           → tableau de bord multi-sites
  - #actionModal         → modal amélioration (contenu auto-généré)
  - #cmdPanel            → command center annuaires (12 plateformes)
[JS]                     → lignes 850-3128
  - CATEGORIES[]         → 7 catégories, ~47 items avec check(), getStatus(), action{}
  - generateAuditData()  → données simulées aléatoires
  - computeScores()      → calcul SEO/GEO scores
  - renderDashboard()    → rendu scores + items (overridé 3x)
  - showAction()         → modal avec auto-apply GBP + website code
  - CMS_INFO{}           → config par CMS (WordPress, Webflow, Wix, etc.)
  - renderCMSPanel()     → affiche CMS détecté + formulaire connexion
  - runFullAutonomous()  → exécution automatique complète (GBP + site + annuaires)
  - buildWebsiteImprovements() → génère schema.org, meta tags, FAQ, NAP
  - dirClaimData{}       → cache claim data par plateforme (survit re-render)
  - dirCheckResults{}    → cache scan results par plateforme
  - renderDirAutoGrid()  → grille annuaires avec statuts + instructions inline
  - autoCheckAllPlatforms() → scan 11 plateformes via /api/directories/auto-check
  - autoClaimPlatform()  → fetch claim data + open URL + show instructions
  - autoConnectAllPlatforms() → fetch parallèle claim data → instructions sans popup
  - markPlatformDone()   → marque connecté + clean dirClaimData + re-render
```

### server.js
```
[Database]               → SQLite: users, restaurants, action_log, cms_connections, directory_automation
[Google OAuth]           → /auth/google, /auth/google/callback
[GBP API]                → /api/gbp/accounts, locations, update-*, bulk-apply
[CMS Detection]          → POST /api/detect-cms — fetch website HTML, detect WP/Webflow/Wix/etc.
[CMS Auto-Apply]         → POST /api/cms/connect, /api/cms/wordpress/apply, /api/cms/webflow/apply, /api/cms/generic/apply
[Directory Automation]   → POST /api/directories/bing/import, apple/claim, foursquare/claim
[Autonomous Scan]        → POST /api/autonomous-scan — orchestrates CMS + directories
[Restaurant CRUD]        → /api/restaurants
```

## Patterns importants
- `computeScores()` retourne des items enrichis via `{...item, score, status, tip}` — TOUJOURS utiliser `currentScores.categories` pour accéder aux items avec scores, JAMAIS le tableau statique `CATEGORIES`
- Function overrides pattern : `const _orig=fn; fn=function(){_orig();...}` — utilisé pour renderDashboard (3 overrides), renderHistory, goLanding, showAction
- Les items d'audit ont un `action.steps[]` (étapes manuelles) ET du contenu auto-généré via `generateContent(itemId)`
- `PLATFORMS[].claimUrl` sont des FONCTIONS `q=>url`, pas des strings
- CMS detection: server-side fetch + regex analysis (signatures: wp-content, data-wf-site, wix.com, squarespace-cdn, cdn.shopify.com)

## Langue
- UI et commentaires en français
- Noms de variables/fonctions en anglais

## Conventions de code
- Code compact (one-liners quand possible)
- Template literals pour le HTML dynamique
- Pas de dépendances externes (sauf Google Fonts + Google Maps embed)
- Try/catch autour des opérations localStorage

## Ce qui fonctionne
- Landing → confirmation Google Maps → scan animé → dashboard SEO/GEO
- Scores duaux SEO + GEO avec rings animés
- 7 catégories d'audit avec 35 items détaillés
- Command center annuaires (12 plateformes, lancement séquentiel)
- Persistance localStorage (restaurants, actions, plateformes)
- Multi-site : group dashboard, NAP consistency, schema.org hiérarchique
- Historique des restaurants audités
- Système d'amélioration auto : 35 items avec contenu auto-généré, modal tabs, copier-coller, markDone
- Enhanced showAction : section auto-apply GBP + code website intégré
- **CMS Detection** : détecte WordPress, Webflow, Wix, Squarespace, Shopify, PrestaShop, Drupal, Joomla
- **CMS Auto-Connect** : formulaire de connexion par CMS avec credentials API
- **WordPress Auto-Apply** : Schema.org, meta tags, FAQ page, NAP contact via REST API
- **Webflow Auto-Apply** : préparé pour MCP Webflow (site_id + tasks)
- **Directory Auto-Check** : POST /api/directories/auto-check scrape 11 plateformes en parallèle (batches de 4)
- **Directory Auto-Claim** : POST /api/directories/auto-claim retourne prefill + instructions par plateforme
- **Directory Grid v2** : cards avec statuts persistants (pending/checking/found/not_found/claiming/connected), instructions inline via `dirClaimData{}`, boutons Ouvrir/C'est fait/Fermer
- **Tout connecter** : fetch parallel de toutes les claim data → affiche instructions sans popup → user clique "Ouvrir" par plateforme
- **Background scan** : CMS detection + directory auto-check lancés en parallèle pendant l'animation de scan
- **Full Autonomous Button** : "Tout automatiser" — GBP + Site + Annuaires + Social en 1 clic
- **Scan with CMS detection** : le champ URL site web déclenche /api/autonomous-scan pendant le scan

## Système d'amélioration auto (✅ fonctionne)
Flow complet : cliquer item audit → déplier → voir bouton "⚡ Améliorer auto" → cliquer → modal s'ouvre avec tabs "Contenu prêt à l'emploi" + "Étapes détaillées" → copier le contenu → marquer comme fait.
- 35/35 items ont un `action` + `generateContent()` associé
- Override pattern : `_origShowAction` → ajoute section auto-apply GBP + website code
- `switchActionTab()`, `copyGen()`, `markDone()` — tous fonctionnels

## Système autonome (✅ v4.0 — Full AutoPilot)
- **CMS Detection** : POST /api/detect-cms analyse les signatures HTML (wp-content, data-wf-site, etc.)
- **CMS Connect** : formulaire par CMS, credentials stockées dans SQLite (cms_connections table)
- **WordPress REST API** : auto-inject Schema.org, update title/meta, create FAQ page, update contact NAP
- **Webflow MCP** : tasks générées, prêtes pour application via MCP tools
- **Wix/Squarespace/Shopify** : instructions étape-par-étape générées automatiquement
- **runFullAutonomous() v2** : 5 étapes (Audit 47 items → ALL GBP + réponses avis → Site/CMS + SEO on-page → Annuaires scan+claim → Social + GEO contenu)
- **runPostScanAutomation()** : s'exécute silencieusement 500ms après chaque scan — auto-populate Hub, auto-reply reviews, auto-generate posts, auto-prepare directories, pré-génère contenu pour TOUS les items en erreur
- **showAutoPilotToast()** : notification non-intrusive en bas à droite résumant ce qui a été auto-fait, disparaît après 15s
- **Directory Auto-Grid v2** : 11 plateformes avec statuts persistants, instructions inline, `dirClaimData{}` survit aux re-renders
- **autoConnectAllPlatforms()** : fetch parallèle de toutes les claim data → affiche instructions sans ouvrir de popups → zéro blocage navigateur
- **autoConnectAndFinalize()** : scan + claim + ouverture séquentielle avec délai anti-bot (2-5s)
- **markPlatformDone()/closePlatformInstr()** : gestion propre des statuts avec re-render
- **Pre-generated content** : `window._autoContent_{itemId}` stocke le contenu pré-généré pour chaque item en erreur

## Hub Central (✅ nouveau)
- **Tab "🏠 Hub Central"** dans le dashboard — centralise TOUTES les infos du restaurant
- **NAP centralisé** : nom, catégorie, adresse, téléphone, site web, description, horaires — source unique de vérité
- **POST /api/scrape-gmb** : scrape Google Maps + site web pour récupérer nom, adresse, tél, horaires, photos, schema.org
- **POST /api/scrape-photos** : récupère les photos depuis GMB et le site web, catégorise (plat, ambiance, façade, équipe, terrasse)
- **Gestionnaire de photos** : galerie avec filtres par type, sélection multiple, publication sur tous les annuaires
- **pushHubToAll()** : pousse les infos centralisées sur GBP + CMS + tous les annuaires en 1 clic
- **checkNapConsistency()** : vérifie la cohérence NAP entre Hub, GBP, et chaque annuaire scanné
- **renderHubSources()** : affiche les sources de données (GBP, site, audit, photos, annuaires, CMS) avec statut

## Audit réel (✅ nouveau)
- **POST /api/audit-website** : crawl réel du site web — title, meta desc, schema.org, FAQ, NAP, OG tags, etc.
- **Intégré dans startScan()** : pendant l'animation de scan, `/api/audit-website` + `/api/scrape-gmb` sont appelés en parallèle
- **Merge dans currentData** : les résultats réels (hasTitle, hasSchemaRestaurant, napOnSite, etc.) remplacent les données simulées
- **`window._realAudit`** : stocke les résultats d'audit réel, `window._hubData` pour les données scrappées
- `generateAuditData()` reste le fallback pour les champs non couverts par le crawl réel

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

## En attente
- GBP API access (ticket #6569000040778, soumis 2026-03-22, ~2-4 semaines)
- Auto-apply réel via GBP API une fois quota accordé
- Wix/Squarespace APIs réelles (actuellement instructions manuelles)
- Browser automation pour claim annuaires (Yelp, TripAdvisor — pas d'API publique)
- Google Maps scrape limité (rendu JS côté client) — données réelles viendront de GBP API
