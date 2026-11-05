// SentinelDrive service worker.
// Purpose: make the app installable and fast to reopen. It never caches live
// data: /api, /media and the websocket always go to the network, so reports and
// driver alerts are never stale.
const VERSION = 'sd-v1'
const SHELL = `${VERSION}-shell`
const ASSETS = `${VERSION}-assets`

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png']))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

const isLive = (url) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/') || url.pathname === '/ws'

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin || isLive(url)) return // maps, live data: straight to the network

  // Opening the app: try the network so updates arrive; fall back to the saved shell.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(SHELL).then((c) => c.put('/', copy))
          return res
        })
        .catch(() => caches.match('/'))
    )
    return
  }

  // Built files (hashed names), face-model files and wasm never change under the same
  // name, so serve them from the cache after the first load.
  if (/^\/(assets|wasm|models|icons)\//.test(url.pathname) || /\.(svg|webmanifest)$/.test(url.pathname)) {
    e.respondWith(
      caches.open(ASSETS).then((cache) =>
        cache.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok) cache.put(req, res.clone())
              return res
            })
        )
      )
    )
  }
})
