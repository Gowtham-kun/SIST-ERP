/**
 * Sathyabama Student Portal — Progressive Web App Service Worker
 * Provides offline shell resilience, rapid cached asset loading, and network-first API fetching.
 */

const CACHE_NAME = 'sathy-portal-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/portal-api.js',
  '/manifest.json',
  '/favicon.png',
  '/favicon.ico'
];

// Install: Cache critical static shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Cache pre-fetch error:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean up old cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Network-first for dynamic API routes; Cache-falling-back-to-network for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Always bypass cache for API calls, login, or POST requests to ensure live ERP data
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname === '/login') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Return cached version when offline
        return cachedResponse;
      });

      // Return cached version immediately if available, while refreshing in background (stale-while-revalidate)
      return cachedResponse || fetchPromise;
    })
  );
});
