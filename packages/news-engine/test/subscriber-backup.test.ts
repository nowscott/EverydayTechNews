import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAudience } from '../../news-common/src/subscriber-backup.ts';
import { notionRequest } from '../../news-common/src/notion.ts';

test('complete snapshots replace atomically; retried failures use only a fresh matching backup', async () => {
  const root=mkdtempSync(join(tmpdir(),'audience-')); let clock=Date.parse('2026-10-27T00:00:00Z');
  const delays:number[]=[]; const base={root,kind:'premium-internal-test',deadline:new Date(clock+300000),now:()=>new Date(clock),sleep:async(ms:number)=>{delays.push(ms);clock+=ms;},valid:(v:unknown):v is string=>typeof v==='string'&&v.includes('@')};
  try {
    const first=await resolveAudience({...base,get:async()=>['one@example.org']});
    assert.equal(first.report.source,'notion');
    const path=join(root,'subscriber-backups/premium-internal-test.json');const before=readFileSync(path,'utf8');
    assert.equal(statSync(path).mode&0o077,0);
    let calls=0;
    const fallback=await resolveAudience({...base,get:async()=>{calls++;throw new Error('notion_network_failure');}});
    assert.equal(calls,3);assert.deepEqual(delays,[5000,15000]);assert.equal(fallback.report.source,'backup');assert.deepEqual(fallback.subscribers,['one@example.org']);assert.equal(readFileSync(path,'utf8'),before);
    let retries=0;
    const recovered=await resolveAudience({...base,get:async()=>{if(++retries===1)throw new Error('notion_http_503');return ['one@example.org'];}});
    assert.equal(retries,2);assert.equal(recovered.report.source,'notion');
    const refreshed=readFileSync(path,'utf8');
    await assert.rejects(resolveAudience({...base,get:async()=>{throw new Error('notion_invalid_page');}}),/notion_invalid_page/);
    assert.equal(readFileSync(path,'utf8'),refreshed);
    await assert.rejects(resolveAudience({...base,kind:'ordinary',get:async()=>{throw new Error('notion_network_failure');}}),/notion_backup_unavailable/);
    clock+=8*86400000;
    await assert.rejects(resolveAudience({...base,deadline:new Date(clock+300000),get:async()=>{throw new Error('notion_network_failure');}}),/notion_backup_invalid_or_expired/);
    writeFileSync(path,'null');
    await assert.rejects(resolveAudience({...base,deadline:new Date(clock+300000),get:async()=>{throw new Error('notion_network_failure');}}),/notion_backup_invalid_or_expired/);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('Notion rate limit delay is preserved and permanent errors are not retried', async () => {
  let calls=0;const response=async()=>{calls++;return new Response('{}',{status:429,headers:{'Retry-After':'42'}});};
  await assert.rejects(notionRequest('/x',{NOTION_API_KEY:'test'},response as typeof fetch), (e:any)=>e.message==='notion_http_429'&&e.retryAfterMs===42000);
  assert.equal(calls,1);
  const root=mkdtempSync(join(tmpdir(),'audience-'));
  try { await assert.rejects(resolveAudience({root,kind:'ordinary',deadline:new Date(Date.now()+60000),valid:(v:unknown):v is string=>typeof v==='string',get:async()=>{calls++;throw new Error('notion_http_401');}}),/notion_http_401/);assert.equal(calls,2); }
  finally {rmSync(root,{recursive:true,force:true});}
});
