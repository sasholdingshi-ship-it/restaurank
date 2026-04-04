const CACHE = 'yatai-v1'
const PRECACHE = ['/', '/commandes', '/mercurial', '/produits', '/recettes', '/icons/icon.svg']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  // API calls: network first, no cache
  if (url.pathname.startsWith('/api/')) return

  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone()
        caches.open(CACHE).then(c => c.put(e.request, clone))
      }
      return res
    }).catch(() => caches.match(e.request))
  )
})
