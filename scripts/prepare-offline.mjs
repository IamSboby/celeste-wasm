import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../frontend/dist/',import.meta.url);
async function walk(dir='') {
  const paths=[];
  for(const f of await readdir(new URL(dir,root),{withFileTypes:true})) {
    const path=dir+f.name;
    if(f.isDirectory()) paths.push(...await walk(path+'/'));
    else if(!['cloud-sw.js','_headers','.nojekyll'].includes(path)) paths.push('./'+path);
  }
  return paths;
}
const paths=await walk();
const hash=createHash('sha256');
for(const path of paths.sort()) hash.update(await readFile(new URL(path,root)));
const sw=await readFile(new URL('cloud-sw.js',root),'utf8');
await writeFile(new URL('cloud-sw.js',root),sw.replace('__BUILD_ID__',hash.digest('hex').slice(0,16)).replace('/*PRECACHE*/[]',JSON.stringify(['./',...paths])));
await writeFile(new URL('.nojekyll',root),'');
console.log(`Offline manifest: ${paths.length} resources`);
