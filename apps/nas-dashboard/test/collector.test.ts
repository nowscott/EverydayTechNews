import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { articleUrl, fetchBody, extractBody, collectBodies } from '../server/collector.ts';
import { bodyKey, cachedBody, saveBody, textHash } from '../server/body-cache.ts';
const text='这是来源网站的一段正文，保留真实内容、标点和段落供本地阅读。'.repeat(10);
const html=`<html><head><meta property="og:title" content="新闻标题"></head><body><nav>菜单</nav><div id="paragraph"><p>${text}</p><script>alert('unsafe')</script><iframe src="http://localhost"></iframe><p>第二个段落。</p><div class="ad">广告</div></div></body></html>`;
test('extracts readable paragraphs without HTML, scripts, advertising or page chrome',()=>{
 const v=extractBody(html,'https://www.ithome.com/1/123/456.htm');assert(v.text.includes(text));assert(v.text.includes('\n\n第二个段落'));assert(!v.text.includes('unsafe'));assert(!v.text.includes('广告'));assert(!v.text.includes('菜单'));assert.equal(v.title,'新闻标题');
 assert.throws(()=>extractBody('<article><p>太短</p></article>','https://www.apple.com/newsroom/x'));
 assert.throws(()=>extractBody(`<div class="paywall">订阅</div><article>${text}</article>`,'https://www.bloomberg.com/news/x'));
});
test('only known public HTTPS publishers are eligible, including every redirect',async()=>{
 for(const url of ['http://www.ithome.com/x','https://127.0.0.1/x','https://localhost/x','https://192.168.31.10/x','https://www.ithome.com.evil.example/x','https://user:pass@www.ithome.com/x','https://www.ithome.com:8443/x','https://www.ithome.com/account/x'])assert.throws(()=>articleUrl(url));
 let calls=0;const fetcher=async()=>{calls++;return new Response('',{status:302,headers:{location:'http://127.0.0.1/admin'}});};
 await assert.rejects(fetchBody('https://www.ithome.com/x',fetcher as typeof fetch));assert.equal(calls,1);
});
test('bounded HTML capture, access refusal and unsupported formats stay explicit',async()=>{
 const mock=(body:string,headers:Record<string,string>,status=200)=>(async()=>new Response(body,{status,headers})) as typeof fetch;
 const v=await fetchBody('https://www.ithome.com/x',mock(html,{'content-type':'text/html; charset=utf-8'}));assert.equal(v.state,'available');assert.equal(v.sha256,textHash(v.text!));
 await assert.rejects(fetchBody('https://www.ithome.com/x',mock('blocked',{},403)),/access_restricted/);
 await assert.rejects(fetchBody('https://www.ithome.com/x',mock('image',{'content-type':'image/png'})),/not_html/);
 await assert.rejects(fetchBody('https://www.ithome.com/x',mock('huge',{'content-type':'text/html','content-length':'9999999'})),/too_large/);
});
test('background cache is separate, deduplicated, integrity checked and failure retries bounded',async()=>{
 const root=mkdtempSync(join(tmpdir(),'etn-body-'));try{
 const config={ordinary:'/missing',premium:'/missing',runtime:'/missing'},url='https://www.ithome.com/x';let count=0;
 const fetcher=(async()=>{count++;return new Response(html,{headers:{'content-type':'text/html'}});}) as typeof fetch;
 const items=[{url,title:'标题',component:'ordinary'}];let result=await collectBodies(config,root,{items,fetcher,pauseMs:0});assert.equal(result.completed,1);assert.equal(cachedBody(root,url)?.kind,'article_text');
 result=await collectBodies(config,root,{items,fetcher,pauseMs:0});assert.equal(result.completed,0);assert.equal(count,1);
 const file=join(root,bodyKey(url)+'.json');const data=JSON.parse(readFileSync(file,'utf8'));data.text='tampered';writeFileSync(file,JSON.stringify(data));assert.equal(cachedBody(root,url)?.reason,'cache_unreadable');
 const blocked='https://www.ithome.com/blocked';await collectBodies(config,root,{items:[{url:blocked,component:'ordinary'}],fetcher:(async()=>new Response('',{status:403})) as typeof fetch,pauseMs:0});assert.equal(cachedBody(root,blocked)?.state,'blocked');
 assert(readdirSync(root).every(n=>!n.endsWith('.tmp')));
 }finally{rmSync(root,{recursive:true,force:true});}
});
