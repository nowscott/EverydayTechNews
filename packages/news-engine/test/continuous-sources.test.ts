import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {atomic,trial,active,trialDeadline,policy,RECIPIENT,digest,pyjson} from '../src/core.ts';
import {Store} from '../src/store.ts';
import {gate,cacheKey,paidRequest} from '../src/model.ts';
import {articleExclusion,publisherKey,publisherMaximum} from '../src/editorial-policy.ts';
import {parseFeed,supplementRegistered} from '../src/sources.ts';
import {reportTrial,due,enrich} from '../src/pool.ts';
import {freezeIssue,sendOnce} from '../src/mail.ts';
function setup(){const root=mkdtempSync(tmpdir()+'/continuous-'),store=new Store(root);const config={schema_version:1,mode:'internal_test',testing_period:'continuous',enabled:true,model_enabled:true,delivery_enabled:true,production_enabled:false,start:'2026-10-19',days:null,expires_at:null,allowed_recipient:RECIPIENT,daily_budget_cny:2};atomic(root+'/trial.json',config);atomic(root+'/test-delivery-config.json',{allowed_recipient:RECIPIENT});return {root,store,config,close(){store.db.close();rmSync(root,{recursive:true,force:true});}};}
test('continuous tests pass the old deadline, retain strict recipient/budget and finite sample permits',()=>{const {root,store,config,close}=setup();try{
 const later=new Date('2026-11-03T05:10:00+08:00');assert.equal(active(trial(root),later),true);assert.equal(trialDeadline(config),Infinity);
 assert.equal(gate(policy(),later,true,undefined,trialDeadline(config)),null);assert.equal(gate(policy(),later,false,undefined,Infinity),'official_rules_unconfirmed');
 assert.equal(gate(policy(),new Date('2026-11-03T06:12:00+08:00'),true,undefined,Infinity),'outside_window_or_margin');
 assert.equal(gate(policy(),later,true,{mode:'internal_test_anytime',issue_id:'sample-expired',expires_at:'2026-11-03T05:00:00+08:00'},Infinity),'test_permit_expired');
 for(const patch of [{daily_budget_cny:3},{allowed_recipient:'other@example.org'},{production_enabled:true},{testing_period:'fixed'}]){atomic(root+'/trial.json',{...config,...patch});assert.throws(()=>trial(root),/invalid_trial_boundary/);}
 atomic(root+'/trial.json',config);const report=reportTrial(store,new Date('2026-11-03T09:00:00+08:00'));assert.equal(report.days.at(-1)?.day,'2026-11-03');assert.equal(report.testing_period,'continuous');assert.equal(due(store,later).enrich,true);
 }finally{close();}});
test('each paid request still verifies live prices; a second failed check makes no extra model POST',async()=>{const {root,store,close}=setup();let verifies=0,posts=0;try{
 const text='公司发布新模型，模型效果尚未经独立验证。'.repeat(20),p=policy();
 for(let i=0;i<2;i++){const a={id:String(i),url:'https://example.org/'+i,title:'AI模型正式发布',source:'mit_ai',source_name:'MIT',published_at:'2026-11-03T04:00:00+08:00',text,content_status:'usable_excerpt',content_fingerprint:digest(text+String(i))};const key=cacheKey(a,p);store.run('INSERT INTO jobs(key,article,status) VALUES (?,?,?)',key,pyjson(a),'queued');
 const outcome=await paidRequest(store,key,a,p,undefined,{now:()=>new Date('2026-11-03T05:10:00+08:00'),token:'test',verify:async()=>++verifies===1,fetcher:(async()=>{posts++;return Response.json({usage:{prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:'stop',message:{content:JSON.stringify({title:'新模型发布',summary:'公司发布新模型。',why:'',points:[],uncertainties:[],claims:[{claim:'发布',evidence:'公司发布新模型，模型效果尚未经独立验证'}]})}}]});}) as typeof fetch});
 assert.equal(outcome,i===0?null:'official_rules_unconfirmed');}
 assert.equal(verifies,2);assert.equal(posts,1);assert.equal(store.all('SELECT * FROM calls').length,1);
 }finally{close();}});
test('continuous SMTP works after October 26 but still blocks 09:00 and never replays accepted mail',async()=>{const {store,close}=setup();const previous={...process.env};let sends=0;try{
 process.env.SENDING_ACCOUNT='sender@example.org';process.env.SENDING_PASSWORD='test';process.env.SERVER='smtp.example.org';
 const spec={id:'test-2026-10-27',kind:'diagnostic',pool_edition:true,collection_cutoff:'2026-10-27T06:15:00+08:00',generation_cutoff:'2026-10-27T06:15:00+08:00',articles:[],rejected:[],source_health:null};freezeIssue(store,spec,[]);
 const deps={transport:{sendMail:async()=>{sends++;return {accepted:[RECIPIENT],rejected:[]};},close(){}},authorize:async()=>true,now:()=>new Date('2026-10-27T06:30:00+08:00')};
 assert.equal((await sendOnce(store,spec.id,deps)).status,'smtp_accepted');await sendOnce(store,spec.id,deps);assert.equal(sends,1);
 const late={...spec,id:'test-2026-10-28',collection_cutoff:'2026-10-28T06:15:00+08:00'};freezeIssue(store,late,[]);await sendOnce(store,late.id,{...deps,now:()=>new Date('2026-10-28T09:00:00+08:00')});assert.equal(sends,1);
 }finally{for(const key of ['SENDING_ACCOUNT','SENDING_PASSWORD','SERVER']){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}close();}});
