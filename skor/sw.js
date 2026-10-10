// Offline cache for the app shell (network-first, so updates arrive immediately).
const CACHE = 'setpoint-v1'
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'scoring.js', 'i18n.js', 'icon.svg', 'manifest.webmanifest', 'vendor/peerjs.min.js', 'vendor/qrcode.js']
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())))
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  )
})
