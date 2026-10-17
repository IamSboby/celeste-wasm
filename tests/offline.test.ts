import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';

const source=await readFile(new URL('../frontend/public/cloud-sw.js',import.meta.url),'utf8');
const origin='https://example.test';
function worker(current:Map<string,Response>,older=new Map<string,Response>(),network=async(_request:unknown):Promise<Response>=>{throw new Error('offline');},files:Array<{path:string;size:number;sha256:string}>=[]) {
  const listeners=new Map<string,Function>();
  const key=(request:Request|string)=>typeof request==='string'?request:request.url;
  const cache={match:async(request:Request|string)=>current.get(key(request))?.clone(),put:async(request:Request|string,response:Response)=>{current.set(key(request),response);}};
  const context={URL,Request,Response,Headers,crypto:webcrypto,location:{origin},fetch:network,caches:{open:async()=>cache,match:async(request:Request)=>older.get(key(request))?.clone()},self:{registration:{scope:origin+'/'},addEventListener:(name:string,fn:Function)=>listeners.set(name,fn),clients:{matchAll:async()=>[],claim:async()=>{}},skipWaiting:async()=>{}}};
  vm.runInNewContext(source.replace('/*PRECACHE*/[]',JSON.stringify([origin+'/chunk'])).replace('/*FILES*/[]',JSON.stringify(files)),context);
  return {
    request(path:string):Promise<Response>{let result:Promise<Response>;listeners.get('fetch')!({request:new Request(origin+path),respondWith:(promise:Promise<Response>)=>result=promise});return result!;},
    install():Promise<void>{let result:Promise<void>;listeners.get('install')!({waitUntil:(promise:Promise<void>)=>result=promise});return result!;},
  };
}

test('offline runtime returns EOF for the first absent numbered WASM chunk',async()=>{
  const path='/_framework/dotnet.native.build.wasm';
  const sw=worker(new Map([[origin+path+'0',new Response('wasm')]]));
  assert.equal(await (await sw.request(path+'0')).text(),'wasm');
  assert.equal((await sw.request(path+'1')).status,404);
});

test('an open game can read assets retained from the previous build offline',async()=>{
  const sw=worker(new Map(),new Map([[origin+'/old.js',new Response('previous build')]]));
  const response=await sw.request('/old.js');
  assert.equal(await response.text(),'previous build');
  assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'),'require-corp');
});

test('installation retries a failed download and resumes completed cache entries',async()=>{
  const cache=new Map<string,Response>();
  let calls=0;
  const network=async()=>{if(++calls===1)throw new Error('interrupted');return new Response('complete');};
  await worker(cache,new Map(),network).install();
  assert.equal(calls,2);
  assert.equal(await cache.get(origin+'/chunk')!.clone().text(),'complete');
  await worker(cache,new Map(),network).install();
  assert.equal(calls,2);
});



function file(path:string,body:string) {
  return {path:origin+path,size:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex')};
}
test('known uncached WASM chunk is lazy, deduplicated, and retained offline',async()=>{
  const path='/_framework/dotnet.native.build.wasm0', cache=new Map<string,Response>();
  let calls=0;
  const sw=worker(cache,new Map(),async()=>{calls++;return new Response('wasm');},[file(path,'wasm')]);
  await Promise.all([sw.request(path),sw.request(path)]);
  assert.equal(calls,1);
  assert.equal(await (await worker(cache).request(path)).text(),'wasm');
  assert.equal((await sw.request(path.replace('wasm0','wasm1'))).status,404);
});
test('lazy chunks are absent after shell install and not reported as EOF when offline',async()=>{
  const path='/_framework/dotnet.native.build.wasm0',cache=new Map<string,Response>(), requests:string[]=[];
  const sw=worker(cache,new Map(),async request=>{requests.push((request as Request).url);return new Response('shell');},[file(path,'wasm')]);
  await sw.install();
  assert.deepEqual(requests,[origin+'/chunk']);
  assert.equal(cache.has(origin+path),false);
  await assert.rejects(worker(cache,new Map(),undefined,[file(path,'wasm')]).request(path),/offline/);
});
test('corrupt or truncated resources are retried but never published',async()=>{
  const path='/_framework/dotnet.native.build.wasm0', cache=new Map<string,Response>();
  let calls=0;
  const sw=worker(cache,new Map(),async()=>{calls++;return new Response('bad!');},[file(path,'wasm')]);
  await assert.rejects(sw.request(path),/integrity/);
  assert.equal(calls,3);assert.equal(cache.has(origin+path),false);
  await assert.rejects(worker(cache,new Map(),async()=>new Response('x'),[file(path,'wasm')]).request(path),/Incomplete/);
});
test('auth helper retains popup-compatible headers',async()=>{
  const response=await worker(new Map([[origin+'/drive-auth.html',new Response('auth')]])).request('/drive-auth.html');
  assert.equal(response.headers.get('Cross-Origin-Opener-Policy'),'same-origin-allow-popups');
  assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'),'unsafe-none');
});

test('current manifest never silently serves an older version at the same URL',async()=>{
  const path='/_framework/shared.wasm';
  const sw=worker(new Map(),new Map([[origin+path,new Response('old')]]),async()=>new Response('new'),[file(path,'new')]);
  assert.equal(await (await sw.request(path)).text(),'new');
});
