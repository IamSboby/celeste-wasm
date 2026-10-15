import {test,expect} from '@playwright/test';
async function run(page:any,name:string){
  await page.route('**/__test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Sync tests</title>'}));
  await page.goto('/__test');
  return page.evaluate(async(name:string)=>{const module=await import('/tests/harness.ts');return module.scenario(name);},name);
}
test('initial replica and incremental no-op',async({page})=>{expect(await run(page,'initial-incremental')).toEqual({ready:true,save:'save-one',extraDownloads:0});});
test('offline queue survives engine recreation',async({page})=>{expect(await run(page,'offline-recovery')).toEqual({queued:1,pending:0,save:'offline-progress',remote:1});});
test('second device receives progress',async({page})=>{expect(await run(page,'two-devices')).toEqual({save:'A-progress',records:1});});
test('conflict resolution preserves revisions',async({page})=>{const r=await run(page,'conflict');expect(r.conflicts).toEqual(['Saves/0.celeste']);expect(r.a).toBe('B-progress');expect(r.b).toBe('B-progress');expect(r.records).toBe(2);});
test('new mods and tombstones persist',async({page})=>{const r=await run(page,'new-delete');expect(r.save).toBeUndefined();expect(r.records).toEqual([{path:'Mods/new.zip',deleted:false},{path:'Saves/0.celeste',deleted:true}]);});
test('failed commit reuses uploaded blob',async({page})=>{expect(await run(page,'lost-response')).toEqual({records:1,extraUploads:0,pending:0});});
test('large files upload in bounded chunks',async({page})=>{const r=await run(page,'large');expect(r.size).toBe(9*1024*1024);expect(r.uploads).toBe(3);expect(r.hash).toBe(r.actual);});
test('account mismatch fails closed',async({page})=>{const r=await run(page,'account-isolation');expect(r.error).toContain('identity mismatch');expect(r.save).toBe('save-one');});
test('offline launch rejects corrupt required content',async({page})=>{expect((await run(page,'offline-corruption')).error).toContain('integrity check failed');});
test('launch preparation preserves the mounted patched assembly',async({page})=>{expect(await run(page,'mounted-prepare')).toEqual({assembly:'patched runtime assembly',sameSource:true});});
