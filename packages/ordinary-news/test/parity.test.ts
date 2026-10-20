import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { selectedItems,formatNews,buildMessage,unsubscribeLink } from '../src/email.ts';
import { parseHtml,parseRss,calculateScore,parseGrade,parseMarkdown,sortItems } from '../src/archive.ts';
import { titleExclusion } from '../../news-common/src/filter.ts';
import { verifySubscriptionToken } from '../../news-common/src/tokens.ts';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const python=process.env.PYTHON??(existsSync(root+'.venv/bin/python')?root+'.venv/bin/python':'python3');
function oracle(cases:any[]) {const r=spawnSync(python,[root+'packages/ordinary-news/tools/python-reference.py'],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:40*1024*1024});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
const normalize=(s:string)=>s.replace(/>\s+</g,'><').trim();
test('at least seven real archived dates preserve sorted order, 25-item filtering and ordinary HTML',()=>{
 const archive=root+'news_archive';const paths=readdirSync(archive).filter(n=>/^\d{4}-\d\d$/.test(n)).sort().flatMap(m=>readdirSync(archive+'/'+m).filter(n=>/^\d\d\.md$/.test(n)&&n!=='00.md').sort().map(n=>archive+'/'+m+'/'+n)).slice(-7);
 assert.equal(paths.length,7);
 const cases=paths.map(p=>({op:'render',markdown:readFileSync(p,'utf8'),name:'测试 <姓名> & "引号"',date:'2026年10月21日',unsubscribe:'https://example.test/?token=a&b=c',notifications:{start_notification:'开始 <通知>',end_notification:'结束 & 通知',end_comment:'注释'}}));
 const expected=oracle(cases);
 cases.forEach((c,i)=>{const body=formatNews(selectedItems(c.markdown));assert.equal(body,expected[i].body);assert.equal(normalize(buildMessage(c.name,body,c.date,c.notifications,c.unsubscribe)),normalize(expected[i].html));});
 const sortCases=paths.map(p=>{const markdown=readFileSync(p,'utf8'),items=parseMarkdown(markdown);return {op:'sort',markdown,values:Object.fromEntries(items.map(([,u],i)=>[u,i%7===0?-100:i%11]))};});
 const sortExpected=oracle(sortCases);
 sortCases.forEach((c,i)=>{const items=parseMarkdown(c.markdown);const values=Object.fromEntries(items.map(([t,u])=>[u,titleExclusion(t)?-1000:c.values[u]]));assert.deepEqual(sortItems(items,values),sortExpected[i].items);});
});
test('empty and optional notices render like Python; unranked fallback and HTML escaping match',()=>{
 const markdown='# 未排序\n'+Array.from({length:35},(_,i)=>`- [${i%3===0?'短题':i%5===0?'华为资讯禁止':'普通科技标题充分长度'}${i}](https://example.test/${i}?a=1&b=2)`).join('\n');
 const cases=([{}, {end_notification:'结尾'}, {end_comment:'注释'}, {start_notification:'<请看>'}] as Record<string,string>[]).map(notifications=>({op:'render',markdown,name:'名字',date:'2026年10月21日',unsubscribe:'',notifications}));
 const expected=oracle(cases);cases.forEach((c,i)=>{const body=formatNews(selectedItems(markdown));assert.equal(body,expected[i].body);assert.equal(normalize(buildMessage(c.name,body,c.date,c.notifications,c.unsubscribe)),normalize(expected[i].html));});
});
test('HTML/RSS time normalization, scoring formulas and malformed grades match legacy',()=>{
 const raw='<ul class="datel"><li><a class="c">科技</a><a class="t" href="https://www.ithome.com/1/015/001.htm">新科技 &amp; 软件</a><i>2026-10-20 01:02:03</i></li><li><a class="t">残缺</a></li></ul>';
 const rss='<rss><channel><item><title>中文新技术</title><link>https://www.ithome.com/1/015/001.htm</link><pubDate>Mon, 19 Oct 2026 23:02:03 +0000</pubDate></item></channel></rss>';
 const grades=[[0,0],[0,4],[4,0],[10,5],[1,7]];
 const expected=oracle([{op:'html',raw},{op:'rss',raw:rss},...grades.map(votes=>({op:'grade',votes}))]);
 const adapt=(r:any[])=>r.map(({link,...a})=>({...a,link}));
 assert.deepEqual(adapt(parseHtml(raw)),adapt(expected[0]));assert.deepEqual(adapt(parseRss(rss)),adapt(expected[1]));
 grades.forEach((v,i)=>assert.equal(calculateScore(v[0],v[1]),expected[i+2]));assert.deepEqual(parseGrade('<div id="sgrade2"><div>12</div></div><div id="sgrade0"><div>3</div></div>'),[12,3]);assert.throws(()=>parseGrade('<html>error</html>'));
});
test('ordinary unsubscribe keeps version-2 signature and explicit 45-day expiry',()=>{
 const now=new Date('2026-10-21T06:30:00+08:00'),secret='test-only-secret';const link=unsubscribeLink('User@Example.test','https://example.test/',secret,now);
 const token=new URL(link).searchParams.get('unsubscribe_token')!;
 assert.equal(verifySubscriptionToken(token,'unsubscribe',secret,new Date(now.getTime()+45*86400000-1000)).email,'user@example.test');
 assert.throws(()=>verifySubscriptionToken(token,'unsubscribe',secret,new Date(now.getTime()+45*86400000)));
 assert.throws(()=>verifySubscriptionToken(token,'confirm',secret,now));
});
