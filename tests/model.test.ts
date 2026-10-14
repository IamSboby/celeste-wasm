import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safePath, tips, assertInstallation, localPath, remotePath, CONTENT_DIRS, type Revision } from '../frontend/src/cloud/model.ts';
import { GoogleDriveClient } from '../frontend/src/cloud/drive.ts';
test('rejects traversal and invalid OPFS paths',()=>{
  for(const path of ['../Saves/a','/a','a//b','a/./b','a\\b','a/..','a\0b']) assert.throws(()=>safePath(path));
  assert.equal(safePath('Saves/1.celeste'),'Saves/1.celeste');
});
test('maps runtime saves and mods without changing remote layout',()=>{
  assert.equal(localPath('Saves/0.celeste'),'Celeste/Saves/0.celeste');
  assert.equal(remotePath('Celeste/Mods/a.zip'),'Mods/a.zip');
  assert.equal(localPath('Content/Maps/a.bin'),'Content/Maps/a.bin');
});
test('concurrent device revisions remain independent until explicitly merged',()=>{
  const revisions=[{id:'a',parents:['base']},{id:'b',parents:['base']}] as Revision[];
  assert.deepEqual(tips(revisions).map(r=>r.id),['a','b']);
  assert.deepEqual(tips([...revisions,{id:'merge',parents:['a','b']} as Revision]).map(r=>r.id),['merge']);
});
test('incomplete installation cannot start',()=>{
  assert.throws(()=>assertInstallation(['Celeste.exe']));
  assertInstallation(['orig/Celeste.exe',...CONTENT_DIRS.map(d=>`Content/${d}/data`)]);
});
test('client never sends bearer credentials to a proxy or untrusted session URL',async()=>{
  let called=false;
  const drive=new GoogleDriveClient(()=> 'private-token',async()=>{called=true;return new Response('{}');});
  await assert.rejects(drive.fetch('https://example.com/upload'),/Unexpected/);
  assert.equal(called,false);
});
test('Drive listing follows pagination and rejects incomplete search',async()=>{
  let n=0;
  const drive=new GoogleDriveClient(()=> 'token',async()=>new Response(JSON.stringify(++n===1 ? {files:[{id:'a'}],nextPageToken:'next'} : {files:[{id:'b'}]})));
  assert.equal((await drive.list("'root' in parents")).length,2);
  const bad=new GoogleDriveClient(()=> 'token',async()=>new Response(JSON.stringify({incompleteSearch:true,files:[]})));
  await assert.rejects(bad.list("'root' in parents"),/incomplete/);
});
