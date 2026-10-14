import { SyncEngine } from '../src/cloud/engine';
import { LocalFileManifest } from '../src/cloud/local';
import { DriveError } from '../src/cloud/drive';
import { CONTENT_DIRS, type RemoteFile, type Revision } from '../src/cloud/model';
class MockDrive {
  files:RemoteFile[]=[]; blobs=new Map<string,Blob>(); records:Revision[]=[]; downloads=0; uploads=0; failCommit=false;
  sessions=new Map<string,{id:string;parts:Blob[];size:number}>();
  constructor(private local:LocalFileManifest){}
  async add(path:string,text:string|Blob) {
    const body=typeof text==='string' ? new Blob([text]) : text;
    const id=crypto.randomUUID();this.blobs.set(id,body);
    this.files.push({id,path,name:path.split('/').pop()!,mimeType:'application/octet-stream',size:String(body.size),version:'1',sha256Checksum:await this.local.hash(body)});
  }
  async manifest(){return {files:structuredClone(this.files),journals:['journal']};}
  async revisions(){return structuredClone(this.records);}
  async newId(){return crypto.randomUUID();}
  async createFolder(){return 'journal';}
  async content(id:string,start=0){this.downloads++;const blob=this.blobs.get(id);if(!blob)throw new DriveError(404,'Missing');return new Response(blob.slice(start),{status:start?206:200,headers:start?{'Content-Range':`bytes ${start}-${blob.size-1}/${blob.size}`}:{}});}
  async metadata(id:string){
    const source=this.files.find(f=>f.id===id);if(source)return {...source};
    const blob=this.blobs.get(id);if(!blob)throw new DriveError(404,'Missing');
    return {id,size:String(blob.size),sha256Checksum:await this.local.hash(blob)};
  }
  async startUpload(id:string,_p:string,_n:string,size:number){const session=crypto.randomUUID();this.sessions.set(session,{id,parts:[],size});return session;}
  async uploadOffset(session:string){const s=this.sessions.get(session)!;return s.parts.reduce((n,b)=>n+b.size,0);}
  async uploadChunk(session:string,blob:Blob,_offset:number,total:number){
    this.uploads++;const s=this.sessions.get(session)!;s.parts.push(new Blob([await blob.arrayBuffer()]));const all=new Blob(s.parts);
    if(all.size===total){this.blobs.set(s.id,all);return new Response('{}',{status:200});}
    return new Response(null,{status:308,headers:{Range:`bytes=0-${all.size-1}`}});
  }
  async commit(_p:string,_id:string,r:Revision){if(this.failCommit)throw new Error('Disconnected');if(!this.records.some(x=>x.id===r.id))this.records.push(structuredClone(r));}
}
export async function scenario(name:string) {
  const root=await (await navigator.storage.getDirectory()).getDirectoryHandle(crypto.randomUUID(),{create:true});
  const local=new LocalFileManifest(root);const drive=new MockDrive(local);
  await drive.add('Celeste.exe','FNA assembly fixture');
  for(const dir of CONTENT_DIRS)await drive.add(`Content/${dir}/data`,'asset');
  await drive.add('Saves/0.celeste','save-one');
  const make=async(l=local)=>{const e=new SyncEngine(l,drive as any,'account','folder',()=>{});await e.init();return e;};
  let engine=await make();await engine.sync(true,false);
  const read=async(l=local)=> (await l.file('Celeste/Saves/0.celeste'))?.text();
  if(name==='initial-incremental'){
    const count=drive.downloads;await engine.sync(true,false);
    return {ready:engine.state.ready,save:await read(),extraDownloads:drive.downloads-count};
  }
  if(name==='offline-recovery'){
    await local.write('Celeste/Saves/0.celeste','offline-progress');await engine.sync(false,false);
    const queued=Object.keys(engine.state.queue).length;engine=await make();await engine.sync(true,false);
    return {queued,pending:Object.keys(engine.state.queue).length,save:await read(),remote:drive.records.length};
  }
  if(name==='two-devices'){
    const rootB=await (await navigator.storage.getDirectory()).getDirectoryHandle(crypto.randomUUID(),{create:true});
    const b=new LocalFileManifest(rootB);const second=await make(b);await second.sync(true,false);
    await local.write('Celeste/Saves/0.celeste','A-progress');await engine.sync(true,false);
    await second.sync(true,false);
    return {save:await read(b),records:drive.records.length};
  }
  if(name==='conflict'){
    const rootB=await (await navigator.storage.getDirectory()).getDirectoryHandle(crypto.randomUUID(),{create:true});
    const b=new LocalFileManifest(rootB);const second=await make(b);await second.sync(true,false);
    await local.write('Celeste/Saves/0.celeste','A-progress');await engine.sync(true,false);
    await b.write('Celeste/Saves/0.celeste','B-progress');await second.sync(true,false);
    const conflicts=[...second.progress.conflicts];await second.resolve('Saves/0.celeste','local');
    await engine.sync(true,false);
    return {conflicts,a:await read(),b:await read(b),records:drive.records.length};
  }
  if(name==='new-delete'){
    await local.write('Celeste/Mods/new.zip','new mod');await engine.sync(true,false);
    await local.remove('Celeste/Saves/0.celeste');await engine.sync(true,false);
    engine=await make();await engine.sync(true,false);
    return {records:drive.records.map(r=>({path:r.path,deleted:r.deleted})),save:await read()};
  }
  if(name==='lost-response'){
    await local.write('Celeste/Saves/0.celeste','save-two');drive.failCommit=true;
    await engine.sync(true,false).catch(()=>{});const uploads=drive.uploads;
    engine=await make();drive.failCommit=false;await engine.sync(true,false);
    return {records:drive.records.length,extraUploads:drive.uploads-uploads,pending:Object.keys(engine.state.queue).length};
  }
  if(name==='large'){
    const bytes=new Uint8Array(9*1024*1024);bytes.fill(97);await local.write('Celeste/Mods/large.zip',new Blob([bytes]));await engine.sync(true,false);
    const r=drive.records.find(r=>r.path==='Mods/large.zip')!;
    return {size:r.size,uploads:drive.uploads,hash:r.hash,actual:await local.hash(drive.blobs.get(r.blob!)!)};
  }
  if(name==='account-isolation'){
    const wrong=new SyncEngine(local,drive as any,'other-account','folder',()=>{});
    let error='';try{await wrong.init();}catch(e){error=(e as Error).message;}
    return {error,save:await read()};
  }
  if(name==='offline-corruption'){
    await engine.validateOffline();await local.write('Content/Maps/data','bad');
    let error='';try{await engine.validateOffline();}catch(e){error=(e as Error).message;}
    return {error};
  }
  throw new Error('Unknown scenario');
}
