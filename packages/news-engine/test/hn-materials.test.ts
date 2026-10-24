import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {materialRequest,parseMaterial} from '../src/hn-materials.ts';
import {fetchSource} from '../src/sources.ts';
import {requestConstraints} from '../src/diagnostics.ts';
const github=readFileSync(new URL('./fixtures/github-release-v2.83.1.json',import.meta.url),'utf8');
const arxiv=readFileSync(new URL('./fixtures/arxiv-1706.03762v1.html',import.meta.url),'utf8');
const release='https://github.com/cli/cli/releases/tag/v2.83.1';
test('real GitHub release snapshot uses its published timestamp and only accepts exact non-draft release material',()=>{
 const req=materialRequest(release)!,r=parseMaterial(github,req);assert.equal(r.body_probe_status,'parsed');assert.equal(r.publication_raw,'2025-11-13T17:11:41Z');assert.equal(r.material_kind,'release_notes');assert.match(r.source_name,/作者自述/);
 for(const change of [{draft:true},{published_at:null},{tag_name:'other'},{body:''},{html_url:'https://github.com/other/repo/releases/tag/v2.83.1'}])assert.notEqual(parseMaterial(JSON.stringify({...JSON.parse(github),...change}),req).body_probe_status,'parsed');
 for(const url of ['https://github.com/cli/cli','https://github.com/cli/cli/blob/main/README.md','https://github.com/cli/cli/releases/latest','https://github.com.evil/cli/cli/releases/tag/a','https://user@github.com/cli/cli/releases/tag/a','https://127.0.0.1/releases/tag/a'])assert.equal(materialRequest(url),null);
 assert.match(requestConstraints({material_kind:'release_notes'}).attribution,/作者自述/);
});
test('real arXiv abstract snapshot is pinned to the requested revision and exact UTC submission time, never latest revision or PDF',()=>{
 const req=materialRequest('https://arxiv.org/abs/1706.03762')!;assert.equal(req.fetch_url,'https://arxiv.org/abs/1706.03762v1');
 const r=parseMaterial(arxiv,req);assert.equal(r.body_probe_status,'parsed');assert.equal(r.publication_raw,'2017-06-12T17:57:34.000Z');assert.equal(r.material_kind,'preprint_abstract');assert.match(r.text,/Attention Is All You Need/);
 assert.equal(parseMaterial(arxiv,materialRequest('https://arxiv.org/abs/1706.03762v7')!).body_probe_status,'paper_version_unconfirmed');
 assert.equal(materialRequest('https://arxiv.org/pdf/1706.03762'),null);
 assert.equal(materialRequest('https://arxiv.org/abs/1706.03762?download=1'),null);
 assert.notEqual(parseMaterial(arxiv.replace('Mon, 12 Jun 2017 17:57:34 UTC','unknown time'),req).body_probe_status,'parsed');
 assert.match(requestConstraints({material_kind:'preprint_abstract'}).attribution,/同行评审/);
});
test('HN material fetches share the existing 12-request budget and never follow redirects, fetch README or PDF',async()=>{
 for(const count of [3,14]){
  const root=mkdtempSync(tmpdir()+'/hn-materials-');let bodies=0;const visited:string[]=[];
  try{
   const fetcher=(async(value:any,options:any)=>{
    const u=String(value);visited.push(u);
    if(u.endsWith('/topstories.json'))return Response.json(Array.from({length:count},(_,i)=>i+1));
    if(u.endsWith('/newstories.json'))return Response.json([]);
    if(/\/item\/\d+\.json$/.test(u)){const id=Number(u.match(/item\/(\d+)/)![1]);return Response.json({id,type:'story',title:'New developer release',url:count===3&&id===2?'https://arxiv.org/abs/1706.03762':count===3&&id===3?'https://github.com/cli/cli':release,time:Math.floor(Date.now()/1000)});}
    bodies++;assert.equal(options.redirect,'manual');assert(!options.headers.Authorization);
    if(u.includes('arxiv.org'))return new Response(arxiv,{headers:{'Content-Type':'text/html'}});
    return new Response(github,{headers:{'Content-Type':'application/json'}});
   }) as typeof fetch;
   const {rows}=await fetchSource('hackernews',root,fetcher);assert.equal(bodies,count===3?2:12);
   if(count===3){assert.equal(rows.filter(a=>a.content_status==='usable_excerpt').length,2);assert.equal(rows.find(a=>a.material_kind==='preprint_abstract')!.published_at,'2017-06-13T01:57:34+08:00');}
   else assert.equal(rows.filter(a=>a.body_probe_status==='body_batch_limit').length,2);
   assert(!visited.some(u=>u.includes('/pdf/')||u.endsWith('/cli/cli')));
   const limited=(async(value:any,options:any)=>{if(String(value).includes('api.github.com')){assert.equal(options.redirect,'manual');return new Response('',{status:429});}return fetcher(value,options);}) as typeof fetch;
   const result=await fetchSource('hackernews',root,limited);assert(result.rows.some(a=>a.body_http_status===429));
  }finally{rmSync(root,{recursive:true,force:true});}
 }
});
