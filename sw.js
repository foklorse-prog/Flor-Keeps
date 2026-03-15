/* ══════════════════════════════════════════════════════
   Luminae Craft — Service Worker
   Strategy: Network-first with cache fallback.
   On every request we try the network first. If the
   network succeeds we ALSO update the cache in the
   background, so offline fallback always stays fresh.
   If the network fails (user is offline) we fall back
   to whatever is cached.

   Update flow:
   • The main page posts SKIP_WAITING as soon as a new
     SW finishes installing, so the new version activates
     immediately on the NEXT navigation / refresh rather
     than waiting for all tabs to close.
   • Old caches from previous versions are deleted in the
     activate step so stale assets never linger.
══════════════════════════════════════════════════════ */

const CACHE = 'luminae-v1'; // Bump this string when you deploy a new release

// Assets to pre-cache on install so the shell loads offline right away
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
];

// ── Install: pre-cache the app shell ──────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE))
    // Note: do NOT call skipWaiting() here — we let the
    // main page trigger it via postMessage so the timing
    // is intentional and doesn't interrupt active use.
  );
});

// ── Activate: delete any caches from older SW versions ─
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE)   // keep only the current cache
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim()) // take control of all open tabs immediately
  );
});

// ── Message: page can tell us to skip waiting ──────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting(); // activate immediately; triggers 'controllerchange' on the page
  }
});

// ── Fetch: network-first, fall back to cache ───────────
self.addEventListener('fetch', event => {
  // Only handle GET requests — skip POST/PUT etc.
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests (fonts, CDN scripts, images from Unsplash etc.)
  // We only cache same-origin assets.
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        // Network succeeded → clone and store in cache, then return live response
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(() =>
        // Network failed (offline) → serve from cache
        // If not in cache either, serve /index.html as fallback (SPA pattern)
        caches.match(event.request).then(cached => cached || caches.match('/index.html'))
      )
  );
});
