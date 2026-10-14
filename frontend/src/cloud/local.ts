import { createSHA256, createMD5 } from "hash-wasm";
import { safePath } from "./model";
export class LocalFileManifest {
  constructor(public root: FileSystemDirectoryHandle) {}
  async directory(path: string, create = false) {
    let dir = this.root;
    if (path) for (const part of safePath(path).split("/")) dir = await dir.getDirectoryHandle(part, {create});
    return dir;
  }
  async handle(path: string, create = false) {
    const parts = safePath(path).split("/"); const name = parts.pop()!;
    return (await this.directory(parts.join("/"), create)).getFileHandle(name, {create});
  }
  async file(path: string): Promise<File | undefined> {
    try { return await (await this.handle(path)).getFile(); }
    catch (e) { if ((e as DOMException).name === "NotFoundError") return; throw e; }
  }
  async remove(path: string) {
    const parts = safePath(path).split("/"); const name = parts.pop()!;
    try { await (await this.directory(parts.join("/"))).removeEntry(name); }
    catch (e) { if ((e as DOMException).name !== "NotFoundError") throw e; }
  }
  async write(path: string, body: Blob | string) {
    const w = await (await this.handle(path, true)).createWritable();
    try { await w.write(body); await w.close(); } catch (e) { await w.abort().catch(() => {}); throw e; }
  }
  async copy(from: string, to: string) {
    const file = await this.file(from); if (!file) throw new Error(`Missing snapshot: ${from}`);
    await file.stream().pipeTo(await (await this.handle(to, true)).createWritable());
  }
  async list(): Promise<Map<string, File>> {
    const result = new Map<string, File>();
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
      for await (const [name, handle] of dir) {
        const path = prefix + name;
        if (path === ".cloud") continue;
        if (handle.kind === "directory") await walk(handle, path + "/");
        else result.set(path, await handle.getFile());
      }
    }; await walk(this.root, ""); return result;
  }
  async hash(file: Blob, md5 = false) {
    const hash = await (md5 ? createMD5() : createSHA256()); hash.init();
    const reader = file.stream().getReader();
    try { while (true) { const {done, value} = await reader.read(); if (done) break; hash.update(value); } }
    finally { reader.releaseLock(); }
    return hash.digest("hex");
  }
  async readJSON<T>(path: string): Promise<T | undefined> { const f = await this.file(path); return f ? JSON.parse(await f.text()) : undefined; }
  async saveJSON(path: string, value: unknown) { await this.write(path, JSON.stringify(value)); }
}
