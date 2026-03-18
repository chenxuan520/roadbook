const CACHE_NAME = 'roadbook-v1';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './ai_assistant.js',
    './online_mode.js',
    './html_export.js',
    './debug.js',
    './favicon.png',
    './manifest.json',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Opened cache');
                return cache.addAll(ASSETS_TO_CACHE);
            })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    // 忽略非 GET 请求
    if (event.request.method !== 'GET') return;

    // 忽略 API 请求（由应用逻辑处理，或者如果你希望离线也能看旧数据，可以缓存 GET API）
    // 这里我们假设 API 请求不走 SW 缓存，或者采用 Network First
    const url = new URL(event.request.url);
    if (url.pathname.startsWith('/api/')) {
        return;
    }

    // Stale-While-Revalidate 策略
    // 优先返回缓存，同时在后台更新缓存
    event.respondWith(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.match(event.request).then((response) => {
                const fetchPromise = fetch(event.request)
                    .then((networkResponse) => {
                        // 检查响应是否有效
                        if (networkResponse && networkResponse.status === 200) {
                            cache.put(event.request, networkResponse.clone());
                        }
                        return networkResponse;
                    })
                    .catch((error) => {
                        console.log('Fetch failed:', error);
                        // 如果网络请求失败且没有缓存，这里可以返回一个离线 fallback 页面
                    });

                // 如果有缓存，直接返回缓存；否则等待网络请求
                return response || fetchPromise;
            });
        })
    );
});
