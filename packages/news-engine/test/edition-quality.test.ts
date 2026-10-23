import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.ts';
import { atomic, policy, pyjson } from '../src/core.ts';
import { editionInput, validateEditionReview } from '../src/edition-quality.ts';
import { reviewEdition, checkedEdition, editionExclusions } from '../src/edition-review.ts';
import { limitDomains, publisherKey, publisherCapacityReached } from '../src/editorial-policy.ts';
import { duplicate, select } from '../src/editor.ts';
import { evaluate, preferences } from '../src/ranking.ts';

const clock = new Date('2026-10-20T05:40:00+08:00');
const deadline = '2026-10-20T06:15:00+08:00';
const domains = ['AI 模型', '开源编译器', 'GPU 芯片', '火箭', '机器人', '安全漏洞', '手机', '科技公司'];
const records = () => Array.from({length: 22}, (_, i) => ({article: {id: String(i), title: domains[i % 8] + '技术进展 ' + i,
  url: `https://publisher${i % 7}.example/${i}`, source: 'test', source_name: 'test', text: '原文说明各项技术的具体变化与限定条件。'.repeat(20),
  content_fingerprint: 'fingerprint-' + i, content_status: 'usable_excerpt', published_at: '2026-10-20T03:00:00+08:00'},
  result: {title: '中文技术进展 ' + i, summary: '公司公布技术变化，仍为有限测试。', short_summary: '公司公布技术测试。', points: [], why: ''}}));

test('IT之家 allows exactly eight overall and two leads across distinct domains, including HN links', () => {
  const rows = records();
  // Fill leads with three other publishers, then all eight remaining IT之家 slots can participate.
  for (let i = 0; i < rows.length; i++) if (i < 2 || i >= 5 && i < 14) rows[i].article.url = 'https://www.ithome.com/' + i;
  const rejected: any[] = []; const chosen = limitDomains(rows, rejected);
  assert.equal(chosen.filter(r => publisherKey(r.article) === 'ithome.com').length, 8);
  assert.equal(chosen.slice(0,5).filter(r => publisherKey(r.article) === 'ithome.com').length, 2);
  assert.ok(rejected.some(r => r.reason === 'publisher_capacity'));
  assert.equal(publisherCapacityReached({url:'https://www.ithome.com/hn'}, chosen),true);
});

test('cross-language merger reports cluster while FSD and shareholder agenda remain separate', () => {
  const a = {title:'SpaceX总裁关注特斯拉账号，合并传闻再起', url:'https://a.example', content_fingerprint:'a'};
  const b = {title:'Tesla proxy contains SpaceX merger clues', url:'https://b.example', content_fingerprint:'b'};
  assert.equal(duplicate(a,b),true);
  assert.equal(duplicate(a,{...b,title:'Tesla schedules annual shareholder meeting'}),false);
  assert.equal(duplicate(a,{...b,title:'Tesla Japan still targets FSD launch in 2026'}),false);
  assert.equal(duplicate({title:'软件安全漏洞修复'}, {title:'SpaceX火箭发射'}),false);
  const source = records()[0].article;
  const [chosen] = select([{...source,...a,id:'weak',text:'短原文'}, {...source,...b,id:'strong',text:'详尽证据。'.repeat(1200),fetched_at:clock.toISOString()},
    ].map(a => ({...a,fetched_at:clock.toISOString()})),clock.toISOString(),true);
  assert.equal(chosen.length,1); assert.equal(chosen[0].id,'strong');
});

test('interest remains while trivia, local chargers and routine RC rank below substantive news', () => {
  const a = records()[0].article;
  const score = (title: string) => evaluate({...a,title},clock.toISOString(),preferences());
  assert.ok(score('Tesla FSD 正式上线').score > score('Tesla opens new Supercharger site').score);
  assert.ok(score('Tesla FSD 正式上线').score > score('Tesla Roadster banana stopwatch').score);
  assert.ok(score('Apple 发布重要安全修复').score > score('Apple releases iOS 27.2 RC').score);
  assert.equal(score('Tesla Roadster banana stopwatch').breakdown.interest_bonus,12);
});

test('edition review requires complete coverage and attributable verbatim conflict evidence', () => {
  const input=editionInput(records());
  const valid={checked_ids:input.articles.map((a:any)=>a.id),exclusions:[{id:'0',reason:'conflicting_facts',related_ids:['1'],
    evidence:[{id:'0',quote:input.articles[0].text.slice(0,16)},{id:'1',quote:input.articles[1].text.slice(0,16)}],detail:'同一会议出现不同日期'}]};
  assert.equal(validateEditionReview(valid,input),valid);
  assert.throws(()=>validateEditionReview({...valid,checked_ids:valid.checked_ids.slice(1)},input));
  assert.throws(()=>validateEditionReview({...valid,exclusions:[{...valid.exclusions[0],evidence:[{id:'0',quote:'编造的证据根本不存在'}]}]},input));
  assert.throws(()=>validateEditionReview({...valid,exclusions:[{...valid.exclusions[0],related_ids:['999']}]},input));
});

