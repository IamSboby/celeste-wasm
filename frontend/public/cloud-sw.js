const CACHE = 'webleste-shell-__BUILD_ID__';
const ASSETS = /*PRECACHE*/[];
const FILES = /*FILES*/[];
const base = self.registration.scope;
const known = new Map(FILES.map(file => [new URL(file.path,base).href,file]));
const inflight = new Map();
let completed = 0;
let installError;
let offlineTask;
async function reportInstall() {
  const clients = await self.clients.matchAll({includeUncontrolled:true});
  for (const client of clients) client.postMessage({type:'offline-install',completed,total:ASSETS.length,error:installError});
}
async function acquire(url) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(url);
  if(cached) return cached;
  if(!inflight.has(url)) {
    const transfer = (async()=>{
      for(let attempt=0;;attempt++) {
        try {
          const response=await fetch(new Request(url,{cache:'reload'}));
          if(!response.ok) throw new Error('HTTP '+response.status);
          // Keep the proven large-WASM Cache.put workaround, one build chunk at a time.
          const bytes=await response.arrayBuffer();
          const file=known.get(url);
          if(file) {
            if(bytes.byteLength!==file.size) throw new Error('Incomplete build resource');
            const digest=await crypto.subtle.digest('SHA-256',bytes);
            const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
            if(hash!==file.sha256) throw new Error('Build resource integrity mismatch');
          }
          const result=new Response(bytes,{status:response.status,headers:response.headers});
          await cache.put(url,result.clone());
          return result;
        } catch(error) { if(attempt===2) throw error; }
      }
    })();
    inflight.set(url,transfer);
    void transfer.finally(()=>inflight.delete(url)).catch(()=>{});
  }
  return (await inflight.get(url)).clone();
}
async function installAll(paths,report) {
  let next=0, done=0;
  const results=await Promise.allSettled(Array.from({length:3},async()=>{
    while(next<paths.length) {
      await acquire(new URL(paths[next++],base).href);
      await report(++done,paths.length);
    }
  }));
  for(const result of results) if(result.status==='rejected') throw result.reason;
}
self.addEventListener('message',event=>{
  if(event.data?.type==='offline-install-status') event.waitUntil(reportInstall());
  if(event.data?.type==='runtime-download-all') {
    const port=event.ports?.[0];
    if(!port) return;
    // This verifies every published runtime file, not the user's game installation.
    if(!offlineTask) offlineTask=installAll([...new Set([...ASSETS,...FILES.map(f=>f.path)])],async()=>{}).finally(()=>{offlineTask=undefined;});
    event.waitUntil(offlineTask.then(()=>port.postMessage({ok:true}),error=>port.postMessage({error:error.message})));
  }
});
self.addEventListener('install',event=>event.waitUntil((async()=>{
  try {
    await installAll(ASSETS,async done=>{completed=done;await reportInstall();});
    await self.skipWaiting();
  } catch(error) {installError=error.message;await reportInstall();throw error;}
})()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==location.origin || event.request.method!=='GET') return;
  const auth=/\/drive-auth\.(html|js)$/.test(url.pathname);
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    let response=await cache.match(event.request);
    if(!response && !known.has(url.href)) response=await caches.match(event.request);
    // A known but uncached chunk must be fetched, never mistaken for EOF.
    if(!response && /\/_framework\/dotnet\.native\.[^/]+\.wasm\d+$/.test(url.pathname) && !known.has(url.href)) return new Response(null,{status:404});
    if(!response) response=known.has(url.href) && !event.request.headers.has('Range')
      ? await acquire(url.href) : await fetch(event.request);
    if(!response.ok || response.type==='opaque') return response;
    const headers=new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy',auth?'same-origin-allow-popups':'same-origin');
    headers.set('Cross-Origin-Embedder-Policy',auth?'unsafe-none':'require-corp');
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  })());
});
