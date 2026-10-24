import {test} from 'node:test';
import {load} from 'cheerio/slim';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {once} from 'node:events';
import {Dashboard,day} from '../server/data.ts';
import {sanitizeEmail,PREVIEW_CSP} from '../server/mail-preview.ts';
import {createApp} from '../server/main.ts';
import {hashPassword} from '../server/security.ts';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const malicious=`<!doctype html><html><head><meta http-equiv="refresh" content="0;url=https://evil.example"><style>@media(max-width:500px){.pad{padding:12px}}</style><style>@import 'https://evil.example/style';</style></head><body style="background:#fff"><table width="680" cellpadding="0" style="font-family:Georgia;color:#172719"><tr><td><h1>冻结邮件</h1><p>版本正文</p><a href="https://example.com/?unsubscribe_token=PRIVATE_SIGNED_TOKEN" onclick="alert(1)">退订</a><img src="https://evil.example/pixel" alt="图片"><script>alert(1)</script><form action="https://evil.example"><input></form><div style="background: url(https://evil.example)">test</div></td></tr></table></body></html>`;
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'etn-home-')),ordinary=root+'/ordinary',premium=root+'/premium',runtime=root+'/runtime';for(const p of [ordinary,premium,runtime])mkdirSync(p);
 const date=day(),stamp=new Date().toISOString(),id='test-'+date,oid='shadow-'+date;
 const json=(file:string,v:any)=>{mkdirSync(join(file,'..'),{recursive:true});writeFileSync(file,JSON.stringify(v));};
 const p=new DatabaseSync(premium+'/state.sqlite3');p.exec('CREATE TABLE issues(id TEXT,data TEXT);CREATE TABLE articles(id,fingerprint,data);CREATE TABLE jobs(key,article,status,result,attempts);CREATE TABLE calls(id,day,cost,reserved,status);');
 const articles=Array.from({length:7},(_,i)=>({id:'a'+i,content_fingerprint:'fp'+i,title:'原始标题'+i,url:'https://www.ithome.com/'+i,fetched_at:stamp,source_name:'来源'+(i%2),text:'来源原文'+i,content_origin:'official_article_html',ranking:{version:'editorial-6',score:90-i}}));
 for(const a of articles){p.prepare('INSERT INTO articles VALUES(?,?,?)').run(a.id,a.content_fingerprint,JSON.stringify(a));p.prepare('INSERT INTO jobs VALUES(?,?,?,?,?)').run(a.id,JSON.stringify(a),'queued',JSON.stringify({title:'后来改变的稿件',summary:'不能用作冻结精选'}),1);}
 const issue={id,kind:'newsletter',mode:'daily_24h',frozen_at:stamp,collection_cutoff:stamp,articles,html_sha256:digest(malicious)};
 p.prepare('INSERT INTO issues VALUES(?,?)').run(id,JSON.stringify(issue));
 json(premium+'/issues/'+id+'/comparison.json',{issue,records:articles.map((a,i)=>({article:a,result:{title:'冻结中文标题'+i,short_summary:'冻结摘要'+i},status:'ai_approved',ai_review:'passed'}))});
 writeFileSync(premium+'/issues/'+id+'/email.html',malicious);writeFileSync(premium+'/issues/'+id+'/email.txt','冻结纯文本');
 json(premium+'/deliveries/'+digest('receipt')+'.json',{issue:id,status:'smtp_accepted',recipient:'one@example.com',accepted_at:stamp});
 const o=new DatabaseSync(ordinary+'/state.sqlite3');o.exec('CREATE TABLE issues(id,day,mode,data);CREATE TABLE grades(day,url,score,status,data);CREATE TABLE deliveries(id,issue,email,status,attempts,data);');
 const oi={id:oid,day:date,news_day:date,frozen_at:stamp,mode:'shadow',items:[['普通冻结标题','https://www.ithome.com/ordinary']],body:'这不是实际发送版式'};
 o.prepare('INSERT INTO issues VALUES(?,?,?,?)').run(oid,date,'shadow',JSON.stringify(oi));
 const add=(id:string,status:string,at:string,html:string)=>o.prepare('INSERT INTO deliveries VALUES(?,?,?,?,?,?)').run(id,oid,id+'@example.com',status,1,JSON.stringify({accepted_at:at,started_at:at,html}));
 add('older','smtp_accepted','2026-10-23T06:30:00+08:00','<h1>较早收件版本</h1>');add('latest','smtp_accepted','2026-10-24T06:30:00+08:00','<h1>最近已接收版本</h1>');add('pending','pending','2026-10-24T07:30:00+08:00','<h1>尚未发送版本</h1>');
 mkdirSync(ordinary+'/news_archive/'+date.slice(0,7),{recursive:true});writeFileSync(ordinary+'/news_archive/'+date.slice(0,7)+'/'+date.slice(8)+'.md','- [普通新闻](https://www.ithome.com/ordinary)\n');
 const dashboard=new Dashboard({ordinary,premium,runtime});
 return{root,ordinary,premium,runtime,p,o,date,id,oid,issue,json,dashboard,close(){p.close();o.close();rmSync(root,{recursive:true,force:true});}};
}
function fingerprint(root:string):string{let s='';function walk(p:string){for(const e of readdirSync(p,{withFileTypes:true})){const file=join(p,e.name);if(e.isDirectory())walk(file);else if(!e.name.endsWith('-shm'))s+=file+digest(readFileSync(file,'utf8'));}}walk(root);return digest(s);}
test('homepage uses frozen order and snapshots, returns six separate new stories and original-reader features',()=>{
 const f=fixture();try{const before=fingerprint(f.root),home=f.dashboard.home('premium');assert.equal(home.data.highlights.length,5);assert.equal(home.data.highlights[0].title,'冻结中文标题0');assert.equal(home.data.highlights[0].summary,'冻结摘要0');assert.equal(home.data.highlights[4].index,4);assert.equal(home.data.edition.source_count,2);assert.equal(home.data.edition.delivery,'smtp_accepted');assert.equal(home.data.recent.length,6);assert(!JSON.stringify(home.data.highlights).includes('后来改变'));
 const feature=f.dashboard.feature('premium',f.id,0);assert.equal(feature.data.title,'冻结中文标题0');assert.equal(feature.data.original.text,'来源原文0');assert.equal(feature.data.rewrite.title,'冻结中文标题0');
 const ordinary=f.dashboard.home('ordinary').data;assert.equal(ordinary.highlights[0].title,'普通冻结标题');assert.equal(ordinary.highlights[0].summary,undefined);assert.equal(ordinary.recent[0].fetched_at,null);assert.deepEqual(fingerprint(f.root),before);
 }finally{f.close();}
});
test('old editions keep dates; diagnostics, empty editions and missing frozen evidence never invent highlights',()=>{
 const f=fixture();try{const old={...f.issue,frozen_at:'2026-10-20T06:15:00+08:00',collection_cutoff:'2026-10-20T06:15:00+08:00'};f.p.prepare('UPDATE issues SET data=?').run(JSON.stringify(old));let h=f.dashboard.home('premium').data;assert.equal(h.edition.is_today,false);assert.equal(h.edition.date,'2026-10-20');
 f.p.prepare('UPDATE issues SET data=?').run(JSON.stringify({...old,kind:'diagnostic'}));h=f.dashboard.home('premium').data;assert.equal(h.edition.kind,'diagnostic');assert.equal(h.highlights.length,0);
 f.p.exec('DELETE FROM issues');h=f.dashboard.home('premium').data;assert.equal(h.edition,null);assert.deepEqual(h.highlights,[]);
 }finally{f.close();}
});
test('safe preview keeps presentation and media queries but strips executable content, links and tracking resources',()=>{
 const html=sanitizeEmail(malicious);assert(html.includes('font-family:Georgia'));assert(html.includes('background:#fff'));assert(html.includes('width="680"'));assert(html.includes('@media'));assert(load(html).text().includes('冻结邮件'));assert(!html.includes('PRIVATE_SIGNED_TOKEN'));assert(!/href=|src=|onclick=|<script|<form|<input|<meta[^>]+refresh|evil\.example|@import/.test(html));assert(PREVIEW_CSP.includes("default-src 'none'"));assert(PREVIEW_CSP.includes('sandbox'));
});
test('actual ledger versions, missing HTML and failed hashes have explicit states without reconstructing templates',()=>{
 const f=fixture();try{let v=f.dashboard.preview('ordinary',f.oid).data;assert.equal(v.selected,'latest');assert(load(v.html).text().includes('最近已接收版本'));assert(!load(v.html).text().includes('这不是实际发送版式'));assert.equal(v.versions.length,3);assert.equal(v.versions[0].recipient,'***@example.com');
 v=f.dashboard.preview('ordinary',f.oid,'pending').data;assert.equal(v.status,'pending');assert(load(v.html).text().includes('尚未发送版本'));assert.throws(()=>f.dashboard.preview('ordinary',f.oid,'invalid'),/not_found/);
 assert.equal(f.dashboard.preview('premium',f.id).data.state,'available');writeFileSync(f.premium+'/issues/'+f.id+'/email.html','changed');v=f.dashboard.preview('premium',f.id).data;assert.equal(v.reason,'saved_hash_mismatch');assert.equal(v.html,null);
 rmSync(f.premium+'/issues/'+f.id+'/email.html');assert.equal(f.dashboard.preview('premium',f.id).data.reason,'saved_html_missing');
 f.o.prepare('UPDATE deliveries SET data=?').run('{}');assert.equal(f.dashboard.preview('ordinary',f.oid).data.state,'unavailable');
 }finally{f.close();}
});
test('home, original features and isolated HTML routes require auth and use an independent preview CSP',async()=>{
 const f=fixture(),server=createApp({ordinary:f.ordinary,premium:f.premium,runtime:f.runtime},hashPassword('test-password-long'));server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+(server.address() as any).port;
 try{assert.equal((await fetch(base+'/api/home')).status,401);assert.equal((await fetch(base+'/api/issues/'+f.id+'/preview')).status,401);
 const login=await fetch(base+'/api/login',{method:'POST',body:JSON.stringify({password:'test-password-long'})}),headers={Cookie:login.headers.get('set-cookie')!.split(';')[0]};
 assert.equal((await fetch(base+'/api/home?component=premium',{headers})).status,200);assert.equal((await fetch(base+'/api/issues/'+f.id+'/articles/0?component=premium',{headers})).status,200);
 const response=await fetch(base+'/api/issues/'+f.id+'/preview?component=premium',{headers});assert.equal(response.status,200);assert(response.headers.get('content-type')!.startsWith('text/html'));assert.equal(response.headers.get('content-security-policy'),PREVIEW_CSP);assert(!response.headers.get('x-frame-options'));assert(!(await response.text()).includes('PRIVATE_SIGNED_TOKEN'));
 const detail=await fetch(base+'/api/issues/'+f.id+'?component=premium',{headers});assert((await detail.json()).data.preview);assert(!detail.headers.get('content-security-policy')!.includes("style-src 'unsafe-inline'"));
 assert.equal((await fetch(base+'/api/issues/'+f.id+'/preview',{method:'POST',headers})).status,405);
 }finally{await new Promise<void>(r=>server.close(()=>r()));f.close();}
});
