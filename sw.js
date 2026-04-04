// ── Service Worker — Cache-First Offline PWA ─────────

const CACHE_NAME = 'inv-platform-v3';
const ASSETS = [
  '/',
  '/index.html',
  '/css/variables.css',
  '/css/base.css',
  '/css/layout.css',
  '/css/components.css',
  '/js/app.js',
  '/js/db.js',
  '/js/config.js',
  '/js/router.js',
  '/js/stores/products.js',
  '/js/stores/materials.js',
  '/js/stores/history.js',
  '/js/stores/production.js',
  '/js/stores/expenses.js',
  '/js/stores/transactions.js',
  '/js/services/cost-analysis.js',
  '/js/services/plaid.js',
  '/js/ui/header.js',
  '/js/ui/alerts.js',
  '/js/ui/cards.js',
  '/js/ui/grid.js',
  '/js/ui/modals.js',
  '/js/ui/tables.js',
  '/js/ui/toast.js',
  '/js/ui/cost-analysis.js',
  '/js/ui/transactions.js',
  '/js/ui/plaid.js',
  '/manifest.json',
];

// Install: pre-cache app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for assets, network-first for CDN
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // NEVER cache API routes — always go to network
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Network-first for external CDN resources (Plaid Link SDK, fonts, etc.)
  if (url.origin !== self.location.origin) {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const clone = r.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return r;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for local assets
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