test('routine GitHub entries are excluded even through HN, while major models and critical vulnerabilities remain',()=>{
 for(const title of ['Industry comparisons in Copilot impact dashboard','Meta API endpoints updated for Actions blob storage','Public monitoring now available with data residency'])assert.equal(articleExclusion({url:'https://github.blog/changelog/example',source:'hackernews',title})?.reason,'routine_platform_changelog');
 for(const title of ['Introducing Claude Opus 5 in GitHub Copilot','Critical vulnerability CVE-2026-1234 fixed','Introducing autonomous coding agent'])assert.equal(articleExclusion({url:'https://github.blog/news/example',title}),null);
 assert.equal(publisherMaximum({url:'https://github.blog/news/example'}),1);assert.equal(publisherKey({url:'https://research.google/blog/test'}),publisherKey({url:'https://deepmind.google/blog/test'}));
});
test('registered short feeds require dated canonical article bodies, reject arbitrary hosts and never follow redirects',async()=>{const {root,close}=setup();try{
 const published=new Date(Date.now()-60000).toISOString(),raw=`<rss><channel><item><title>AI model research</title><link>https://huggingface.co/blog/test</link><pubDate>${published}</pubDate><description>Only a teaser</description></item></channel></rss>`;
 const rows=parseFeed(raw,'huggingface',new Date().toISOString());assert.equal(rows[0].content_status,'discovery_only');let requests=0;
 await supplementRegistered(rows,root,(async(_url:any,options:any)=>{requests++;assert.equal(options.redirect,'manual');return new Response(`<link rel="canonical" href="https://huggingface.co/blog/test"><article><h1>Research</h1><p>${'Detailed evidence supports a new research result. '.repeat(20)}</p></article>`);}) as typeof fetch,'huggingface');
 assert.equal(rows[0].content_status,'usable_excerpt');assert.equal(rows[0].original_article_published_at,rows[0].published_at);assert.equal(requests,1);
 const bad:any[]=[{...rows[0],url:'https://evil.example/blog/test',published_time_kind:'rss_article_publication'}];await supplementRegistered(bad,root,(async()=>{throw Error('must not fetch');}) as typeof fetch,'huggingface');assert.equal(bad[0].body_probe_status,'body_url_not_allowlisted');
 }finally{close();}});

test('scheduled enrich uses the configured continuous deadline after the legacy expiry',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-26T05:30:00+08:00')});
 const {store,close}=setup();let requests=0;
 t.mock.method(globalThis,'fetch',(async()=>{requests++;throw Error('unexpected network request');}) as typeof fetch);
 try{
  assert.equal(due(store).enrich,true);
  const outcome=await enrich(store);
  assert.equal(outcome.status,'processed_or_pending');assert.equal(outcome.calls,0);
  assert.equal(requests,0);assert.equal(store.all('SELECT * FROM calls').length,0);
 }finally{close();t.mock.timers.reset();}
});
test('scheduled enrich still blocks expired fixed trials, disabled models and window margins',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-26T05:30:00+08:00')});
 const {root,store,config,close}=setup();let requests=0;
 t.mock.method(globalThis,'fetch',(async()=>{requests++;throw Error('unexpected network request');}) as typeof fetch);
 try{
  atomic(root+'/trial.json',{...config,testing_period:'fixed_seven_days',days:7,expires_at:'2026-10-26T00:00:00+08:00'});
  assert.equal((await enrich(store)).status,'trial_or_model_disabled_or_expired');
  atomic(root+'/trial.json',{...config,model_enabled:false});
  assert.equal((await enrich(store)).status,'trial_or_model_disabled_or_expired');
  atomic(root+'/trial.json',config);
  for(const at of ['2026-10-26T04:59:59+08:00','2026-10-26T06:12:00+08:00','2026-10-26T09:00:00+08:00']){
   t.mock.timers.setTime(new Date(at).getTime());
   assert.equal((await enrich(store)).status,'outside_window_or_margin');assert.equal(due(store).enrich,false);
  }
  assert.equal(requests,0);assert.equal(store.all('SELECT * FROM calls').length,0);
 }finally{close();t.mock.timers.reset();}
});
test('continuous calls after the legacy expiry still enforce the daily budget before POST',async()=>{
 const {store,close}=setup();let posts=0;
 try{
  const p=policy(),text='公司发布新模型，模型效果尚未经独立验证。'.repeat(20);
  const a={id:'continuous-budget',url:'https://example.org/budget',title:'AI模型正式发布',source:'mit_ai',source_name:'MIT',published_at:'2026-10-26T04:00:00+08:00',text,content_status:'usable_excerpt',content_fingerprint:digest(text)};
  const key=cacheKey(a,p);store.run('INSERT INTO jobs(key,article,status) VALUES (?,?,?)',key,pyjson(a),'queued');
  store.run('INSERT INTO calls(day,job,reserved,status) VALUES (?,?,?,?)','2026-10-26','unknown-existing',2,'reserved');
  const outcome=await paidRequest(store,key,a,p,undefined,{now:()=>new Date('2026-10-26T05:30:00+08:00'),token:'test',verify:async()=>true,fetcher:(async()=>{posts++;throw Error('unexpected POST');}) as typeof fetch});
  assert.equal(outcome,'budget_exhausted');assert.equal(posts,0);assert.equal(store.all('SELECT * FROM calls').length,1);
 }finally{close();}
});
