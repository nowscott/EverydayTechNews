import { test } from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {Store} from '../src/store.ts';
import {atomic,atomicText,hash} from '../src/core.ts';
import {saveNews,recoverArchive,archivePath,collect,rank,parseMarkdown} from '../src/archive.ts';
import {subscribers,markAbnormal} from '../src/subscribers.ts';
import {syncArchive} from '../src/sync.ts';
const clock=new Date('2026-10-21T00:30:00+08:00');
test('collection preserves monthly dedupe, frozen daily files and cross-month publication dates',()=>{
 const root=mkdtempSync(tmpdir()+'/ordinary-archive-');
 try{atomicText(archivePath(root,'2026-10-20'),'# sorted (sorted)\n');
  const n={title:'新软件公开重要技术更新',link:'https://www.ithome.com/1/015/100.htm',time:'2026-10-20T23:40:00',category:'科技'};
  saveNews(root,clock,[n,n,{...n,title:'不同月份公开技术消息',link:n.link+'/new',time:'2026-09-30T23:59:00'}]);
  assert.equal(readFileSync(archivePath(root,'2026-10-20'),'utf8'),'# sorted (sorted)\n');
  assert.equal(parseMarkdown(readFileSync(root+'/news_archive/2026-10/00.md','utf8')).length,1);
  assert.match(readFileSync(archivePath(root,'2026-09-30'),'utf8'),/不同月份/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('RSS fallback, grade cache and explicit failed-score statistics work without production services',async()=>{
 const root=mkdtempSync(tmpdir()+'/ordinary-source-');const store=new Store(root);let grades=0;
 try{
  const rss='<rss><channel><item><title>充分长度的普通科技消息</title><link>https://www.ithome.com/1/015/101.htm</link><pubDate>Tue, 20 Oct 2026 22:30:00 +0800</pubDate></item></channel></rss>';
  const fetcher=(async(url:any)=>{if(String(url).includes('/list/'))return new Response('',{status:403});return new Response(rss);}) as typeof fetch;
  assert.equal((await collect(store,clock,fetcher)).source,'rss');
  const grade=(async()=>{grades++;return new Response('<div id="sgrade2"><div>9</div></div><div id="sgrade0"><div>1</div></div>');}) as typeof fetch;
  const first=await rank(store,clock,grade);assert.equal(first.valid,1);await rank(store,clock,grade);assert.equal(grades,1);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
test('Notion pagination deduplicates addresses, applies status and premium routing, and guards status updates',async()=>{
 const row=(email:string,status='正常',premium=false)=>({id:'page',properties:{Name:{title:[]},Email:{email},状态:{select:{name:status}},高级订阅:{checkbox:premium}}});
 let patches=0;const fetcher=(async(url:any,options:any)=>{
  if(String(url).endsWith('/pages/page')){if(options.method==='PATCH'){patches++;return Response.json({});}return Response.json(row('a@example.test','已退订'));}
  const cursor=JSON.parse(options.body).start_cursor;
  return Response.json(cursor?{results:[row('A@EXAMPLE.TEST'),row('p@example.test','正常',true)],has_more:false}:{results:[row('a@example.test'),row('bad@example.test','异常')],has_more:true,next_cursor:'second'});
 }) as typeof fetch;
 const env={NOTION_API_KEY:'test',NOTION_DATA_SOURCE_ID:'source',PREMIUM_PRODUCTION_ENABLED:'true'};
 const users=await subscribers(env,fetcher);assert.equal(users.length,1);assert.equal(users[0].name,'订阅者');
 assert.equal(await markAbnormal(users[0],env,fetcher),'status_changed_not_overwritten');assert.equal(patches,0);
 const loop=(async()=>Response.json({results:[],has_more:true,next_cursor:'same'})) as typeof fetch;
 await assert.rejects(subscribers(env,loop),/pagination/);
});
const sha=(content:string)=>createHash('sha1').update('blob '+Buffer.byteLength(content)+'\0'+content).digest('hex');
test('archive publisher is shadow-disabled, detects conflicts and uses compare-and-set without force',async()=>{
 const root=mkdtempSync(tmpdir()+'/ordinary-sync-'),archive=root+'/archive',state=root+'/sync';const path='news_archive/2026-10/20.md';
 atomicText(archive+'/2026-10/20.md','new content');atomic(state+'/baseline.json',{files:{[path]:sha('old content')}});
 let remote=sha('old content'),commits=0,patches=0,dropResponse=true;const visited:any[]=[];
 const fetcher=(async(url:any,options:any)=>{
  const u=String(url);const body=options.body?JSON.parse(options.body):null;visited.push({u,body});
  if(u.includes('/actions/workflows/'))return Response.json({state:'disabled_manually'});
  if(u.endsWith('/git/ref/heads/main'))return Response.json({object:{sha:'head'}});
  if(u.endsWith('/git/commits/head'))return Response.json({tree:{sha:'tree'}});
  if(u.includes('/git/trees/tree?'))return Response.json({tree:[{path,sha:remote,type:'blob'},{path:'README.md',sha:'untouched',type:'blob'}]});
  if(u.endsWith('/git/blobs'))return Response.json({sha:sha(body.content)});
  if(u.endsWith('/git/trees')){assert.ok(body.tree.every((r:any)=>r.path.startsWith('news_archive/')));return Response.json({sha:'newtree'});}
  if(u.endsWith('/git/commits')){commits++;return Response.json({sha:'commit'});}
  if(u.endsWith('/git/refs/heads/main')){patches++;assert.equal(body.force,false);remote=sha('new content');if(dropResponse)throw new Error('unknown update response');return Response.json({});}
  throw new Error('unexpected API');
 }) as typeof fetch;
 try{
  assert.equal((await syncArchive(archive,state,{mode:'shadow'},'test',fetcher)).status,'disabled_in_shadow');assert.equal(visited.length,0);
  const c={mode:'production',archive_sync_enabled:true};assert.equal((await syncArchive(archive,state,c,'',fetcher)).status,'archive_credential_missing');
  remote=sha('conflicting manual edit');assert.equal((await syncArchive(archive,state,c,'test',fetcher)).status,'archive_conflict_preserved');assert.equal(commits,0);
  remote=sha('old content');assert.equal((await syncArchive(archive,state,c,'test',fetcher)).status,'archive_sync_failed');
  assert.equal((await syncArchive(archive,state,c,'test',fetcher)).status,'synced');assert.equal(commits,1);assert.equal(patches,1);
 }finally{rmSync(root,{recursive:true,force:true});}
});


test('a crash between monthly and daily writes replays the durable archive journal before ranking',()=>{
 const root=mkdtempSync(tmpdir()+'/ordinary-archive-recovery-');
 try{const body='# 今日新闻 - 2026年10月20日\n- [恢复后的完整技术新闻标题](https://www.ithome.com/1/015/999.htm)\n';
  atomic(root+'/archive-journal.json',{updates:[{path:'news_archive/2026-10/20.md',body,sha256:hash(body)}]});
  recoverArchive(root);assert.equal(readFileSync(archivePath(root,'2026-10-20'),'utf8'),body);recoverArchive(root);
  atomic(root+'/archive-journal.json',{updates:[{path:'../escape.md',body,sha256:hash(body)}]});assert.throws(()=>recoverArchive(root),/journal_invalid/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
