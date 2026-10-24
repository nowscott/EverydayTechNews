type Row=Record<string,any>;
type Source={query:(sql:string,...args:any[])=>Row[];file:(path:string,kind?:'json'|'text',options?:{optional?:boolean})=>any;list:(path:string,optional?:boolean)=>string[]};
const bodyKey=(v:Row)=>v.id+'\0'+(v.fingerprint??v.content_fingerprint);
export function assessmentIndex(r:Source,from:string){
 const chosen=new Map<string,string>(),result=new Map<string,Row>();
 // One latest snapshot per day, bounded to 32 days; never recompute historical scores.
 for(const name of r.list('durable/assessments',true))if(/^\d{14,24}\.json$/.test(name)&&name.slice(0,8)>=from.replaceAll('-',''))chosen.set(name.slice(0,8),name);
 for(const name of [...chosen.values()].sort().slice(-32)){
  const report=r.file('durable/assessments/'+name);if(!report?.at||!Number.isFinite(Date.parse(report.at))||Date.parse(report.at)>Date.now())continue;
  for(const row of [...(report.selected??[]).map((v:Row)=>({...v,candidate:true})),...(report.rejections??[])]){
   if(!row.id||!(row.fingerprint??row.content_fingerprint))continue;
   const key=bodyKey(row),prev=result.get(key);result.set(key,{...row,at:report.at,ranking:row.ranking??prev?.ranking,scored_at:row.ranking?report.at:prev?.scored_at});
  }
 }
 return result;
}
const reasonNames:Record<string,string>={publisher_not_allowlisted:'来源未适配',discovery_only_no_body:'仅有线索，未取得正文',article_publication_unconfirmed:'原文发布时间未确认',insufficient_content:'正文不足',old_news:'已超选题时间窗口',old_submission:'投稿已超时间窗口',expires_before_next_edition:'已超选题时间窗口',already_sent_unchanged:'已发送且内容未变',duplicate_or_event_review:'重复或同一事件',editorial_score_below_threshold:'选题分不足',promotion_or_roundup:'促销或新闻汇总',shared_title_filter:'标题规则过滤',body_fetch_failed:'正文获取失败',evidence_expired_or_missing:'正文证据缺失或过期',not_recorded:'未记录评分',filtered:'规则过滤',grade_failed:'投票评分获取失败',not_yet_graded:'尚未执行投票评分'};
export const reasonLabel=(code:string)=>reasonNames[code]??code;
export function eligibilityReason(a:Row,assessment?:Row){
 if(a.evidence_expired_or_missing)return 'evidence_expired_or_missing';
 if(a.body_probe_status==='publisher_not_allowlisted')return 'publisher_not_allowlisted';
 if(a.body_probe_status==='body_fetch_failed')return 'body_fetch_failed';
 if(!a.original_article_published_at&&['hn_submission','atom_update_not_publication','discovery_time_not_publication'].includes(a.published_time_kind))return 'article_publication_unconfirmed';
 if(a.content_status==='discovery_only')return 'discovery_only_no_body';
 if(a.content_status&&a.content_status!=='usable_excerpt')return 'insufficient_content';
 return assessment?.reason??'not_recorded';
}
const fields=(v:Row)=>JSON.stringify([v.title??'',v.summary??'',v.short_summary??'',v.points??[],v.why??'']);
export function currentReview(a:Row,draft:Row|null,jobs:Row[]){
 if(!draft)return undefined;
 return jobs.filter(j=>j.article.task_kind==='review'&&bodyKey(j.article)===bodyKey(a)&&j.article.review_draft&&fields(j.article.review_draft)===fields(draft)).at(-1);
}
export function processingStage(stage:string,reason:string,job?:Row,review?:Row){
 if(stage==='approved')return 'approved';
 if(stage==='rejected')return 'rejected';
 if(review&&/failed|uncertain/.test(review.status))return 'review_failed';
 if(job&&/failed|uncertain/.test(job.status))return 'generation_failed';
 if(job)return stage==='rewritten'?'awaiting_review':stage;
 return ({publisher_not_allowlisted:'source_unadapted',article_publication_unconfirmed:'publication_unconfirmed',insufficient_content:'insufficient_content',discovery_only_no_body:'discovery_only',body_fetch_failed:'body_failed',evidence_expired_or_missing:'evidence_missing',old_news:'expired',old_submission:'expired',expires_before_next_edition:'expired',already_sent_unchanged:'duplicate',duplicate_or_event_review:'duplicate',editorial_score_below_threshold:'score_filtered',promotion_or_roundup:'filtered',shared_title_filter:'filtered'} as Row)[reason]??'collected';
}
export function attempts(r:Source,jobs:Row[]){
 const columns=r.query('PRAGMA table_info(calls)').map(c=>c.name);
 if(!columns.includes('job'))return [];
 const meta=r.query("SELECT data FROM meta WHERE key LIKE 'call_diagnostic:%'").map(v=>JSON.parse(v.data));
 const out:Row[]=[];
 for(const job of jobs){
  const calls=r.query('SELECT id,day,cost,status FROM calls WHERE job=? ORDER BY id',job.key);
  for(const c of calls){const d=meta.find(v=>v.call_id===c.id);out.push({call_id:c.id,day:c.day,stage:job.article.task_kind==='review'?'review':job.article.task_kind==='edition_review'?'edition_review':'generation',status:c.status,cost:c.cost,started_at:d?.started_at??null,finished_at:d?.finished_at??null,attempt:d?.attempt??null,strategy:d?.strategy??'legacy',error_code:d?.error_code??(c.status==='invalid_response'?'reason_not_recorded':c.status==='response_received'?null:c.status),recovered:c.status==='invalid_response'&&!!job.result,retryable:job.article.task_kind!=='edition_review'&&job.status==='failed_validation_review'&&!job.result&&job.attempts<3&&calls.every(v=>v.cost!=null),retry_note:'可重试仅表示费用与次数允许；执行时仍须满足候选资格、证据、调度窗口和预算。'});}
 }
 return out.sort((a,b)=>a.call_id-b.call_id);
}
