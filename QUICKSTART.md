# RestauRank 2.0 — Quick Start Guide

## ✅ What's New

Your RestauRank tool now works **without needing a backend server**. No more "Backend non démarré" errors!

New features:
- 🔍 **Audit** — SEO/GEO scoring (existing)
- ⭐ **Avis** — AI review responses
- 📱 **Social** — Google Posts generator
- 🤖 **IA Dispatch** — Batch improvement execution
- ⚙️ **Paramètres** — Settings & configuration

---

## 🚀 Getting Started (30 seconds)

### 1. Open the Tool
```
Double-click: seo-geo-audit-tool.html
```
That's it! No `npm start`, no terminal, no backend.

### 2. First Time: Enter Your Restaurant
- Landing page → Type restaurant name
- Confirm location on Google Maps
- Let it scan (10 steps)
- View dashboard with SEO/GEO scores

### 3. Set Up Google Connection (Optional)
- Dashboard → "Connecter Google" button
- Complete OAuth flow
- Your email will show as connected

### 4. (Optional) Configure Settings
- Click ⚙️ **Paramètres** tab
- Paste your **Google Cloud Client ID** (see below)
- (Advanced) Paste Claude API Key for smarter AI
- Click "Enregistrer les paramètres"

---

## 🔐 Google Cloud Client ID (30 seconds)

**Need this to publish improvements to Google directly.**

### Get Your Client ID:
1. Go to: https://console.cloud.google.com
2. Create new project (or use existing)
3. Enable APIs:
   - Search for "Business Profile API" → Enable
   - Search for "Google My Business API" → Enable
4. Create OAuth Credentials:
   - Click "Create Credentials" → OAuth 2.0 Client ID
   - Choose "Web application"
   - Authorized redirect URIs: Add `http://localhost:3000`
5. Copy the **Client ID** (looks like: `123456789-abc...@apps.googleusercontent.com`)
6. Paste in Settings → Google Cloud Client ID

✅ Done! You can now connect Google.

---

## 📋 How to Use Each Tab

### 🔍 Audit Tab (Main)
1. View your SEO/GEO scores
2. Click score blocks to switch views
3. Expand category items to see details
4. Click "⚡ Améliorer auto" to apply improvements

### ⭐ Avis (Reviews)
1. See review stats: count, rating, response rate
2. Click "💬 Répondre avec IA" for suggested reply
3. Copy response and paste into Google Business Profile manually

### 📱 Social
1. Click "🤖 Générer avec IA" to generate post suggestions
2. Edit the post content as needed
3. Click "🚀 Publier" to send to Google Posts (if connected)

### 🤖 IA Dispatch
1. See all audit improvements listed
2. Click "🚀 Lancer tout" to apply them in batch
3. Watch the execution log in real-time
4. Improvements marked ✅ when done

### ⚙️ Paramètres (Settings)
1. **Google Cloud Client ID** — Paste from console.cloud.google.com
2. **Claude API Key** — (Optional) For smarter AI suggestions
3. **Nom du restaurant** — Your restaurant name
4. **Ville** — Your city
5. Click "💾 Enregistrer" to save
6. Click "📤 Exporter" to backup all data as JSON

---

## 🔄 Typical Workflow

### Day 1: Initial Audit
1. Open tool → Enter restaurant → Scan
2. Review SEO/GEO scores
3. Go to 🔍 Audit → Expand items
4. Review recommendations (improve descriptions, categories, etc.)

### Day 2: Configuration
1. Go to ⚙️ Paramètres
2. Add Google Cloud Client ID
3. Click "Connecter Google" (top of dashboard)
4. Complete OAuth

### Day 3: Apply Improvements
1. Go to 🤖 IA Dispatch
2. Click "🚀 Lancer tout"
3. Watch improvements apply in real-time
4. Sit back and let Google sync (24-48 hours)

### Week 1: Monitor Reviews
1. Check ⭐ Avis tab daily
2. Use AI to reply to new reviews
3. Improve response rate

