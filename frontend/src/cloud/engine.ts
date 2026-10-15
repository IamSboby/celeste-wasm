import { GoogleDriveClient, DriveError, sleep } from "./drive";
import { LocalFileManifest } from "./local";
import { writerState } from "./writer-state";
import { assertInstallation, fingerprint, initialProgress, localPath, managed, remotePath, tips, type Pending, type Progress, type RemoteFile, type Revision, type SyncState } from "./model";

type Head = {revision: string; base: string; id?: string; hash?: string; md5?: string; size: number; deleted: boolean};
export class SyncEngine {
  state: SyncState;
  progress = initialProgress();
  playing = false;
  mounted = false;
  busy = false;
  automatic = true;
  concurrency = 3;
  private sources = new Map<string, RemoteFile>();
  private revisions: Revision[] = [];
  private journals: string[] = [];
  private conflictHeads = new Map<string, Head[]>();
  private started = 0;
  private observed = new Map<string, string>();
  private writes = Promise.resolve();
  constructor(public local: LocalFileManifest, public drive: GoogleDriveClient, account: string, folder: string, private notify: (p: Progress) => void) {
    this.state = {schema:1, account, folder, baselines:{}, queue:{}, ready:false};
  }
  async init() {
    const saved = await this.local.readJSON<SyncState>(".cloud/state.json");
    if (saved) {
      if (saved.schema !== 1 || saved.account !== this.state.account || saved.folder !== this.state.folder) throw new Error("Replica identity mismatch; refusing to synchronize");
      this.state = saved;
    }
    this.emit();
  }
  private async persist() {
    this.writes = this.writes.catch(() => {}).then(() => this.local.saveJSON(".cloud/state.json", this.state));
    await this.writes;
  }
  private emit(update: Partial<Progress> = {}) {
    Object.assign(this.progress, update, {pending:Object.keys(this.state.queue), lastSync:this.state.lastSync});
    this.notify({...this.progress});
  }
  private heads(path: string): Head[] {
    const source = this.sources.get(path), base = fingerprint(source);
    const rs = this.revisions.filter(r => r.path === path);
    const leaves = tips(rs);
    const heads: Head[] = leaves.map(r => ({revision:r.id, base:r.base, id:r.blob, hash:r.hash, size:r.size, deleted:r.deleted}));
    // External desktop changes are independent heads, never silently hidden by cloud revisions.
    if (!leaves.length || leaves.some(r => r.base !== base)) heads.push({revision:base, base, id:source?.id, hash:source?.sha256Checksum, md5:source?.md5Checksum, size:Number(source?.size || 0), deleted:!source});
    return heads;
  }
  async refresh() {
    const manifest = await this.drive.manifest(this.state.folder);
    const mapped = new Set<string>();
    this.sources.clear();
    for (const file of manifest.files) {
      if (!managed(localPath(file.path))) continue;
      const path = localPath(file.path);
      if (mapped.has(path)) throw new Error(`Ambiguous installation layout: ${path}`);
      mapped.add(path); this.sources.set(file.path, file);
    }
    this.journals = manifest.journals;
    this.revisions = await this.drive.revisions(this.journals);
    for (const r of this.revisions) if (!managed(localPath(r.path))) throw new Error(`Reserved path in sync journal: ${r.path}`);
  }
  private async journal() {
    if (!this.journals.length) this.journals.push(await this.drive.createFolder(this.state.folder, ".webleste-sync-v1"));
    // Concurrent first-use folder creation is harmless: refresh reads all journals.
    return this.journals[0];
  }
  private pathFor(local: string) {
    return [...this.sources.keys(), ...Object.keys(this.state.baselines)].find(p => localPath(p) === local) || remotePath(local);
  }
  async scan(settle = true) {
    const files = await this.local.list();
    const paths = new Set([...files.keys()].filter(managed));
    for (const path of Object.keys(this.state.baselines)) paths.add(localPath(path));
    for (const local of paths) {
      if (local === "Celeste.exe" && (await this.local.file("orig/Celeste.exe"))) continue; // Derived patch input.
      const path = this.pathFor(local), file = files.get(local), baseline = this.state.baselines[path];
      if (!baseline && !file) continue;
      if (this.state.queue[path]) continue; // Preserve the persisted snapshot until acknowledged.
      const signature = file ? `${file.size}:${file.lastModified}` : "deleted";
      if (settle && this.observed.get(local) !== signature) { this.observed.set(local, signature); continue; }
      if (baseline && file && file.size === baseline.size && file.lastModified === baseline.modified) continue;
      const writerBefore = this.playing ? await writerState(this.local.root.name) : undefined;
      if (writerBefore?.active.some(p => p.endsWith("/"+local))) continue;
      let hash = file ? await this.local.hash(file) : "";
      if (baseline && hash === baseline.hash) {
        if (file) baseline.modified = file.lastModified;
        continue;
      }
      // Initial remote downloads have no baseline yet; they are reconciled by sync().
      if (!baseline && !this.state.ready) continue;
      const id = crypto.randomUUID(); const snapshot = file ? `.cloud/pending/${id}` : undefined;
      if (file && snapshot) {
        // File snapshots become unreadable if concurrently modified. Check both the
        // source and copied bytes; failed snapshots never enter the durable queue.
        try {
          await file.stream().pipeTo(await (await this.local.handle(snapshot, true)).createWritable());
          const after = await this.local.file(local);
          const copy = await this.local.file(snapshot);
          if (!after || !copy || after.lastModified !== file.lastModified || after.size !== file.size || await this.local.hash(copy) !== hash || await this.local.hash(after) !== hash) {
            await this.local.remove(snapshot); continue;
          }
        } catch (e) {
          await this.local.remove(snapshot).catch(() => {});
          if (["NotReadableError", "InvalidStateError", "NotFoundError"].includes((e as Error).name)) continue;
          throw e;
        }
      }
      const pending: Pending = {schema:1, id, path, parents:baseline ? [baseline.revision] : [], base:baseline?.base || "absent", snapshot, hash, size:file?.size || 0, deleted:!file, time:new Date().toISOString()};
      if (writerBefore) {
        const after = await writerState(this.local.root.name);
        if (after.epoch !== writerBefore.epoch || after.active.some(p=>p.endsWith("/"+local))) {
          if(snapshot) await this.local.remove(snapshot); continue;
        }
      }
      this.state.queue[path] = pending;
      await this.persist();
      this.emit({status:"Pending Changes"});
    }
    await this.persist();
  }
  private async download(path: string, head: Head) {
    const dest = localPath(path);
    if (head.deleted) {
      // Retain an OPFS backup even for uncontested remote deletions.
      if (await this.local.file(dest)) await this.local.copy(dest, `.cloud/backups/${crypto.randomUUID()}`);
      await this.local.remove(dest);
      this.state.baselines[path] = {revision:head.revision, base:head.base, hash:"", size:0, modified:0};
      await this.persist(); return;
    }
    if (!head.id) throw new Error(`Missing remote content: ${path}`);
    const key = await this.local.hash(new Blob([path]));
    const temp = `.cloud/downloads/${key}`;
    const metaPath = `${temp}.json`;
    const old = await this.local.readJSON<{revision:string}>(metaPath);
    if (old?.revision !== head.revision) { await this.local.remove(temp); await this.local.saveJSON(metaPath, {revision:head.revision}); }
    let offset = (await this.local.file(temp))?.size || 0;
    if (offset > head.size) { await this.local.remove(temp); offset = 0; }
    this.emit({current:path});
    for (let attempt = 0; offset < head.size || !(await this.local.file(temp)); attempt++) {
      if (attempt > 4) throw new Error(`Download interrupted: ${path}. Retry to resume.`);
      try {
        const response = await this.drive.content(head.id, offset);
        if (!response.body) throw new Error("Empty download response");
        if (offset && response.status !== 206) { offset = 0; await this.local.remove(temp); }
        if (response.status === 206 && !response.headers.get("Content-Range")?.startsWith(`bytes ${offset}-`)) throw new Error("Invalid download range");
        const reader = response.body.getReader();
        // Commit bounded chunks to the staging file so a reload can resume them.
        let writer = await (await this.local.handle(temp, true)).createWritable({keepExistingData:true});
        await writer.seek(offset); let checkpoint = offset;
        try {
          while (true) {
            const {done,value} = await reader.read(); if (done) break;
            if (offset + value.length > head.size) throw new Error("Remote size changed during download");
            await writer.write(value); offset += value.length;
            this.progress.bytes += value.length;
            this.emit({speed:this.progress.bytes / Math.max(1,(Date.now() - this.started)/1000)});
            if (offset - checkpoint >= 4 * 1024 * 1024) {
              await writer.close(); checkpoint = offset;
              writer = await (await this.local.handle(temp, true)).createWritable({keepExistingData:true}); await writer.seek(offset);
            }
          }
          await writer.close();
          if (offset !== head.size) throw new Error("Truncated download");
        } catch (e) { await writer.abort().catch(() => {}); throw e; }
        finally { await reader.cancel().catch(() => {}); }
      } catch (e) {
        offset = (await this.local.file(temp))?.size || 0;
        if (e instanceof DriveError && ![429,500,502,503,504].includes(e.status)) throw e;
        if ((e as Error).name === "QuotaExceededError") throw new Error("Not enough browser storage. Free space and retry; local saves are retained.");
        if (attempt === 4) throw e;
        this.emit({message:`Retrying ${path} from ${offset} bytes`}); await sleep(500 * 2 ** attempt);
      }
    }
    const file = (await this.local.file(temp))!;
    const hash = await this.local.hash(file);
    if ((head.hash && hash !== head.hash) || (head.md5 && await this.local.hash(file,true) !== head.md5)) {
      await this.local.remove(temp); throw new Error(`Integrity check failed: ${path}; retry to download again`);
    }
    if (!head.hash && !head.md5) throw new Error(`Drive provides no integrity checksum for ${path}`);
    // Recheck source generation after streaming before replacing the local replica.
    if (head.revision.startsWith("drive:") && fingerprint(await this.drive.metadata(head.id)) !== head.revision) throw new Error(`Drive changed ${path} during download; retry`);
    if (await this.local.file(dest)) await this.local.copy(dest, `.cloud/backups/${crypto.randomUUID()}`);
    await this.local.copy(temp,dest);
    const installed = (await this.local.file(dest))!;
    this.state.baselines[path] = {revision:head.revision, base:head.base, hash, size:file.size, modified:installed.lastModified};
    await this.persist(); // Commit baseline only after atomic writable.close().
    await this.local.remove(temp); await this.local.remove(metaPath);
  }
  private async upload(p: Pending) {
    const parent = await this.journal();
    if (!p.deleted) {
      const file = p.snapshot && await this.local.file(p.snapshot);
      if (!file || file.size !== p.size || await this.local.hash(file) !== p.hash) throw new Error(`Pending snapshot is missing or corrupt: ${p.path}`);
      p.blob ||= await this.drive.newId(); await this.persist();
      let complete = false;
      try {
        const existing = await this.drive.metadata(p.blob);
        if (Number(existing.size) !== p.size || existing.sha256Checksum !== p.hash) throw new Error("Uploaded blob checksum mismatch");
        complete = true;
      } catch (e) { if (!(e instanceof DriveError) || e.status !== 404) throw e; }
      if (!complete) {
        let offset = 0;
        if (p.session) {
          try { offset = await this.drive.uploadOffset(p.session,p.size); }
          catch (e) { if (e instanceof DriveError && [404,410].includes(e.status)) p.session = undefined; else throw e; }
        }
        if (!p.session) { p.session = await this.drive.startUpload(p.blob,parent,`${p.id}.blob`,p.size,"application/octet-stream"); await this.persist(); }
        while (offset < p.size || p.size === 0) {
          const end = Math.min(offset + 4 * 1024 * 1024,p.size);
          const response = await this.drive.uploadChunk(p.session,file.slice(offset,end),offset,p.size);
          if (response.status !== 308) { offset = p.size; break; }
          const next = Number(response.headers.get("Range")?.match(/-(\d+)$/)?.[1] ?? -1) + 1;
          if (next <= offset || next > end) throw new Error("Invalid upload acknowledgement"); offset = next;
        }
        const uploaded = await this.drive.metadata(p.blob);
        if (uploaded.sha256Checksum !== p.hash || Number(uploaded.size) !== p.size) throw new Error("Uploaded blob integrity check failed");
      }
    }
    p.uploadId ||= await this.drive.newId(); await this.persist();
    const {snapshot:_snapshot, session:_session, uploadId:_uploadId, ...revision} = p;
    await this.drive.commit(parent,p.uploadId,revision);
    this.revisions.push(revision);
    const local = await this.local.file(localPath(p.path));
    // Do not acknowledge newer local writes with the hash of an older snapshot.
    this.state.baselines[p.path] = {revision:p.id, base:p.base, hash:p.hash || "", size:p.size, modified:local && await this.local.hash(local) === p.hash ? local.lastModified : -1};
    delete this.state.queue[p.path];
    this.state.lastSync = new Date().toISOString(); await this.persist();
    if (p.snapshot) await this.local.remove(p.snapshot);
  }
  async sync(online = true, settle = true) {
    if (this.busy) return;
    this.busy = true; this.started = Date.now();
    try {
      await this.scan(settle);
      if (!online) { this.emit({status:"Offline",message:"Local changes retained. Reconnect to synchronize."}); return; }
      this.emit({status:"Syncing",message:"Indexing Google Drive",bytes:0,done:0});
      await this.refresh();
      const paths = new Set([...this.sources.keys(), ...this.revisions.map(r => r.path), ...Object.keys(this.state.baselines), ...Object.keys(this.state.queue)]);
      const downloads: [string,Head][] = [];
      this.conflictHeads.clear();
      for (const path of paths) {
        const hs = this.heads(path), baseline = this.state.baselines[path], pending = this.state.queue[path];
        if (hs.length !== 1 || (pending && hs[0].revision !== pending.id && !pending.parents.includes(hs[0].revision) && !(hs[0].deleted && !baseline))) { this.conflictHeads.set(path,hs); continue; }
        const head = hs[0];
        if (pending) { await this.upload(pending); continue; }
        if (baseline?.revision === head.revision) {
          // Hash verification at startup catches corruption even with unchanged metadata.
          if (!this.state.ready || !settle) {
            const f = await this.local.file(localPath(path));
            if (!head.deleted && (!f || await this.local.hash(f) !== baseline.hash)) downloads.push([path,head]);
          }
          continue;
        }
        if (this.mounted) continue; // WASMFS caches directory entries; apply downloads before mounting.
        const local = await this.local.file(localPath(path));
        if (!baseline && local) {
          const hash = await this.local.hash(local);
          const same = head.hash ? hash === head.hash : head.md5 ? await this.local.hash(local,true) === head.md5 : false;
          if (!same) { this.conflictHeads.set(path,hs); continue; }
        }
        downloads.push([path,head]);
      }
      const bytes = downloads.reduce((n,[,h]) => n+h.size,0);
      if (!this.mounted && downloads.length) {
        this.state.ready = false; await this.persist();
        assertInstallation([...paths].filter(p=>this.heads(p).some(h=>!h.deleted)).map(localPath));
      }
      const estimate = await navigator.storage.estimate();
      if (estimate.quota && estimate.usage !== undefined && estimate.quota-estimate.usage < bytes * 2) throw new Error("Insufficient browser storage for downloads, staging and backups");
      this.emit({total:paths.size,done:paths.size-downloads.length,totalBytes:bytes,message:this.playing ? "Local changes synchronized; remote updates apply before the next launch" : "Downloading and verifying files"});
      let cursor = 0;
      const workers = Array.from({length:Math.max(1,Math.min(6,this.concurrency))},async () => {
        while (cursor < downloads.length) {
          const [path,head] = downloads[cursor++]; await this.download(path,head);
          this.emit({done:this.progress.done+1});
        }
      });
      const results = await Promise.allSettled(workers);
      for (const r of results) if (r.status === "rejected") throw r.reason;
      // Catch writes that raced with our publications, preserving both immutable tips.
      this.revisions = await this.drive.revisions(this.journals);
      for (const path of paths) if (this.heads(path).length > 1) this.conflictHeads.set(path,this.heads(path));
      this.emit({conflicts:[...this.conflictHeads.keys()]});
      if (this.conflictHeads.size) { this.emit({status:"Conflict Detected",message:"Both versions retained. Resolve conflicts in Google Drive Sync."}); return; }
      if (!this.playing) {
        const local = await this.local.list(); assertInstallation([...local.keys()]);
        this.state.ready = true; await this.persist();
      }
      this.emit({status:Object.keys(this.state.queue).length ? "Pending Changes" : "Synced",message:"Synchronization complete"});
    } catch (e) {
      this.emit({status:online ? "Sync Error" : "Offline",message:(e as Error).message}); throw e;
    } finally { this.busy = false; }
  }
  async resolve(path: string, choice: "local" | "remote") {
    if (this.busy || this.playing) throw new Error("Stop the game before resolving conflicts");
    await this.refresh(); const hs = this.heads(path);
    const previous = this.state.queue[path];
    if (previous?.snapshot) await this.local.copy(previous.snapshot,`.cloud/backups/${previous.id}`);
    if (choice === "remote" && hs.length !== 1) throw new Error("Several remote versions exist. Download the desired revision in Drive and use the local file browser to install it, then choose Keep local.");
    // All discarded tips remain recoverable in Drive. A merge record acknowledges them.
    if (choice === "remote") {
      const old = this.state.queue[path];
      if (old?.snapshot) await this.local.copy(old.snapshot,`.cloud/backups/${old.id}`);
      delete this.state.queue[path]; await this.persist();
      await this.download(path,hs[0]);
    }
    const file = await this.local.file(localPath(path)), id = crypto.randomUUID();
    const snapshot = file ? `.cloud/pending/${id}` : undefined;
    if (snapshot) await this.local.copy(localPath(path),snapshot);
    const p: Pending = {schema:1,id,path,parents:hs.map(h=>h.revision),base:fingerprint(this.sources.get(path)),size:file?.size || 0,hash:file ? await this.local.hash(file) : "",deleted:!file,snapshot,time:new Date().toISOString()};
    this.state.queue[path] = p; await this.persist();
    await this.upload(p); await this.sync();
  }
  async validateOffline() {
    if (!this.state.ready) throw new Error("Complete initial synchronization before playing offline");
    const files = await this.local.list(); assertInstallation([...files.keys()]);
    for (const [path,b] of Object.entries(this.state.baselines)) {
      if (path === "Celeste.exe" && files.has("orig/Celeste.exe")) continue;
      if (!path.startsWith("Content/") && !["Celeste.exe","orig/Celeste.exe","Celeste.dll"].includes(path)) continue;
      const file = files.get(localPath(path));
      if (!file || await this.local.hash(file) !== b.hash) throw new Error(`Offline integrity check failed: ${path}`);
    }
  }
  async prepareSource() {
    await this.validateOffline();
    // Match upstream's preference for the original unmodified FNA executable.
    if (!this.mounted) {
      if (await this.local.file("orig/Celeste.exe")) await this.local.copy("orig/Celeste.exe","Celeste.exe");
      await this.local.write(".ContentExists","");
    }
    const source = (await this.local.file("orig/Celeste.exe")) || (await this.local.file("Celeste.dll")) || (await this.local.file("Celeste.exe"));
    if (!source) throw new Error("Missing Celeste assembly");
    return await this.local.hash(source);
  }
  async markPrepared(hash: string) { this.state.prepared = hash; await this.persist(); }
}
