type WriterState = {epoch:number; active:string[]};
export function writerState(profile: string): Promise<WriterState> {
  const channel = new BroadcastChannel("webleste-opfs-state");
  const query = crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    const timer = setTimeout(()=>{channel.close();reject(new Error("Runtime writer monitor unavailable; sync will retry after the game stops."));},1500);
    channel.onmessage=({data})=>{
      if(data.reply!==query)return;
      clearTimeout(timer); channel.close();resolve(data);
    };
    channel.postMessage({query,profile});
  });
}
