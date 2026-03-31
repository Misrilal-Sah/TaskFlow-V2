// ============================================
// TaskFlow — Service Worker (Offline-First)
// ============================================

const CACHE_NAME = 'taskflow-v3';
const APP_SHELL = [
  '/',
  '/index.html',
  '/app.html',
  '/emails-preview.html',
  '/css/reset.css',
  '/css/variables.css',
  '/css/base.css',
  '/css/components.css',
  '/css/views.css',
  '/css/animations.css',
  '/css/responsive.css',
  '/js/supabase.js',
  '/js/auth.js',
  '/js/db.js',
  '/js/tasks.js',
  '/js/projects.js',
  '/js/ui.js',
  '/js/ai.js',
  '/js/timer.js',
  '/js/notifications.js',
  '/js/theme.js',
  '/js/sync.js',
  '/js/stats.js',
  '/js/app.js',
  '/assets/logo.svg',
  '/assets/icons.svg',
];

// ---- Install: Cache App Shell ----
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache each file individually so one failure doesn't break everything
      await Promise.allSettled(
        APP_SHELL.map(url => cache.add(url).catch(e => console.warn('SW cache miss:', url, e.message)))
      );
    }).then(() => self.skipWaiting())
  );
});

// ---- Activate: Clean old caches ----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// ---- Fetch: Strategy Router ----
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Supabase API calls: Network-first, cache fallback
  if (url.hostname.includes('supabase') || url.hostname.includes('groq')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Google Fonts & CDN: Cache-first
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com') ||
      url.hostname.includes('cdn.jsdelivr.net')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Navigation requests (HTML document loads) — always serve app shell from cache
  if (request.mode === 'navigate') {
    event.respondWith(serveNavigation(request));
    return;
  }

  // App Shell & Static Assets: Cache-first with background update
  event.respondWith(staleWhileRevalidate(request));
});

// ---- Background Sync ----
self.addEventListener('sync', (event) => {
  if (event.tag === 'taskflow-sync') {
    event.waitUntil(syncData());
  }
});

// ---- Push Notifications ----
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'TaskFlow', {
      body: data.body || '',
      icon: '/assets/logo.svg',
      badge: '/assets/logo.svg',
      vibrate: [200, 100, 200],
      data: data.url || '/',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/app') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(event.notification.data || '/app.html');
    })
  );
});

// ---- Skip Waiting (force new SW to activate immediately) ----
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ---- Caching Strategies ----

/**
 * Navigation fallback: Try network first (to get fresh HTML),
 * fall back to cached /app.html for any app route.
 */
async function serveNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  const url = new URL(request.url);

  try {
    // Try network first for navigation
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
      return response;
    }
    throw new Error('Non-ok response');
  } catch {
    // Offline: serve from cache — try exact URL first, then app.html fallback
    const cached =
      (await cache.match(request)) ||
      (await cache.match(url.origin + '/app')) ||
      (await cache.match('/app.html')) ||
      (await cache.match('/app'));

    if (cached) return cached;

    // Last resort: return the root page
    const root = await cache.match('/') || await cache.match('/index.html');
    return root || new Response('Offline — please reload when connected', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => cached || new Response('', { status: 503 }));

  // Return cached immediately if available; otherwise wait for network
  return cached || fetchPromise;
}

// ---- Sync Queue Processing ----
async function syncData() {
  const allClients = await clients.matchAll();
  allClients.forEach((client) => {
    client.postMessage({ type: 'SYNC_REQUESTED' });
  });
}
