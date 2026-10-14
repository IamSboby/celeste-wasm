import { JOURNAL, safePath, type RemoteFile, type Revision } from "./model";
const API = "https://www.googleapis.com/drive/v3";
const fields = "id,name,mimeType,size,modifiedTime,version,md5Checksum,sha256Checksum";
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export class DriveError extends Error { constructor(public status: number, message: string) { super(message); } }
export class GoogleDriveClient {
  constructor(private token: () => string, private request: typeof fetch = fetch.bind(globalThis)) {}
  async fetch(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
    // Never send OAuth tokens through Webleste's general-purpose Wisp fallback.
    if (new URL(url).origin !== "https://www.googleapis.com") throw new Error("Unexpected Drive endpoint");
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.request(url, {...init, redirect: "error", headers: {...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${this.token()}`}});
      } catch (e) {
        if (!retry || attempt >= 4) throw e;
        await sleep(Math.min(16000, 500 * 2 ** attempt) + Math.random() * 250); continue;
      }
      if (response.ok || response.status === 308) return response;
      const message = await response.text();
      const transient = response.status === 429 || response.status >= 500 || (response.status === 403 && /rateLimitExceeded|userRateLimitExceeded/.test(message));
      if (!retry || !transient || attempt >= 4) throw new DriveError(response.status, `Drive ${response.status}: ${message.slice(0, 300)}`);
      await sleep(Math.min(30000, Number(response.headers.get("Retry-After")) * 1000 || 500 * 2 ** attempt));
    }
  }
  async list(q: string): Promise<RemoteFile[]> {
    let pageToken = ""; const all: RemoteFile[] = [];
    do {
      const params = new URLSearchParams({q: `trashed = false and (${q})`, fields: `nextPageToken,incompleteSearch,files(${fields})`, pageSize: "1000", spaces: "drive", pageToken});
      const data = await (await this.fetch(`${API}/files?${params}`)).json();
      if (data.incompleteSearch) throw new Error("Drive returned an incomplete listing; retry before synchronizing.");
      all.push(...data.files); pageToken = data.nextPageToken || "";
    } while (pageToken);
    return all;
  }
  async folders(parent = "root") { return this.list(`'${this.id(parent)}' in parents and mimeType = 'application/vnd.google-apps.folder'`); }
  id(id: string) { if (!/^[\w-]+$/.test(id)) throw new Error("Invalid Drive ID"); return id; }
  async metadata(id: string): Promise<RemoteFile> { return (await this.fetch(`${API}/files/${this.id(id)}?fields=${fields}`)).json(); }
  async manifest(folder: string): Promise<{files: RemoteFile[]; journals: string[]}> {
    const files: RemoteFile[] = [], journals: string[] = [], paths = new Set<string>();
    const walk = async (id: string, prefix: string, depth: number) => {
      if (depth > 64) throw new Error("Drive folder nesting exceeds 64 levels");
      for (const f of await this.list(`'${this.id(id)}' in parents`)) {
        safePath(f.name); if (f.name.includes("/")) throw new Error(`Unsupported slash in Drive name: ${f.name}`);
        const path = safePath(prefix + f.name);
        if (!prefix && f.name === JOURNAL) {
          if (f.mimeType !== "application/vnd.google-apps.folder") throw new Error("Sync journal name is occupied by a file");
          journals.push(f.id); continue;
        }
        if (paths.has(path)) throw new Error(`Duplicate Drive path: ${path}. Rename the duplicate before continuing.`);
        paths.add(path);
        if (f.mimeType === "application/vnd.google-apps.folder") await walk(f.id, path + "/", depth + 1);
        else if (f.mimeType.startsWith("application/vnd.google-apps.")) throw new Error(`Unsupported Google document or shortcut: ${path}`);
        else { if (!f.version || f.size === undefined) throw new Error(`Missing Drive metadata for ${path}`); files.push({...f, path}); }
      }
    };
    const root = await this.metadata(folder);
    if (root.mimeType !== "application/vnd.google-apps.folder") throw new Error("Select a folder");
    await walk(folder, "", 0); return {files, journals};
  }
  async createFolder(parent: string, name: string): Promise<string> {
    const r = await this.fetch(`${API}/files?fields=id`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({name, parents:[this.id(parent)], mimeType:"application/vnd.google-apps.folder"})}, false);
    return (await r.json()).id;
  }
  async newId(): Promise<string> { return (await (await this.fetch(`${API}/files/generateIds?count=1&space=drive&type=files`)).json()).ids[0]; }
  async content(id: string, start = 0) {
    return this.fetch(`${API}/files/${this.id(id)}?alt=media`, {headers: start ? {Range: `bytes=${start}-`} : {}});
  }
  async revisions(journals: string[]): Promise<Revision[]> {
    const revisions: Revision[] = [];
    for (const journal of journals) {
      const entries = await this.list(`'${this.id(journal)}' in parents and mimeType = 'application/json'`);
      for (const f of entries) {
        if (!f.name.endsWith(".commit.json")) continue;
        if (Number(f.size) > 16384) throw new Error("Invalid oversized sync record");
        const r = await (await this.content(f.id)).json() as Revision;
        safePath(r.path);
        if (r.schema !== 1 || typeof r.id !== "string" || !Array.isArray(r.parents) || r.parents.some(p => typeof p !== "string") || typeof r.base !== "string" || typeof r.deleted !== "boolean" || !Number.isSafeInteger(r.size) || r.size < 0 || (!r.deleted && (!r.blob || !/^[a-f0-9]{64}$/.test(r.hash || "")))) throw new Error("Invalid sync record");
        revisions.push(r);
      }
    }
    const unique = new Map<string, Revision>();
    for (const r of revisions) {
      if (unique.has(r.id) && JSON.stringify(unique.get(r.id)) !== JSON.stringify(r)) throw new Error("Conflicting revision IDs");
      unique.set(r.id, r);
    }
    return [...unique.values()];
  }
  async startUpload(id: string, parent: string, name: string, size: number, mimeType: string): Promise<string> {
    const r = await this.fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=${fields}`, {
      method:"POST", headers:{"Content-Type":"application/json", "X-Upload-Content-Length":String(size), "X-Upload-Content-Type":mimeType},
      body:JSON.stringify({id, name, parents:[this.id(parent)], mimeType})
    }, false);
    const location = r.headers.get("Location"); if (!location) throw new Error("Drive did not expose upload Location"); return location;
  }
  async uploadOffset(session: string, size: number): Promise<number> {
    const r = await this.fetch(session, {method:"PUT", headers:{"Content-Range":`bytes */${size}`}, body:new Blob([])});
    return r.status === 308 ? Number(r.headers.get("Range")?.match(/-(\d+)$/)?.[1] ?? -1) + 1 : size;
  }
  async uploadChunk(session: string, data: Blob, offset: number, total: number) {
    return this.fetch(session, {method:"PUT", headers:{"Content-Range": total ? `bytes ${offset}-${offset + data.size - 1}/${total}` : "bytes */0"}, body:data}, false);
  }
  async commit(parent: string, id: string, revision: Revision) {
    // Preallocated Drive IDs make retry after a lost response idempotent.
    try { await this.metadata(id); return; } catch (e) { if (!(e instanceof DriveError) || e.status !== 404) throw e; }
    const boundary = `cloud_${crypto.randomUUID()}`;
    const metadata = {id, name:`${revision.id}.commit.json`, parents:[parent], mimeType:"application/json"};
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(revision)}\r\n--${boundary}--`;
    await this.fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {method:"POST", headers:{"Content-Type":`multipart/related; boundary=${boundary}`}, body}, false);
  }
}
