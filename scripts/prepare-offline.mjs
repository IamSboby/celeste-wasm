import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../frontend/dist/',import.meta.url);
async function walk(dir='') {
  const paths=[];
  for(const f of await readdir(new URL(dir,root),{withFileTypes:true})) {
    const path=dir+f.name;
    if(f.isDirectory()) paths.push(...await walk(path+'/'));
    else if(!['cloud-sw.js','_headers','.nojekyll','runtime-manifest.json'].includes(path)) paths.push('./'+path);
  }
  return paths;
}
const paths=(await walk()).sort();
const files=[];
for(const path of paths) {
  const bytes=await readFile(new URL(path,root));
  files.push({path,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
// Framework files are fetched atomically on demand; no claim of per-room game streaming.
const shell=['./',...paths.filter(path=>!path.startsWith('./_framework/'))];
const manifest=JSON.stringify({schema:1,files,shell});
const hash=createHash('sha256').update(manifest).digest('hex').slice(0,16);
const sw=await readFile(new URL('cloud-sw.js',root),'utf8');
await writeFile(new URL('cloud-sw.js',root),sw.replace('__BUILD_ID__',hash).replace('/*PRECACHE*/[]',JSON.stringify(shell)).replace('/*FILES*/[]',JSON.stringify(files)));
await writeFile(new URL('runtime-manifest.json',root),manifest);
await writeFile(new URL('.nojekyll',root),'');
console.log(JSON.stringify({resources:files.length,shellResources:shell.length,totalBytes:files.reduce((n,f)=>n+f.size,0),shellBytes:files.filter(f=>shell.includes(f.path)).reduce((n,f)=>n+f.size,0)}));
