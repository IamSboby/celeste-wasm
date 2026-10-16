import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DownloadScheduler,downloadConcurrency} from '../frontend/src/cloud/download-scheduler';
test('queued critical work overtakes prefetch and promotion deduplicates',async()=>{
  const scheduler=new DownloadScheduler(1), order:string[]=[];
  const low=scheduler.enqueue('low',3,async()=>{order.push('low');});
  const next=scheduler.enqueue('next',2,async()=>{order.push('next');});
  assert.equal(scheduler.enqueue('next',0,async()=>{throw Error('duplicate');}),next);
  const critical=scheduler.enqueue('current',0,async()=>{order.push('current');});
  await Promise.all([low,next,critical]);
  assert.deepEqual(order,['next','current','low']);
});
test('bounds active downloads, preserves in-flight deduplication, drains after failure',async()=>{
  const scheduler=new DownloadScheduler(2);
  const release:Array<()=>void>=[];
  let active=0,peak=0;
  const run=async()=>{peak=Math.max(peak,++active);await new Promise<void>(r=>release.push(r));active--;};
  const one=scheduler.enqueue('one',1,run), two=scheduler.enqueue('two',1,run);
  const failed=scheduler.enqueue('failed',0,async()=>{throw Error('network');});
  const settled=Promise.allSettled([one,two,failed]);
  await new Promise(r=>setImmediate(r));
  assert.equal(scheduler.enqueue('one',0,run),one);
  release.splice(0).forEach(r=>r());
  const result=await settled;
  assert.equal(peak,2);assert.equal(result[2].status,'rejected');
  await scheduler.enqueue('failed',0,async()=>{});
});
test('network hints reduce concurrency without exceeding configured cap',()=>{
  assert.equal(downloadConcurrency({saveData:true},6),1);
  assert.equal(downloadConcurrency({effectiveType:'2g'},6),1);
  assert.equal(downloadConcurrency({effectiveType:'3g'},6),2);
  assert.equal(downloadConcurrency({downlink:.5},6),2);
  assert.equal(downloadConcurrency({},99),6);
  assert.equal(downloadConcurrency({},NaN),3);
});
