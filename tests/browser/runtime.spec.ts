import {test,expect} from '@playwright/test';
import {createServer,Server} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

let server:Server, origin:string;
const requests:string[]=[];
const chunk=Buffer.alloc(20*1024*1024,0x61);
const path='/_framework/dotnet.native.fixture.wasm0';
test.beforeAll(async()=>{
  const source=await readFile(new URL('../../frontend/public/cloud-sw.js',import.meta.url),'utf8');
  const files=[{path,size:chunk.length,sha256:createHash('sha256').update(chunk).digest('hex')}];
  const sw=source.replace('__BUILD_ID__','browser-fixture').replace('/*PRECACHE*/[]','["/"]')
    .replace('/*FILES*/[]',JSON.stringify(files));
  server=createServer((req,res)=>{
    requests.push(req.url!);
    if(req.url==='/cloud-sw.js') {res.setHeader('Content-Type','text/javascript');res.end(sw);}
    else if(req.url===path) {res.setHeader('Content-Type','application/wasm');res.end(chunk);}
    else if(req.url==='/') {res.setHeader('Content-Type','text/html');res.end('<title>Runtime fixture</title>');}
    else {res.statusCode=404;res.end();}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
});
test.afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));});
async function start(page:any) {
  await page.goto(origin);
  await page.evaluate(async()=>{
    await navigator.serviceWorker.register('/cloud-sw.js');
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller) await new Promise<void>(r=>navigator.serviceWorker.addEventListener('controllerchange',()=>r(),{once:true}));
  });
}
test('real Service Worker lazily caches a 20 MiB chunk and preserves offline EOF',async({page,context})=>{
  requests.length=0;
  await start(page);
  expect(requests.filter(p=>p===path)).toHaveLength(0);
  const sizes=await page.evaluate(async path=>Promise.all([1,2].map(async()=> (await (await fetch(path)).arrayBuffer()).byteLength)),path);
  expect(sizes).toEqual([chunk.length,chunk.length]);
  expect(requests.filter(p=>p===path)).toHaveLength(1);
  await context.setOffline(true);
  const offline=await page.evaluate(async path=>({
    bytes:(await (await fetch(path)).arrayBuffer()).byteLength,
    eof:(await fetch(path.replace('wasm0','wasm1'))).status
  }),path);
  expect(offline).toEqual({bytes:chunk.length,eof:404});
});
test('explicit complete runtime download populates lazy files before going offline',async({page,context})=>{
  await start(page);
  const result=await page.evaluate(()=>new Promise(resolve=>{
    const channel=new MessageChannel();
    channel.port1.onmessage=e=>{channel.port1.close();resolve(e.data);};
    navigator.serviceWorker.controller!.postMessage({type:'runtime-download-all'},[channel.port2]);
  }));
  expect(result).toEqual({ok:true});
  await context.setOffline(true);
  expect(await page.evaluate(async path=>(await (await fetch(path)).arrayBuffer()).byteLength,path)).toBe(chunk.length);
});
