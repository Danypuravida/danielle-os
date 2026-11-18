const CACHE_NAME = 'danielle-os-v1-1-49';
const CORE_ASSETS = [
  './',
  './index.html',
  './clean-theme.css?v=2',
  './appearance.js?v=1',
  './workspace-theme.css?v=1',
  './appearance.css?v=2',
  './learning-bank.js?v=4',
  './learning-bank.css?v=2',
  './development-workspaces.js?v=1',
  './basic-triage.mjs?v=1',
  './development-workspaces.css?v=1',
  './native-tasks.js?v=1',
  './native-tasks.css?v=1',
  './focus-workspace.css?v=1',
  './focus-workspace.js?v=4',
  './career-portfolio.css?v=3',
  './career-portfolio.js?v=4',
  './manifest.webmanifest',
  './service-worker.js',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

async function networkFirst(request){
  const cache = await caches.open(CACHE_NAME);
  try{
    const fresh = await fetch(request);
    cache.put(request, fresh.clone());
    return fresh;
  }catch(err){
    return await cache.match(request) || await cache.match('./index.html');
  }
}

async function staleWhileRevalidate(request){
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const networkPromise = fetch(request).then(response => {
    cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || networkPromise || Response.error();
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if(request.method !== 'GET') return;
  const url = new URL(request.url);
  if(url.origin !== location.origin) return;

  if(request.mode === 'navigate'){
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});