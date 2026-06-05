const CACHE_NAME = 'dongjeoncoffee-v15-20260528-no-html-cache';
const APP_SHELL = [
  '/manifest.webmanifest',
  '/logo.png?v=20260517b',
  '/wordmark.png?v=20260517b',
  '/app-icon-192.png',
  '/app-icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // ✅ Firebase Auth redirect 경로는 SW가 가로채지 않음
  if (event.request.url.includes('/__/auth/') || event.request.url.includes('/auth')) {
    return;
  }

  // ✅ navigate(페이지 이동/F5)는 SW가 가로채지 않음 — 브라우저 기본 동작
  if (event.request.mode === 'navigate') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;
  const isCacheableAsset = isSameOrigin && ['script', 'style', 'font', 'image', 'manifest'].includes(event.request.destination);
  if (!isCacheableAsset) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then((response) => {
        if (!response || response.status !== 200) return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
