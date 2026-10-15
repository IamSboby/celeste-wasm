const CACHE = 'webleste-shell-__BUILD_ID__';
const ASSETS = /*PRECACHE*/[];
let completed = 0;
let installError;
async function reportInstall() {
  const clients = await self.clients.matchAll({includeUncontrolled:true});
  for (const client of clients) client.postMessage({type:'offline-install',completed,total:ASSETS.length,error:installError});
}
self.addEventListener('message', event => {
  if (event.data?.type === 'offline-install-status') event.waitUntil(reportInstall());
});
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  // A failed fetch fails installation; never claim an incomplete shell is offline-ready.
  let next = 0;
  await Promise.all(Array.from({length:3}, async () => {
    while (next < ASSETS.length) {
      const url = ASSETS[next++];
      try {
        // Cache writes are atomic, so a retry can keep completed downloads.
        if (!await cache.match(url)) {
          for (let attempt = 0; ; attempt++) {
            try {
              const response = await fetch(new Request(url,{cache:'reload'}));
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              // Buffer one build chunk (at most 20 MiB) before writing: some
              // browser backends fail Cache.put for large network streams.
              const bytes = await response.arrayBuffer();
              await cache.put(url,new Response(bytes,{status:response.status,headers:response.headers}));
              break;
            } catch (error) {
              if (attempt === 2) throw error;
            }
          }
        }
        completed++;
        await reportInstall();
      } catch (error) {
        installError = `${url}: ${error.message}`;
        await reportInstall();
        throw error;
      }
    }
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
    // An already open game may still request assets from the previous build.
    if(!response) response = await caches.match(event.request);
    // The runtime discovers the end of the split WASM by requesting one extra
    // numbered chunk. Return its EOF response even with no network connection.
    if(!response && /\/_framework\/dotnet\.native\.[^/]+\.wasm\d+$/.test(url.pathname)) return new Response(null,{status:404});
    if(!response) response = await fetch(event.request);
    if(!response.ok || response.type === 'opaque') return response;
    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy', auth ? 'same-origin-allow-popups' : 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', auth ? 'unsafe-none' : 'require-corp');
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  })());
});
