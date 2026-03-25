# Déploiement RestauRank sur IONOS (yatairamen.fr)

## Option recommandée : IONOS VPS (Linux)

### 1. Connexion au VPS
```bash
ssh root@votre-ip-ionos
```

### 2. Installer Node.js 20
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node -v  # v20.x.x
```

### 3. Installer PM2 (process manager)
```bash
npm install -g pm2
```

### 4. Uploader les fichiers
Depuis votre machine locale :
```bash
scp server.js seo-geo-audit-tool.html package.json package-lock.json .env root@votre-ip-ionos:/var/www/restaurank/
```

### 5. Configurer sur le serveur
```bash
cd /var/www/restaurank
cp .env.example .env
nano .env  # Modifier APP_URL, ADMIN_EMAIL, ADMIN_PASSWORD
```

Fichier `.env` minimum pour tester :
```env
PORT=8765
NODE_ENV=production
DB_PATH=/var/www/restaurank/restaurank.db
APP_URL=https://restaurank.yatairamen.fr
ADMIN_EMAIL=votre@email.com
ADMIN_PASSWORD=VotreMotDePasse123!
REGISTRATION_MODE=open
```

### 6. Installer les dépendances
```bash
npm ci --omit=dev
```
Note : `better-sqlite3` nécessite `python3`, `make`, `g++` :
```bash
apt-get install -y python3 make g++
npm ci --omit=dev
```

### 7. Lancer avec PM2
```bash
pm2 start server.js --name restaurank
pm2 save
pm2 startup  # Auto-démarrage au reboot
```

### 8. Configurer Nginx (reverse proxy)
```bash
apt-get install -y nginx
```

Créer `/etc/nginx/sites-available/restaurank` :
```nginx
server {
    listen 80;
    server_name restaurank.yatairamen.fr;

    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Activer :
```bash
ln -s /etc/nginx/sites-available/restaurank /etc/nginx/sites-enabled/
nginx -t && systemctl restart nginx
```

### 9. SSL avec Let's Encrypt
```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d restaurank.yatairamen.fr
```

### 10. Configurer le sous-domaine IONOS
Dans le panel IONOS :
1. Domaines → yatairamen.fr → DNS
2. Ajouter un enregistrement A :
   - Type: A
   - Nom: restaurank
   - Valeur: `votre-ip-vps`
   - TTL: 3600

---

## Option alternative : Docker sur IONOS VPS

Si Docker est installé :
```bash
# Sur le VPS
cd /var/www/restaurank
docker compose up -d
```

Le `docker-compose.yml` et `Dockerfile` sont déjà inclus dans le projet.

---

## Option Web Hosting IONOS (sans VPS)

Si vous avez un hébergement web classique (pas de VPS), Node.js n'est pas disponible directement. Options :
1. Upgrader vers un VPS Cloud S (à partir de 2€/mois chez IONOS)
2. Utiliser Railway.app ou Render.com (gratuit pour tester) comme serveur, et pointer le sous-domaine

---

## Commandes utiles

```bash
# Voir les logs
pm2 logs restaurank

# Redémarrer après une mise à jour
pm2 restart restaurank

# Vérifier le statut
pm2 status

# Sauvegarder la base de données
cp /var/www/restaurank/restaurank.db /var/www/restaurank/backup-$(date +%Y%m%d).db
```

## Mise à jour du code
```bash
# Depuis votre machine locale
scp server.js seo-geo-audit-tool.html root@votre-ip-ionos:/var/www/restaurank/
ssh root@votre-ip-ionos "cd /var/www/restaurank && pm2 restart restaurank"
```
