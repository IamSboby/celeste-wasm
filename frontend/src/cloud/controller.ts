import SyncWorker from "./sync.worker?worker";
import { GoogleDriveAuth } from "./auth";
import { GoogleDriveClient } from "./drive";
import { binding, profilePath, profileLease, selectProfile } from "./profile";
import { initialProgress, type SyncState } from "./model";
export const cloud = $state({progress:initialProgress(),connected:false,email:"",busy:false,playing:false,automatic:localStorage.getItem("cloud-auto") !== "false",error:""});
export const auth = new GoogleDriveAuth();
// Capture native fetch before the runtime replaces window.fetch with its proxy fallback.
export const drive = new GoogleDriveClient(auth.getToken,fetch.bind(window));
let worker: Worker | undefined;
let serial = 0;
const calls = new Map<number,{resolve:(x:any)=>void;reject:(e:Error)=>void}>();
export const ready = (async () => {
  await profileLease;
  if (!binding) return;
  worker = new SyncWorker({name:"google-drive-sync"});
  worker.onmessage = ({data}) => {
    if (data.progress) { cloud.progress = data.progress; return; }
    const call = calls.get(data.id); if (!call) return; calls.delete(data.id);
    if (data.error) call.reject(new Error(data.error)); else call.resolve(data.result);
  };
  worker.onerror = () => {
    cloud.error = "Sync worker stopped. Reload to recover pending changes.";
    for (const c of calls.values()) c.reject(new Error(cloud.error)); calls.clear();
  };
  await rpc("init",{...binding,profilePath,automatic:cloud.automatic,concurrency:Number(import.meta.env.VITE_DRIVE_CONCURRENCY || 3)});
})();
export function rpc(method: string,args?: unknown): Promise<any> {
  if (!worker) return Promise.reject(new Error("Select a Google Drive folder first"));
  return new Promise((resolve,reject) => { const id = ++serial; calls.set(id,{resolve,reject}); worker!.postMessage({id,method,args}); });
}
export async function action(fn: () => Promise<void>) {
  if (cloud.busy) return;
  cloud.busy = true; cloud.error = "";
  try { await fn(); } catch (e) { cloud.error = (e as Error).message; } finally { cloud.busy = false; }
}
export async function connect() {
  await auth.connect();
  cloud.connected = auth.connected; cloud.email = auth.email;
  if (binding && auth.account === binding.account) { await ready; await rpc("token",{token:auth.getToken(),expiry:auth.expiresAt}); }
  else if (binding) {
    await rpc("token",{token:"",expiry:0});
    cloud.error = "Different Google account: select its folder to open a separate local replica. Previous saves are retained.";
  }
}
export async function disconnect() {
  auth.disconnect(); cloud.connected = false; cloud.email = "";
  if (binding) { await ready; await rpc("token",{token:"",expiry:0}); }
}
export async function synchronize() { await ready; await rpc("sync"); }
export async function chooseFolder(id: string) {
  if (cloud.playing) throw new Error("Stop the game before changing folders");
  const folder = await drive.metadata(id);
  if (folder.mimeType !== "application/vnd.google-apps.folder") throw new Error("Select a folder");
  selectProfile(auth.account,id);
}
export async function beforePlay() {
  if (!binding) return;
  await ready;
  if (cloud.busy) throw new Error("Wait for synchronization to finish");
  await rpc("prepare");
  if (cloud.progress.conflicts.length) throw new Error("Resolve sync conflicts before starting the game");
  await rpc("playing",{value:true}); cloud.playing = true;
}
export async function afterPlay() {
  cloud.playing = false;
  if (!binding) return;
  await rpc("playing",{value:false}); await synchronize();
}
export async function getState(): Promise<SyncState> { await ready; return rpc("state"); }
window.addEventListener("online",() => { if(binding && cloud.automatic) void action(synchronize); });
window.addEventListener("blur",() => { if(binding && cloud.automatic) void action(synchronize); });
document.addEventListener("visibilitychange",() => { if(document.hidden && binding && cloud.automatic) void action(synchronize); });
ready.catch(e => {cloud.error = String(e);});

