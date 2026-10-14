const CACHE = 'webleste-shell-__BUILD_ID__';
const ASSETS = /*PRECACHE*/[];
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  // A failed fetch fails installation; never claim an incomplete shell is offline-ready.
  let next = 0;
  await Promise.all(Array.from({length:3}, async () => {
    while (next < ASSETS.length) { const url = ASSETS[next++]; await cache.add(new Request(url,{cache:'reload'})); }
  }));
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if(url.origin !== location.origin || event.request.method !== 'GET') return;
  // The auth helper must remain outside cross-origin isolation for GIS popups.
  const auth = /\/drive-auth\.(html|js)$/.test(url.pathname);
  event.respondWith((async()=>{
    const cache = await caches.open(CACHE);
    let response = await cache.match(event.request);
    if(!response) response = await fetch(event.request);
    if(!response.ok || response.type === 'opaque') return response;
    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy', auth ? 'same-origin-allow-popups' : 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', auth ? 'unsafe-none' : 'require-corp');
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  })());
});