### Week 2: Social Posts
1. Go to 📱 Social tab
2. Generate posts weekly
3. Publish to Google Posts

---

## ❓ FAQs

### Q: Do I need the backend anymore?
**A:** Nope! The tool is 100% client-side now. You can delete `server.js` if you want.

### Q: What if I don't configure Google?
**A:** The audit and recommendations still work. You just won't be able to auto-apply changes. You can still use copy-paste mode.

### Q: Where is my data stored?
**A:** Locally in your browser's `localStorage`. Nothing goes to the cloud. You can export it anytime (Settings → Export).

### Q: Can I use this offline?
**A:** Almost! The Google OAuth requires internet (obviously), but once connected, you can use the tool offline (except for publishing).

### Q: Multiple restaurants?
**A:** Yes! Each audit is saved. Click "← Nouvel audit" to start a new one. View multi-site dashboard with 🏢 button if you have 2+ restaurants.

### Q: My data disappeared!
**A:** Check Settings → Export to see if it's there. If not, try:
- Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
- Clear cache and reload
- Check if localStorage is enabled (F12 → Application → localStorage)

### Q: Can I integrate Claude API?
**A:** Yes! (Advanced) Paste your API key in Settings. The tool will use Claude for smarter content suggestions.

---

## 🛠️ Troubleshooting

### "Connecter Google" doesn't work
→ Check Settings → Google Cloud Client ID is configured correctly

### Improvements don't apply
→ Make sure you're connected (green "✓ Google connecté" badge)
→ Check browser console (F12) for errors

### Reviews/Social tabs empty
→ Refresh page (F5)
→ Check browser DevTools Network tab for any blocked requests

### Settings not saving
→ Check if localStorage is enabled in browser privacy settings
→ Try incognito/private browsing mode

### Token expired
→ Just click "Déconnecter" then "Connecter Google" again
→ Tokens refresh automatically every ~1 hour

---

## 📚 Additional Resources

- **Google Business Profile API Docs:** https://developers.google.com/my-business
- **Business Profile API Guide:** https://developers.google.com/business-profile/apis
- **OAuth 2.0 Setup:** https://developers.google.com/identity/protocols/oauth2
- **Claude API (optional):** https://docs.anthropic.com

---

## 💡 Pro Tips

1. **Batch Processing:** Use 🤖 IA Dispatch → "Lancer tout" to apply all improvements at once
2. **Export Regularly:** Go to Settings → Export every week to backup your data
3. **Mobile View:** Works on mobile too! Tap tabs to switch views
4. **Multi-Site:** Set up multiple restaurants and use group dashboard (🏢 button on landing)
5. **Schema.org:** Advanced users can grab code from Audit → "Copier le code complet"

---

## 🆘 Need Help?

1. **Check the console:** F12 → Console tab → Look for red errors
2. **Try incognito mode:** Eliminates browser extensions interference
3. **Clear cache:** Ctrl+Shift+Del → Clear all time → Reload
4. **Export data:** Settings → Export to backup before major changes
5. **Read IMPLEMENTATION_NOTES.md:** Detailed technical docs

---

## ✨ What's Different from v1.0?

| Feature | v1.0 (Backend) | v2.0 (Client-Side) |
|---------|---|---|
| **Backend Server** | ✅ Required (`npm start`) | ❌ Not needed |
| **OAuth** | Backend-handled | Browser-handled (GSI) |
| **Tabs** | Single dashboard | 5 organized tabs |
| **Reviews** | Not available | ⭐ Full management |
| **Social** | Not available | 📱 Content generator |
| **Dispatch** | Manual batch | 🤖 Automated batch |
| **Settings** | Config file | ⚙️ In-app settings |
| **Data** | Server database | Browser localStorage |

---

**Version:** 2.0 (March 2026)  
**Status:** ✅ Production Ready  
**Last Updated:** 2026-03-22

Happy auditing! 🚀
