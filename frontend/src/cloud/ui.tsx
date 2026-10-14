import { Button } from "../ui/Button";
import { Switch } from "../ui/Switch";
import { cloud, action, connect, disconnect, drive, chooseFolder, synchronize, rpc } from "./controller";
import { binding } from "./profile";
import type { RemoteFile } from "./model";
export const CloudPanel: Component<{onReady?:()=>Promise<void>},{folders:RemoteFile[];parent:string;history:string[];selecting:boolean}> = function () {
  this.folders=[]; this.parent="root"; this.history=[]; this.selecting=false;
  this.css = `display:flex;flex-direction:column;gap:.6rem;max-height:65vh;overflow:auto;
    p{margin:.2em 0} progress{width:100%;accent-color:var(--accent)} .folders{display:flex;flex-direction:column;gap:.3rem} .detail{font-size:.85em;overflow-wrap:anywhere} .error{color:var(--accent)}`;
  const browse = async (id="root") => {this.folders=await drive.folders(id);this.parent=id;this.selecting=true;};
  const sync = () => action(async()=>{ await synchronize(); if(cloud.progress.status==="Synced" && this.onReady) await this.onReady(); });
  return <section>
    <h3>Google Drive Sync</h3>
    <p class="detail">Optional cloud storage for your own Celeste files. Gameplay uses the local browser copy.</p>
    <Button type="primary" icon="none" disabled={use(cloud.busy)} on:click={()=>action(connect)}>{use(cloud.connected,c=>c ? "Change / reconnect Google account" : "Connect Google Drive")}</Button>
    <p>{use(cloud.email)}</p>
    {$if(use(cloud.connected),<Button type="normal" icon="none" disabled={use(cloud.busy)} on:click={()=>action(()=>browse())}>Select Celeste Folder</Button>)}
    {$if(use(this.selecting),<div class="folders">
      <p class="detail">Open folders to browse, then select the installation root.</p>
      <Button type="normal" icon="none" disabled={use(cloud.busy)} on:click={()=>action(async()=>{await browse(this.history.pop() || "root");})}>Back</Button>
      {use(this.folders,fs=>fs.map(f=><Button type="normal" icon="none" disabled={use(cloud.busy)} on:click={()=>action(async()=>{this.history.push(this.parent);await browse(f.id);})}>{f.name}</Button>))}
      <Button type="primary" icon="none" disabled={use(this.parent,p=>p==="root")} on:click={()=>action(()=>chooseFolder(this.parent))}>Use this folder</Button>
    </div>)}
    {binding ? <div>
      <p class="detail">Folder: {binding.folder}</p>
      <Button type="primary" icon="none" disabled={use(cloud.busy)} on:click={sync}>{this.onReady ? "Synchronize & Play" : "Synchronize now"}</Button>
      {this.onReady ? <Button type="normal" icon="none" disabled={use(cloud.busy)} on:click={()=>action(this.onReady!)}>Play local copy / offline</Button> : null}
      <Switch title="Automatic synchronization" bind:on={use(cloud.automatic)} disabled={false} on:change={()=>{localStorage.setItem("cloud-auto",String(cloud.automatic));void rpc("settings",{automatic:cloud.automatic});}} />
    </div> : null}
    <p role="status">{use(cloud.progress,p=>p.status)} — {use(cloud.progress,p=>p.message)}</p>
    <progress max="100" value={use(cloud.progress,p=>p.total ? 100*p.done/p.total : 0)} />
    <p class="detail">{use(cloud.progress,p=>`${p.done}/${p.total} files · ${Math.max(0,p.total-p.done)} remaining · ${(p.bytes/1048576).toFixed(1)}/${(p.totalBytes/1048576).toFixed(1)} MiB transferred · ${(p.speed/1048576).toFixed(1)} MiB/s`)}</p>
    <p class="detail">{use(cloud.progress,p=>p.current)}</p>
    <p class="detail">Last remote save: {use(cloud.progress,p=>p.lastSync || "None yet")}</p>
    <details><summary>Pending files</summary>{use(cloud.progress,p=>p.pending.map(path=><p class="detail">{path}</p>))}</details>
    {use(cloud.progress,p=>p.conflicts.map(path=><div>
      <p class="detail">Conflict: {path}</p>
      <Button type="normal" icon="none" disabled={use(cloud.busy)} on:click={()=>action(()=>rpc("resolve",{path,choice:"local"}))}>Keep local (archive other versions)</Button>
      <Button type="normal" icon="none" disabled={use(cloud.busy)} on:click={()=>action(()=>rpc("resolve",{path,choice:"remote"}))}>Use remote (back up local)</Button>
    </div>))}
    {$if(use(cloud.connected),<Button type="normal" icon="none" disabled={use(cloud.busy)} on:click={()=>action(disconnect)}>Disconnect Google Drive</Button>)}
    <p class="error" role="alert">{use(cloud.error)}</p>
  </section>;
};
export const CloudIndicator: Component = function () {
  this.css="font-size:.8rem;opacity:.8;white-space:nowrap";
  return <span title="Google Drive Sync">{binding ? use(cloud.progress,p=>p.status) : ""}</span>;
};
