#!/bin/bash
# ============================================================
# RestauRank — Script de déploiement production
# Usage: ./deploy.sh
# ============================================================
set -e

echo "🚀 RestauRank — Déploiement"
echo "=========================="

# 1. Check .env exists
if [ ! -f .env ]; then
    echo "❌ Fichier .env manquant !"
    echo "   Copiez .env.example vers .env et configurez vos variables."
    echo "   cp .env.example .env && nano .env"
    exit 1
fi

# 2. Check required vars
source .env
MISSING=""
[ -z "$ADMIN_EMAIL" ] && MISSING="$MISSING ADMIN_EMAIL"
[ -z "$ADMIN_PASSWORD" ] && MISSING="$MISSING ADMIN_PASSWORD"
if [ -n "$MISSING" ]; then
    echo "❌ Variables manquantes dans .env :$MISSING"
    exit 1
fi

# 3. Warnings
[ -z "$STRIPE_SECRET_KEY" ] && echo "⚠️  STRIPE_SECRET_KEY non configuré — les paiements seront en mode démo"
[ -z "$SMTP_HOST" ] && echo "⚠️  SMTP non configuré — les emails seront loggés en console"
[ -z "$APP_URL" ] && echo "⚠️  APP_URL non défini — utilise http://localhost:8765 par défaut"

# 4. Install deps
echo ""
echo "📦 Installation des dépendances..."
npm ci --omit=dev

# 5. Build obfuscated version (optional)
if [ "$1" = "--build" ]; then
    echo "🔒 Build de la version obfusquée..."
    npm install --save-dev javascript-obfuscator
    node build.js
    echo "   → dist/seo-geo-audit-tool.min.html généré"
fi

# 6. Start
echo ""
echo "✅ Déploiement prêt !"
echo ""
echo "Démarrage :"
echo "  npm start                    # Direct"
echo "  docker compose up -d         # Docker"
echo "  pm2 start server.js --name restaurank  # PM2 (recommandé)"
echo ""
echo "URL : ${APP_URL:-http://localhost:8765}"
echo "Admin : $ADMIN_EMAIL"
