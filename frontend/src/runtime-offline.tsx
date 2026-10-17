import { Button } from "./ui/Button";
export const RuntimeOffline: Component<{}, {busy:boolean; message:string}> = function () {
  this.busy=false; this.message="";
  const download=async()=>{
    this.busy=true; this.message="Downloading and verifying the complete runtime…";
    try {
      const worker=navigator.serviceWorker?.controller;
      if(!worker) throw new Error("Offline runtime preparation requires the published app.");
      await new Promise<void>((resolve,reject)=>{
        const channel=new MessageChannel();
        channel.port1.onmessage=event=>{
          channel.port1.close();
          event.data.ok ? resolve() : reject(new Error(event.data.error));
        };
        worker.postMessage({type:"runtime-download-all"},[channel.port2]);
      });
      this.message="Runtime available offline. Your Celeste files must also be installed or fully synchronized.";
    } catch(error) { this.message=(error as Error).message; }
    finally { this.busy=false; }
  };
  return <section>
    <Button type="normal" icon="none" disabled={use(this.busy)} on:click={download}>Download complete runtime for offline play</Button>
    <p role="status">{use(this.message)}</p>
  </section>;
};
