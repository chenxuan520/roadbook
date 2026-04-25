const CACHE_PREFIX = 'roadbook';
const CACHE_SCHEMA_VERSION = '2026-04-25';
const CORE_ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './app_utils.js',
    './app_theme.js',
    './app_tooltips.js',
    './app_history.js',
    './app_search.js',
    './app_ai.js',
    './app_date_filter.js',
    './app_date_notes.js',
    './app_sidebar.js',
    './app_detail_panels.js',
    './app_map.js',
    './app_io.js',
    './help_tour.js',
    './ai_assistant.js',
    './online_mode.js',
    './html_export.js',
    './debug.js',
    './favicon.png',
    './manifest.json'
];
const RUNTIME_CACHEABLE_ORIGINS = new Set([
    self.location.origin,
    'https://unpkg.com'
]);

function createCacheVersion(seed) {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        hash = ((hash << 5) - hash) + seed.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}

const CACHE_VERSION = createCacheVersion([
    CACHE_SCHEMA_VERSION,
    ...CORE_ASSETS,
    ...Array.from(RUNTIME_CACHEABLE_ORIGINS)
].join('|'));
const CORE_CACHE_NAME = `${CACHE_PREFIX}-core-${CACHE_VERSION}`;
const RUNTIME_CACHE_NAME = `${CACHE_PREFIX}-runtime-${CACHE_VERSION}`;
const ACTIVE_CACHE_NAMES = new Set([CORE_CACHE_NAME, RUNTIME_CACHE_NAME]);

function isHttpRequest(request) {
    const url = new URL(request.url);
    return url.protocol === 'http:' || url.protocol === 'https:';
}

function isNavigationRequest(request) {
    if (request.mode === 'navigate') {
        return true;
    }
    const accept = request.headers.get('accept') || '';
    return request.destination === 'document' || accept.includes('text/html');
}

function isCacheableResponse(response) {
    return Boolean(response) && (response.ok || response.type === 'opaque');
}

function shouldBypassRequest(request, url) {
    if (request.method !== 'GET') {
        return true;
    }
    if (url.pathname.startsWith('/api/')) {
        return true;
    }
    if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
        return true;
    }
    return false;
}

function shouldUseRuntimeCache(url) {
    return RUNTIME_CACHEABLE_ORIGINS.has(url.origin);
}

async function precacheCoreAssets() {
    const cache = await caches.open(CORE_CACHE_NAME);
    await cache.addAll(CORE_ASSETS.map((asset) => new Request(asset, { cache: 'reload' })));
}

async function cleanupOldCaches() {
    const cacheNames = await caches.keys();
    await Promise.all(
        cacheNames.map((cacheName) => {
            if (cacheName.startsWith(`${CACHE_PREFIX}-`) && !ACTIVE_CACHE_NAMES.has(cacheName)) {
                return caches.delete(cacheName);
            }
            return Promise.resolve(false);
        })
    );
}

async function matchFromCaches(request) {
    const runtimeCache = await caches.open(RUNTIME_CACHE_NAME);
    const runtimeMatch = await runtimeCache.match(request);
    if (runtimeMatch) {
        return runtimeMatch;
    }

    const coreCache = await caches.open(CORE_CACHE_NAME);
    return coreCache.match(request);
}

async function getOfflineDocument() {
    const coreCache = await caches.open(CORE_CACHE_NAME);
    return (await coreCache.match('./index.html')) || coreCache.match('./');
}

async function fetchAndCache(request) {
    const url = new URL(request.url);

    try {
        const networkResponse = await fetch(request);
        if (shouldUseRuntimeCache(url) && isCacheableResponse(networkResponse)) {
            const runtimeCache = await caches.open(RUNTIME_CACHE_NAME);
            await runtimeCache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (error) {
        console.log('ServiceWorker fetch failed:', request.url, error);
        return null;
    }
}

async function networkFirst(request) {
    const networkResponse = await fetchAndCache(request);
    if (networkResponse) {
        return networkResponse;
    }

    const cachedResponse = await matchFromCaches(request);
    if (cachedResponse) {
        return cachedResponse;
    }

    return getOfflineDocument();
}

async function staleWhileRevalidate(request, event) {
    const cachedResponse = await matchFromCaches(request);
    const networkPromise = fetchAndCache(request);

    event.waitUntil(networkPromise.then(() => undefined).catch(() => undefined));

    if (cachedResponse) {
        return cachedResponse;
    }

    const networkResponse = await networkPromise;
    if (networkResponse) {
        return networkResponse;
    }

    if (isNavigationRequest(request)) {
        return getOfflineDocument();
    }

    return Response.error();
}

self.addEventListener('install', (event) => {
    event.waitUntil(precacheCoreAssets());
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(cleanupOldCaches());
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    if (!isHttpRequest(event.request)) {
        return;
    }

    const url = new URL(event.request.url);
    if (shouldBypassRequest(event.request, url)) {
        return;
    }

    if (isNavigationRequest(event.request)) {
        event.respondWith(networkFirst(event.request));
        return;
    }

    if (!shouldUseRuntimeCache(url)) {
        return;
    }

    event.respondWith(staleWhileRevalidate(event.request, event));
});
