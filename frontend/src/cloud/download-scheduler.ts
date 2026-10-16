export type Priority = 0 | 1 | 2 | 3;
type Job = {priority:Priority; run:()=>Promise<void>; resolve:()=>void; reject:(error:unknown)=>void; promise:Promise<void>; running:boolean};
export type NetworkHints = {saveData?:boolean; effectiveType?:string; downlink?:number};
export function downloadConcurrency(hints:NetworkHints = {}, maximum=3) {
  const cap=Number.isFinite(maximum) ? Math.max(1,Math.min(6,Math.floor(maximum))) : 3;
  if(hints.saveData || hints.effectiveType==='slow-2g' || hints.effectiveType==='2g') return 1;
  if(hints.effectiveType==='3g' || (hints.downlink !== undefined && hints.downlink < 2)) return Math.min(2,cap);
  return cap;
}
/** One scheduler per replica; keys include path and immutable remote revision. */
export class DownloadScheduler {
  private jobs=new Map<string,Job>();
  private active=0;
  private scheduled=false;
  constructor(private limit=3) { this.setConcurrency(limit); }
  setConcurrency(limit:number) { this.limit=downloadConcurrency({},limit); this.schedule(); }
  enqueue(key:string, priority:Priority, run:()=>Promise<void>):Promise<void> {
    const existing=this.jobs.get(key);
    if(existing) { existing.priority=Math.min(existing.priority,priority) as Priority; return existing.promise; }
    let resolve!:()=>void, reject!:(e:unknown)=>void;
    const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
    this.jobs.set(key,{priority,run,resolve,reject,promise,running:false});
    this.schedule();
    return promise;
  }
  private schedule() {
    if(this.scheduled) return;
    this.scheduled=true;
    queueMicrotask(()=>{this.scheduled=false;this.pump();});
  }
  private pump() {
    while(this.active < this.limit) {
      const entry=[...this.jobs.entries()].filter(([,j])=>!j.running).sort((a,b)=>a[1].priority-b[1].priority)[0];
      if(!entry) return;
      const [key,job]=entry;
      job.running=true; this.active++;
      // Running transfers retain their verified checkpoints; only queued work is reordered.
      void Promise.resolve().then(job.run).then(()=>{
        this.jobs.delete(key); this.active--; job.resolve(); this.schedule();
      },error=>{
        this.jobs.delete(key); this.active--; job.reject(error); this.schedule();
      });
    }
  }
}
