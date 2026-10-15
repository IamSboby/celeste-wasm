import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../frontend/public/cloud-sw.js',import.meta.url),'utf8');
const origin='https://example.test';
function worker(current:Map<string,Response>,older=new Map<string,Response>(),network=async(_request:unknown):Promise<Response>=>{throw new Error('offline');}) {
  const listeners=new Map<string,Function>();
  const key=(request:Request|string)=>typeof request==='string'?request:request.url;
  const cache={match:async(request:Request|string)=>current.get(key(request))?.clone(),put:async(request:Request|string,response:Response)=>{current.set(key(request),response);}};
  const context={URL,Request,Response,Headers,location:{origin},fetch:network,caches:{open:async()=>cache,match:async(request:Request)=>older.get(key(request))?.clone()},self:{addEventListener:(name:string,fn:Function)=>listeners.set(name,fn),clients:{matchAll:async()=>[],claim:async()=>{}},skipWaiting:async()=>{}}};
  vm.runInNewContext(source.replace('/*PRECACHE*/[]',JSON.stringify([origin+'/chunk'])),context);
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

