import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { Dashboard } from '../server/data.ts';
import { usage } from '../server/usage.ts';
import { createApp } from '../server/main.ts';
import { hashPassword } from '../server/security.ts';
function fixture(legacy=false){
 const root=mkdtempSync(join(tmpdir(),'etn-usage-')),premium=join(root,'premium');mkdirSync(premium);
 const db=new DatabaseSync(premium+'/state.sqlite3');
 db.exec(legacy?'CREATE TABLE calls(id,day,cost,reserved,status);':'CREATE TABLE calls(id INTEGER PRIMARY KEY,day,job,usage,cost,reserved,status,seconds); CREATE TABLE jobs(key,article); CREATE TABLE meta(key,data); CREATE TABLE articles(id,data); CREATE TABLE issues(id,data);');
 const dashboard=new Dashboard({ordinary:root,premium,runtime:root});
 const call=(id:number,date:string,job:string|null,u:any,cost:number|null=.1,status='response_received')=>db.prepare('INSERT INTO calls VALUES(?,?,?,?,?,?,?,?)').run(id,date,job,typeof u==='string'?u:JSON.stringify(u),cost,.5,status,1.25);
 const job=(key:string,kind?:string)=>db.prepare('INSERT INTO jobs VALUES(?,?)').run(key,JSON.stringify({id:'article',title:'芯片新闻',task_kind:kind,content_fingerprint:'body',text:'PRIVATE_PROMPT',api_key:'PRIVATE_KEY'}));
 const read=(extra:Record<string,string>={})=>usage(dashboard,new URLSearchParams({from:'2026-10-24',to:'2026-10-24',...extra}));
 const hash=()=>createHash('sha256').update(readFileSync(premium+'/state.sqlite3')).digest('hex');
 return {root,premium,db,dashboard,call,job,read,hash,close(){db.close();rmSync(root,{recursive:true,force:true});}};
}
const u={prompt_tokens:100,completion_tokens:25,prompt_cache_hit_tokens:40};
test('usage sums known input/output without double counting cache; repeats include full history and preserve source',()=>{
 const f=fixture();try{
  f.job('generation');f.job('review','review');f.job('edition','edition_review');
  f.call(1,'2026-10-23','generation',u);f.call(2,'2026-10-24','generation',u,.2,'invalid_response');f.call(3,'2026-10-24','review',u);f.call(4,'2026-10-24','edition',u);
  f.db.prepare('INSERT INTO meta VALUES(?,?)').run('call_diagnostic:2',JSON.stringify({started_at:'2026-10-23T16:01:00Z',finished_at:'2026-10-23T16:01:01Z',error_code:'unsupported evidence',authorization:'PRIVATE_KEY'}));
  f.db.prepare('INSERT INTO articles VALUES(?,?)').run('article',JSON.stringify({content_fingerprint:'body',fetched_at:'2026-10-22T16:01:00Z'}));
  f.db.prepare('INSERT INTO issues VALUES(?,?)').run('test-edition',JSON.stringify({edition_review:{key:'edition'},collection_cutoff:'2026-10-24T00:00:00+08:00'}));
  const before=f.hash(),v=f.read(),s=v.data.summary;
  assert.equal(v.read_state,'ok');assert.equal(s.input,300);assert.equal(s.output,75);assert.equal(s.total,375);assert.equal(s.cache_hit,120);assert.equal(s.cache_rate,.4);assert.equal(s.repeat_calls,1);assert.equal(s.repeat_estimated_cny,.2);
  assert.equal(v.data.items.find((r:any)=>r.id===2).error_code,'unsupported evidence');assert.equal(v.data.items.find((r:any)=>r.id===2).links[0].date,'2026-10-23');assert.equal(v.data.items.find((r:any)=>r.id===4).links[0].id,'test-edition');
  assert.equal(f.read({stage:'generation'}).data.summary.repeat_calls,1);assert.equal(f.read({status:'invalid_response',q:'芯片'}).data.total,1);assert.equal(f.read({q:'不存在'}).data.total,0);
  assert(!JSON.stringify(v).includes('PRIVATE'));assert(!JSON.stringify(v).includes('api_key'));assert.equal(f.hash(),before);
 }finally{f.close();}
});
test('missing or damaged usage/cache and unknown fees remain explicit, while failed paid calls count',()=>{
 const f=fixture();try{
  f.call(1,'2026-10-24',null,null,null,'transport_usage_unknown');f.call(2,'2026-10-24','orphan','{invalid',.2,'invalid_response');
  f.call(3,'2026-10-24','orphan',{prompt_tokens:10,completion_tokens:2,prompt_cache_hit_tokens:11});
  f.call(4,'2026-10-24','other',{prompt_tokens:-1,completion_tokens:3,prompt_cache_hit_tokens:0});
  f.call(5,'2026-10-24','other',{prompt_tokens:20,completion_tokens:4});
  const v=f.read(),s=v.data.summary;assert.equal(v.read_state,'ok');assert.equal(s.calls,5);assert.equal(s.total,39);assert.equal(s.missing_usage,3);assert.equal(s.missing_input,3);assert.equal(s.missing_output,2);assert.equal(s.missing_cache,5);assert.equal(s.cache_rate,null);assert.equal(s.unknown_cost_calls,1);assert.equal(s.unknown_reserved_cny,.5);assert.equal(s.repeat_calls,2);assert.equal(s.repeat_unclassified_calls,1);assert(v.data.items.every((r:any)=>r.stage==='unknown'));assert.equal(v.data.items.find((r:any)=>r.id===1).input,null);
 }finally{f.close();}
});
test('all-filter summaries and complete daily series are independent of pagination',()=>{
 const f=fixture();try{f.job('g');for(let i=1;i<=35;i++)f.call(i,'2026-10-24','g',u);
  const v=f.read({from:'2026-10-22',page:'2'}).data;assert.equal(v.items.length,5);assert.equal(v.total,35);assert.equal(v.summary.total,4375);assert.equal(v.summary.repeat_calls,34);assert.equal(v.daily.length,3);assert.equal(v.daily[0].calls,0);assert.equal(v.daily[2].calls,35);
  assert.equal(f.read({from:'2026-10-25',to:'2026-10-25'}).data.summary.calls,0);
 }finally{f.close();}
});
test('legacy ledger columns stay readable; corrupt/missing databases do not masquerade as empty usage',()=>{
 const f=fixture(true);try{f.db.exec("INSERT INTO calls VALUES(1,'2026-10-24',.1,.5,'response_received')");const v=f.read();assert.equal(v.read_state,'ok');assert.equal(v.data.available,true);assert.equal(v.data.summary.missing_usage,1);assert.equal(v.data.items[0].repeated,null);
 }finally{f.close();}
 const root=mkdtempSync(join(tmpdir(),'etn-no-usage-'));try{const d=new Dashboard({ordinary:root,premium:root,runtime:root});let v=usage(d,new URLSearchParams());assert.equal(v.data.available,false);assert.equal(v.data.summary,null);writeFileSync(root+'/state.sqlite3','bad database');v=usage(d,new URLSearchParams());assert.equal(v.read_state,'partial');assert.equal(v.data.available,false);}finally{rmSync(root,{recursive:true,force:true});}
});
test('date defaults and query validation use Shanghai day and bounded range',()=>{
 const f=fixture();try{const now=new Date('2026-10-23T16:30:00Z'),v=usage(f.dashboard,new URLSearchParams(),now);assert.equal(v.data.from,'2026-10-24');assert.equal(v.data.to,'2026-10-24');
  for(const params of ['from=2026-02-30','from=2026-01-01&to=2026-02-01','page=-1','stage=bogus'])assert.throws(()=>usage(f.dashboard,new URLSearchParams(params),now));
 }finally{f.close();}
});
test('usage API requires login, rejects mutations, preserves unit fields and reports bad filters as 400',async()=>{
 const f=fixture(),server=createApp({ordinary:f.root,premium:f.premium,runtime:f.root},hashPassword('test-usage-password'));server.listen(0,'127.0.0.1');await once(server,'listening');
 try{f.call(1,'2026-10-24',null,u);const base='http://127.0.0.1:'+(server.address() as any).port;
  assert.equal((await fetch(base+'/api/usage')).status,401);
  const login=await fetch(base+'/api/login',{method:'POST',body:JSON.stringify({password:'test-usage-password'})});const headers={Cookie:login.headers.get('set-cookie')!.split(';')[0]};
  const r=await fetch(base+'/api/usage?from=2026-10-24&to=2026-10-24',{headers});assert.equal(r.status,200);const v=await r.json();assert.equal(v.data.summary.total,125);assert.equal(v.data.unit,'Token');
  assert.equal((await fetch(base+'/api/usage?stage=bogus',{headers})).status,400);assert.equal((await fetch(base+'/api/usage',{headers,method:'POST'})).status,405);
 }finally{await new Promise<void>(r=>server.close(()=>r()));f.close();}
});

test('legacy validation reasons use only the safe saved reason; busy source never reports zero',()=>{
 const f=fixture();try{
  f.db.exec('CREATE TABLE responses(call_id,data,validation_error)');
  f.call(1,'2026-10-24',null,u,.2,'invalid_response');
  f.db.prepare('INSERT INTO responses VALUES(?,?,?)').run(1,'PRIVATE_MODEL_RESPONSE','response_validation_failed');
  const v=f.read();assert.equal(v.data.items[0].error_code,'response_validation_failed');assert(!JSON.stringify(v).includes('PRIVATE_MODEL_RESPONSE'));
  f.db.exec('BEGIN EXCLUSIVE');
  try{const unavailable=f.read();assert.equal(unavailable.data.available,false);assert.equal(unavailable.data.summary,null);}finally{f.db.exec('ROLLBACK');}
 }finally{f.close();}
});
