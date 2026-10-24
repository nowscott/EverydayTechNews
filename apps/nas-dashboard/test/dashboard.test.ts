import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../server/main.ts';
import { Dashboard, Reader, day, deliveryState, operation, range } from '../server/data.ts';
import { isEvidenceFailure } from '../server/evidence.ts';
import { hashPassword, redact, safeUrl, verifyPassword } from '../server/security.ts';
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'etn-dashboard-')),ordinary=join(root,'ordinary'),premium=join(root,'premium'),runtime=join(root,'runtime'),today=day(),yesterday=day(new Date(Date.now()-86400000));
  for(const p of [ordinary,premium,runtime])mkdirSync(p);
  const json=(p:string,v:any)=>{mkdirSync(join(p,'..'),{recursive:true});writeFileSync(p,JSON.stringify(v));};
  const o=new DatabaseSync(ordinary+'/state.sqlite3');o.exec('PRAGMA journal_mode=WAL; CREATE TABLE grades(day,url,score,status,data); CREATE TABLE issues(id,day,mode,data); CREATE TABLE deliveries(id,issue,email,status,attempts,data);');
  const url='https://www.ithome.com/0/123/456.htm',id='shadow-'+today,oi={id,day:today,mode:'shadow',items:[['标题',url]],body:'安全预览 <script>alert(1)</script>',frozen_at:new Date().toISOString()};
  o.prepare('INSERT INTO issues VALUES(?,?,?,?)').run(id,today,'shadow',JSON.stringify(oi));
  o.prepare('INSERT INTO grades VALUES(?,?,?,?,?)').run(today,url,11,'valid',JSON.stringify({votes:[1,0]}));
  o.prepare('INSERT INTO deliveries VALUES(?,?,?,?,?,?)').run('receipt',id,'private@example.com','unknown_do_not_retry',1,JSON.stringify({user:{email:'private@example.com'},html:'secret',started_at:new Date().toISOString()}));
  mkdirSync(ordinary+'/news_archive/'+today.slice(0,7),{recursive:true});writeFileSync(ordinary+'/news_archive/'+today.slice(0,7)+'/'+today.slice(8)+'.md',`# 新闻\n- [标题](${url})\n`);
  json(ordinary+'/config.json',{mode:'shadow',shadow_started_on:yesterday});json(ordinary+'/status.json',{date:today,runtime:{version:'1.0.4'},delivery:{expected:1}});
  const p=new DatabaseSync(premium+'/state.sqlite3');p.exec('CREATE TABLE articles(id,fingerprint,data); CREATE TABLE jobs(key,article,status,result,attempts); CREATE TABLE issues(id,data); CREATE TABLE calls(id,day,cost,reserved,status);');
  const a={id:'article',url:'https://example.com/news',source_name:'来源',title:'AI 新闻',fetched_at:new Date().toISOString(),content_fingerprint:'body',ranking:{score:80,version:'editorial-6',breakdown:{impact:14},signals:['理由']}};
  p.prepare('INSERT INTO articles VALUES(?,?,?)').run(a.id,'version',JSON.stringify(a));p.prepare('INSERT INTO jobs VALUES(?,?,?,?,?)').run('job',JSON.stringify(a),'pending_ai_review',JSON.stringify({title:'改写标题',summary:'完成改写'}),1);
  p.prepare('INSERT INTO calls VALUES(?,?,?,?,?)').run(1,today,null,.1,'reserved');json(premium+'/trial.json',{mode:'internal_test',enabled:true,delivery_enabled:true});json(premium+'/status.json',{at:new Date().toISOString()});json(premium+'/source-health.json',{at:new Date().toISOString(),sources:[{ok:false,source:'example'}]});mkdirSync(premium+'/deliveries');
  const dashboard=new Dashboard({ordinary,premium,runtime});
  return {root,ordinary,premium,runtime,dashboard,o,p,today,json,close(){o.close();p.close();rmSync(root,{recursive:true,force:true});}};
}
function hashes(root:string):any {const result:any={};const walk=(dir:string)=>{for(const name of readdirSync(dir,{withFileTypes:true})){const p=join(dir,name.name);if(name.isDirectory())walk(p);else if(!p.endsWith('-shm'))result[p]=createHash('sha256').update(readFileSync(p)).digest('hex');}};walk(root);return result;}
test('read-only real SQLite adapters preserve ledger, separate rewrite/review, mask recipients',()=>{
 const f=fixture();try{
  const reviewArticle={id:'article',content_fingerprint:'body',fetched_at:new Date().toISOString(),task_kind:'review',output_schema:'review-1'};f.p.prepare('INSERT INTO jobs VALUES(?,?,?,?,?)').run('review',JSON.stringify(reviewArticle),'review_passed',JSON.stringify({verdict:'pass'}),1);
  const before=hashes(f.root),params=new URLSearchParams({from:f.today,to:f.today});
  const pn=f.dashboard.news('premium',params);assert.equal(pn.data.total,1);assert.equal(pn.data.items[0].stage,'rewritten');assert.equal(pn.data.items[0].score,80);
  const detail=f.dashboard.news('premium',params,pn.data.items[0].id);assert.equal(detail.data.review,'pending');assert.equal(detail.data.rewrite.summary,'完成改写');
  const on=f.dashboard.news('ordinary',params);assert.equal(on.data.items[0].stage,'graded');assert.equal(on.data.items[0].review,'not_applicable');assert.equal(on.data.items[0].fetched_at,null);
  const mail=f.dashboard.issues('ordinary',params,'shadow-'+f.today);assert.equal(mail.data.delivery,'unknown');assert.equal(mail.data.receipts[0].recipient,'***@example.com');assert(!JSON.stringify(mail).includes('private@example.com'));assert(!JSON.stringify(mail).includes('secret'));
  const summary=f.dashboard.overview();assert.equal(summary[0].data.inbox,'not_verified');assert.equal(summary[1].data.calls,1);assert.equal(summary[1].data.unknown_reserved_cny,.1);assert.equal(summary[1].data.estimated_cny,0);assert.equal(summary[1].data.operation.state,'unknown');
  assert.deepEqual(hashes(f.root),before);
 }finally{f.close();}
});
test('query_only and readOnly prevent SQLite writes, including WAL reads',()=>{const f=fixture();try{const r=new Reader(f.ordinary);assert.equal(r.query('SELECT * FROM issues').length,1);assert.throws(()=>r.db!.exec("INSERT INTO issues VALUES('x','x','x','x')"));r.close();}finally{f.close();}});
test('missing/corrupt/locked evidence stays explicit',()=>{
 const f=fixture();try{writeFileSync(f.ordinary+'/status.json','bad JSON');const result=f.dashboard.overview();assert.equal(result[0].read_state,'partial');assert(result[0].evidence.some((e:any)=>e.source==='status.json'&&e.state==='unreadable'));f.p.exec("BEGIN EXCLUSIVE; INSERT INTO articles VALUES('uncommitted','f','{}')");const r=new Reader(f.premium);r.query('SELECT * FROM articles');assert(r.evidence.some(v=>v.state==='busy'));r.close();f.p.exec('ROLLBACK');}finally{f.close();}
});
test('states do not confuse normal exits, overdue jobs, SMTP acceptance or partial batches',()=>{
 const now=new Date('2026-10-23T12:00:00+08:00');
 assert.equal(operation(null,now).state,'unknown');assert.equal(operation({started_at:'2026-10-23T11:59:00+08:00',finished_at:'2026-10-23T11:59:30+08:00',exit_code:0,state:'completed'},now).state,'waiting');
 assert.equal(operation({started_at:'2026-10-23T11:00:00+08:00',finished_at:'2026-10-23T11:01:00+08:00',exit_code:0,state:'completed'},now).state,'overdue');
 assert.equal(operation({started_at:'2026-10-23T11:59:00+08:00',exit_code:1,state:'completed'},now).state,'failed');
 assert.equal(operation({started_at:'2026-10-23T10:00:00+08:00',state:'running'},now).state,'unknown');
 assert.equal(deliveryState([{status:'smtp_accepted'}]),'smtp_accepted');assert.equal(deliveryState([{status:'smtp_accepted'}],2),'pending');assert.equal(deliveryState([{status:'sending'}]),'sending');assert.equal(deliveryState([{status:'smtp_accepted'},{status:'unknown_do_not_retry'}]),'unknown');
});
test('date ranges, filters and pagination reject invalid inputs',()=>{
 assert.throws(()=>range(new URLSearchParams('from=2026-02-30')));assert.throws(()=>range(new URLSearchParams('from=2026-01-01&to=2026-03-01')));assert.throws(()=>range(new URLSearchParams('page=-1')));
 const f=fixture();try{assert.equal(f.dashboard.news('premium',new URLSearchParams({from:f.today,to:f.today,q:'不存在'})).data.total,0);assert.equal(f.dashboard.news('premium',new URLSearchParams({from:f.today,to:f.today,page:'2'})).data.items.length,0);}finally{f.close();}
});
test('credential and URL protections',()=>{const hash=hashPassword('test-password-long');assert(verifyPassword('test-password-long',hash));assert(!verifyPassword('bad',hash));assert.equal(safeUrl('javascript:alert(1)'),null);assert.equal(safeUrl('https://user:pass@example.com'),null);assert.deepEqual(redact({email:'alice@example.com',token:'private',text:'https://e.com/?token=abcdef'}),{email:'***@example.com',text:'https://e.com/?token=[已隐藏]'});});
test('HTTP authentication, session expiry on restart, rate limiting, method and preview protections',async()=>{
 const f=fixture(),hash=hashPassword('test-password-long');const server=createApp({ordinary:f.ordinary,premium:f.premium,runtime:f.runtime},hash);server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address() as any,base=`http://127.0.0.1:${address.port}`;
 try{
  assert.equal((await fetch(base+'/api/overview')).status,401);
  assert.equal((await fetch(base+'/api/login',{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'})).status,403);
  const login=await fetch(base+'/api/login',{method:'POST',body:JSON.stringify({password:'test-password-long'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!;assert(cookie.includes('HttpOnly'));assert(cookie.includes('SameSite=Strict'));
  const headers={Cookie:cookie.split(';')[0]};assert.equal((await fetch(base+'/api/overview',{headers})).status,200);assert.equal((await fetch(base+'/api/news?component=bad',{headers})).status,400);assert.equal((await fetch(base+'/api/news',{method:'POST',headers})).status,405);
  const response=await fetch(base+'/api/issues/shadow-'+f.today+'?from='+f.today+'&to='+f.today+'&component=ordinary',{headers});assert.equal(response.headers.get('content-type'),'application/json; charset=utf-8');assert(response.headers.get('content-security-policy')!.includes("frame-src 'none'"));assert(!(await response.text()).includes('private@example.com'));
  assert.equal((await fetch(base+'/api/logout',{method:'POST',headers})).status,200);assert.equal((await fetch(base+'/api/overview',{headers})).status,401);
  for(let i=0;i<8;i++)assert.equal((await fetch(base+'/api/login',{method:'POST',body:'{"password":"bad"}'})).status,401);
  assert.equal((await fetch(base+'/api/login',{method:'POST',body:'{"password":"test-password-long"}'})).status,429);
 }finally{await new Promise<void>(r=>server.close(()=>r()));f.close();}
});

test('first-fetch date is stable across repeat observations and temporary snapshots are removed',()=>{const f=fixture();try{const previous=new Date(Date.now()-86400000).toISOString(),a={id:'old',title:'旧闻',content_fingerprint:'same',fetched_at:previous};f.p.prepare('INSERT INTO articles VALUES(?,?,?)').run('old','v1',JSON.stringify(a));f.p.prepare('INSERT INTO articles VALUES(?,?,?)').run('old','v2',JSON.stringify({...a,fetched_at:new Date().toISOString()}));const result=f.dashboard.news('premium',new URLSearchParams({from:f.today,to:f.today}));assert.equal(result.data.total,1);const r=new Reader(f.ordinary);r.query('SELECT * FROM issues');const temp=r.snapshotRoot!;r.close();assert.throws(()=>readFileSync(temp+'/state.sqlite3'));}finally{f.close();}});

test('original reader reuses saved source text and separate verified cache without changing business state',()=>{
 const f=fixture();try{
 const article=JSON.parse(f.p.prepare('SELECT data FROM articles').get()!.data as string);article.text='这是已保存的来源正文。';article.content_origin='official_article_html';f.p.prepare('UPDATE articles SET data=?').run(JSON.stringify(article));
 const params=new URLSearchParams({from:f.today,to:f.today}),item=f.dashboard.news('premium',params).data.items[0];const before=hashes(f.root);
 const detail=f.dashboard.news('premium',params,item.id);assert.equal(detail.data.original.kind,'article_text');assert.equal(detail.data.original.text,article.text);assert.deepEqual(hashes(f.root),before);
 const ordinary=f.dashboard.news('ordinary',params).data.items[0];assert.equal(f.dashboard.news('ordinary',params,ordinary.id).data.original.state,'pending');
 }finally{f.close();}
});


test('absent manual receipt confirmation is informational; damaged and required sources still warn',()=>{
 const f=fixture();try{
  const now=new Date().toISOString();f.json(f.runtime+'/ordinary/latest.json',{state:'completed',started_at:now,finished_at:now,exit_code:0});
  const before=hashes(f.root);let overview=f.dashboard.overview()[0];
  assert.equal(overview.read_state,'ok');assert.equal(overview.data.inbox,'not_verified');
  const feedback=overview.evidence.find((e:any)=>e.source==='feedback/'+f.today+'.json');
  assert.equal(feedback.state,'not_recorded');assert.equal(isEvidenceFailure(feedback),false);
  assert.deepEqual(hashes(f.root),before); // Never fabricate a receipt or mutate the ledger.
  f.json(f.ordinary+'/feedback/'+f.today+'.json',{status:'received_confirmed',confirmed_by:'user'});
  overview=f.dashboard.overview()[0];assert.equal(overview.data.inbox,'received_confirmed');assert.equal(overview.read_state,'ok');
  writeFileSync(f.ordinary+'/feedback/'+f.today+'.json','{bad json');
  overview=f.dashboard.overview()[0];assert.equal(overview.data.inbox,'not_verified');assert.equal(overview.read_state,'partial');
  assert(overview.evidence.some((e:any)=>e.source.startsWith('feedback/')&&e.state==='unreadable'&&isEvidenceFailure(e)));
  const r=new Reader(f.ordinary);r.file('required-file.json');assert.equal(r.evidence[0].state,'missing');assert(isEvidenceFailure(r.evidence[0]));r.close();
  assert(isEvidenceFailure({state:'busy'}));assert(isEvidenceFailure({state:'unreadable'}));
 }finally{f.close();}
});