test('audited reserve replaces rejected article; changed draft, next day and unaudited pool fail closed', async () => {
  const root=mkdtempSync(tmpdir()+'/edition-review-');const store=new Store(root);atomic(root+'/trial.json',{schema_version:1,mode:'internal_test',enabled:true,model_enabled:true,production_enabled:false,start:'2026-10-19',days:7,expires_at:'2026-10-26T00:00:00+08:00',allowed_recipient:'nowscott@qq.com',daily_budget_cny:2});const rows=records();
  const prices=policy(); let posts=0;
  try {
    rows[0].result.summary='特斯拉年度股东大会定于12月3日。';rows[1].result.summary='特斯拉股东大会定于12月6日。';
    const deps={now:()=>clock,verify:async()=>true,token:'test-token',fetcher:(async (_url:any,options:any)=>{
      posts++;const body=JSON.parse(options.body);const input=JSON.parse(body.messages[1].content);
      return Response.json({usage:{prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:'stop',message:{content:JSON.stringify({
        checked_ids:input.articles.map((a:any)=>a.id),exclusions:[{id:'1',reason:'conflicting_facts',related_ids:['0'],detail:'会议日期不同且无修订证据',
        evidence:[{id:'0',quote:rows[0].result.summary},{id:'1',quote:rows[1].result.summary}]}]})}}]});
    }) as typeof fetch};
    assert.equal(checkedEdition(store,rows,deadline).length,0);
    assert.equal((await reviewEdition(store,rows,prices,deadline,undefined,deps)).status,'edition_reviewed');
    const rejected:any[]=[];const chosen=checkedEdition(store,rows,deadline,rejected);
    assert.equal(chosen.length,20); assert.ok(!chosen.some(r=>r.article.id==='1'));assert.ok(chosen.some(r=>Number(r.article.id)>=20));
    assert.ok(rejected.some(r=>r.reason==='edition_conflicting_facts'));
    const changed=structuredClone(rows);changed[0].result.summary='已改写的草稿不允许复用原审稿';
    assert.ok(!checkedEdition(store,changed,deadline).some(r=>r.article.id==='0'));
    assert.equal(checkedEdition(store,rows,'2026-10-21T06:15:00+08:00').length,0);
    assert.equal(editionExclusions(store,rows,deadline).length,21);
    await reviewEdition(store,rows,prices,deadline,undefined,deps);assert.equal(posts,1);
    assert.equal(store.one('SELECT COUNT(*) n FROM calls')!.n,1);
    assert.equal(JSON.parse(store.one("SELECT data FROM meta WHERE key='edition_review'")!.data).version,'edition-consistency-1');
  } finally {store.db.close();rmSync(root,{recursive:true,force:true});}
});

test('unknown edition audit usage never retries; requests outside paid window never POST', async () => {
  const root=mkdtempSync(tmpdir()+'/edition-unknown-');const store=new Store(root);atomic(root+'/trial.json',{schema_version:1,mode:'internal_test',enabled:true,model_enabled:true,production_enabled:false,start:'2026-10-19',days:7,expires_at:'2026-10-26T00:00:00+08:00',allowed_recipient:'nowscott@qq.com',daily_budget_cny:2});const rows=records();let posts=0;
  try {
    const deps={now:()=>clock,verify:async()=>true,token:'test-token',fetcher:(async ()=>{posts++;throw new Error('unknown transport');}) as typeof fetch};
    await reviewEdition(store,rows,policy(),deadline,undefined,deps);
    await reviewEdition(store,rows,policy(),deadline,undefined,deps);
    assert.equal(posts,1);assert.equal(checkedEdition(store,rows,deadline).length,0);
    const more=records();more[0].result.summary='不同草稿';
    const blocked=await reviewEdition(store,more,policy(),deadline,undefined,{...deps,now:()=>new Date('2026-10-20T09:05:00+08:00')});
    assert.equal(blocked.status,'outside_window_or_margin');assert.equal(posts,1);
  } finally {store.db.close();rmSync(root,{recursive:true,force:true});}
});

test('malformed known-cost edition responses get at most three attempts; budget blocks audit POST', async () => {
  const root=mkdtempSync(tmpdir()+'/edition-invalid-');const store=new Store(root);atomic(root+'/trial.json',{schema_version:1,mode:'internal_test',enabled:true,model_enabled:true,production_enabled:false,start:'2026-10-19',days:7,expires_at:'2026-10-26T00:00:00+08:00',allowed_recipient:'nowscott@qq.com',daily_budget_cny:2});let posts=0;
  const deps={now:()=>clock,verify:async()=>true,token:'test-token',fetcher:(async ()=>{
    posts++;return Response.json({usage:{prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:'stop',message:{content:'{"checked_ids":[],"exclusions":[]}'}}]});
  }) as typeof fetch};
  try {
    for(let i=0;i<5;i++) await reviewEdition(store,records(),policy(),deadline,undefined,deps);
    assert.equal(posts,3);assert.equal(checkedEdition(store,records(),deadline).length,0);
    store.run('INSERT INTO calls(day,job,reserved,status) VALUES (?,?,?,?)','2026-10-20','unknown-budget',2,'reserved');
    const changed=records();changed[0].result.summary='不同的待审稿件';
    assert.equal((await reviewEdition(store,changed,policy(),deadline,undefined,deps)).status,'budget_exhausted');
    assert.equal(posts,3);
  } finally {store.db.close();rmSync(root,{recursive:true,force:true});}
});
