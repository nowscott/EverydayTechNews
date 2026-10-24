import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {Reader} from '../server/data.ts';
import {assessmentIndex,processingStage,currentReview,eligibilityReason,attempts} from '../server/pipeline.ts';
test('assessment index preserves real zero scores and content-version boundaries; missing and damaged reports are distinct',()=>{
 const root=mkdtempSync(tmpdir()+'/assessment-test-'),r=new Reader(root);
 try{
  assert.equal(assessmentIndex(r,'2026-10-01').size,0);assert.equal(r.evidence.at(-1)!.state,'not_recorded');
  mkdirSync(root+'/durable/assessments',{recursive:true});
  writeFileSync(root+'/durable/assessments/20261023050000000.json',JSON.stringify({at:'2026-10-23T05:00:00+08:00',selected:[],rejections:[{id:'a',content_fingerprint:'v1',reason:'editorial_score_below_threshold',ranking:{score:0,version:'saved-rule'}}]}));
  writeFileSync(root+'/durable/assessments/20261024050000000.json',JSON.stringify({at:'2026-10-24T05:00:00+08:00',selected:[{id:'a',fingerprint:'v2',ranking:{score:90}}],rejections:[{id:'legacy-ambiguous',reason:'old_news'}]}));
  const index=assessmentIndex(r,'2026-10-01');assert.equal(index.get('a\0v1')!.ranking.score,0);assert.equal(index.get('a\0v2')!.ranking.score,90);assert.equal(index.size,2);
  writeFileSync(root+'/durable/assessments/20261024060000000.json','broken');assessmentIndex(r,'2026-10-01');assert(r.evidence.some(e=>e.state==='unreadable'));
 }finally{r.close();rmSync(root,{recursive:true,force:true});}
});
test('failed review is attributed only to identical current draft and article fingerprint',()=>{
 const a={id:'a',content_fingerprint:'v1'},draft={title:'当前',summary:'摘要',short_summary:'短',points:[],why:''};
 const jobs=[{key:'old',article:{...a,task_kind:'review',review_draft:{...draft,title:'旧稿'}},status:'failed_validation_review'},{key:'new',article:{...a,task_kind:'review',review_draft:draft},status:'review_passed'}];
 assert.equal(currentReview(a,draft,jobs)!.key,'new');assert.equal(currentReview({...a,content_fingerprint:'v2'},draft,jobs),undefined);
 assert.equal(processingStage('rewritten','not_recorded',{},jobs[0]),'review_failed');
 assert.equal(eligibilityReason({body_probe_status:'publisher_not_allowlisted'}),'publisher_not_allowlisted');
 assert.equal(processingStage('collected','publisher_not_allowlisted'),'source_unadapted');
});
test('attempt projection distinguishes old failures, known-cost recovery and unknown-cost holds without exposing model responses',()=>{
 const job={key:'j',article:{},status:'pending_ai_review',attempts:2,result:'saved'};
 const rows=[{id:1,day:'2026-10-23',cost:.01,status:'invalid_response'},{id:2,day:'2026-10-24',cost:.01,status:'response_received'}];
 const source={query:(sql:string)=>sql.startsWith('PRAGMA')?[{name:'job'}]:sql.includes('FROM meta')?[{data:JSON.stringify({call_id:2,started_at:'2026-10-24T05:00:00+08:00',strategy:'test'})}]:rows};
 const h=attempts(source as any,[job]);assert.equal(h.length,2);assert(h[0].recovered);assert.equal(h[0].error_code,'reason_not_recorded');assert.equal(h[0].day,'2026-10-23');assert(!JSON.stringify(h).includes('saved'));
 job.result='';job.status='failed_validation_review';rows[0].cost=null as any;assert(!attempts(source as any,[job])[0].retryable);
});
