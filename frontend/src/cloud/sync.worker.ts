import { SyncEngine } from "./engine";
import { LocalFileManifest } from "./local";
import { GoogleDriveClient } from "./drive";
let engine: SyncEngine | undefined;
let token = "", expiry = 0;
let timer: ReturnType<typeof setTimeout>;
const nativeFetch = fetch.bind(globalThis);
let operations = Promise.resolve();
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    operations = operations.then(async () => {
      if (engine?.automatic) await engine.sync(!!token && Date.now() < expiry).catch(() => {});
    }).finally(schedule);
  }, engine?.progress.status === "Sync Error" ? 60000 : 20000);
}
self.onmessage = ({data}) => {
  // Auth updates must be able to unblock a queue, but never change its identity.
  if (data.method === "token") { token = data.args.token; expiry = data.args.expiry; self.postMessage({id:data.id,result:true}); return; }
  operations = operations.then(async () => {
    try {
      let result: unknown;
      if (data.method === "init") {
        let root = await navigator.storage.getDirectory();
        for (const part of data.args.profilePath.split("/").filter(Boolean)) root = await root.getDirectoryHandle(part,{create:true});
        engine = new SyncEngine(new LocalFileManifest(root),new GoogleDriveClient(() => {
          if (!token || Date.now() >= expiry) throw new Error("Connect Google Drive to renew your session"); return token;
        },nativeFetch),data.args.account,data.args.folder,p => self.postMessage({progress:p}));
        engine.automatic = data.args.automatic;
        engine.concurrency = data.args.concurrency;
        await engine.init(); schedule(); result = engine.state;
      } else {
        if (!engine) throw new Error("Select a Drive folder first");
        switch (data.method) {
          case "sync": await engine.sync(!!token && Date.now()<expiry, data.args?.settle ?? false); break;
          case "prepare": result = await engine.prepareSource(); break;
          case "prepared": await engine.markPrepared(data.args.hash); break;
          case "state": result = engine.state; break;
          case "playing": engine.playing = data.args.value; break;
          case "mounted": engine.mounted = true; break;
          case "settings": engine.automatic = data.args.automatic; break;
          case "resolve": await engine.resolve(data.args.path,data.args.choice); break;
          default: throw new Error("Unknown sync command");
        }
      }
      self.postMessage({id:data.id,result});
    } catch (error) { self.postMessage({id:data.id,error:(error as Error).message}); }
  });
};
