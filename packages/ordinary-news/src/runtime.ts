import { existsSync, readFileSync, readdirSync } from 'node:fs';
import nodemailer from 'nodemailer';
import { Store } from './store.ts';
import { collect, rank, archivePath, archiveFiles } from './archive.ts';
import { compose, deliver, recover, flushOutbox } from './delivery.ts';
import { day, yesterday, at, config, atomic, hash, read, OWNER, VERSION, safeError, type Row } from './core.ts';
export function report(store:Store,now=new Date()):Row {
  const c=config(store.root),date=day(now),id=(c.mode==='production'?'ordinary-':'shadow-')+date;
  const issue=store.one('SELECT data FROM issues WHERE id=?',id);const frozen=issue?JSON.parse(issue.data):null;
  const counts=Object.fromEntries(store.all('SELECT status,COUNT(*) n FROM deliveries WHERE issue=? GROUP BY status',id).map(r=>[r.status,r.n]));
  const delivery=store.meta('delivery:'+id);const plan=store.meta('delivery_plan:'+id);
  const expected=plan?.eligible??0;const terminal=(counts.smtp_accepted??0)+(counts.subscription_no_longer_eligible??0);
  const completed=expected>0&&terminal===expected;
  const first=delivery?.first_started_at??plan?.created_at??null;
  const evidence=read(store.root+'/rank-evidence/'+yesterday(now)+'.json',null);
  const active=date>=(c.mode==='production'?c.first_production_date:c.shadow_started_on);
  const outcome=c.mode==='paused'?'paused':!active?'not_started':completed?'smtp_accepted':counts.unknown_do_not_retry||counts.sending?'delivery_unknown':now>=at(date,'09:00:00')?'missed':'pending';
  const value={schema_version:1,component:'ordinary-news',runtime:{authority:process.env.ORDINARY_STATE_AUTHORITY==='nas'?'nas':'offline',version:VERSION},date,mode:c.mode,shadow_started_on:c.shadow_started_on,first_production_date:c.first_production_date,issue:id,
    content:frozen?{count:frozen.items.length,sorted:frozen.sorted,archive_sha256:frozen.archive_sha256,news_day:frozen.news_day,frozen_at:frozen.frozen_at}:null,
    collection:store.meta('collection'),grading:evidence?{total:evidence.grades.length,valid:evidence.grades.filter((g:Row)=>g.status==='valid').length,failed:evidence.grades.filter((g:Row)=>g.status==='failed').length}:null,
    delivery:{expected,counts,outcome,first_started_at:first,delay_seconds:first?Math.max(0,Math.floor((Date.parse(first)-at(date,'06:30:00').getTime())/1000)):null,
      finished_at:delivery?.finished_at??null,completed},
    parity:read(store.root+'/shadow/'+date+'-parity.json',{status:'pending'}),inbox:read(store.root+'/feedback/'+date+'.json',{status:'not_verified'}),
    archive_sync:read(store.root+'/archive-sync/status.json')??store.meta('archive_sync')??{status:c.archive_sync_enabled?'pending':'disabled_in_shadow'},last_error:store.meta('last_error')};
  atomic(store.root+'/reports/'+date+'.json',value);atomic(store.root+'/status.json',value);return value;
}
export function shadowGate(root:string,today=day()):Row {
  const reports:Row[]=[];
  for(let i=2;i>=0;i--) {
    const date=day(new Date(at(today,'00:00:00').getTime()-i*86400000));
    const r=read(root+'/reports/'+date+'.json');
    if(!r||r.mode!=='shadow'||!r.delivery.completed||r.delivery.outcome!=='smtp_accepted'||r.delivery.delay_seconds>60
      ||!r.content?.count||r.parity?.status!=='passed'||Date.parse(r.delivery.finished_at)>at(date,'06:35:00').getTime())return {passed:false,reason:'three_consecutive_shadow_days_required',day:date};
    reports.push(r);
    if(!r.grading||r.grading.valid<1)return {passed:false,reason:'shadow_grading_has_no_valid_votes',day:date};
  }
  const start=read(root+'/config.json',{}).shadow_started_on??reports[0].date;
  const received=existsSync(root+'/feedback')&&readdirSync(root+'/feedback').filter(n=>/^\d{4}-\d\d-\d\d\.json$/.test(n)&&n.slice(0,10)>=start&&n.slice(0,10)<=today).some(n=>read(root+'/feedback/'+n,{}).status==='received_confirmed');
  if(!received)return {passed:false,reason:'shadow_inbox_confirmation_required'};
  return {passed:true,dates:reports.map(r=>r.date),target:'next_natural_day'};
}
export async function tick(store:Store,now=new Date()):Promise<Row> {
  recover(store);const c=config(store.root),date=day(now),minutes=Number(now.toISOString().slice(11,13))*60+Number(now.toISOString().slice(14,16));
  const localMinutes=(minutes+480)%1440;const errors:Row[]=[];
  const step=async(name:string,fn:()=>any)=>{try{return await fn();}catch(error){const entry={at:new Date().toISOString(),stage:name,error:safeError(error)};errors.push(entry);store.meta('last_error',entry);return null;}};
  // Delivery takes priority over collection once its window opens.
  if(c.mode!=='paused'&&(c.mode!=='production'||date>=c.first_production_date)&&(c.mode!=='shadow'||date>=c.shadow_started_on)&&localMinutes>=375&&localMinutes<540) {
    if(!store.one('SELECT id FROM issues WHERE id=?',(c.mode==='production'?'ordinary-':'shadow-')+date)) {
      await step('rank',()=>rank(store,now));await step('compose',()=>compose(store,now));
    }
    const row=store.one('SELECT data FROM issues WHERE id=?',(c.mode==='production'?'ordinary-':'shadow-')+date);
    if(row&&localMinutes>=390)await step('deliver',()=>deliver(store,JSON.parse(row.data)));
  }
  if(localMinutes>=30&&localMinutes<375)await step('rank',()=>rank(store,now));
  const slot=Math.floor(now.getTime()/7200000),collection=store.meta('collection_slot');
  if(localMinutes%120>=7&&collection!==slot&&!(localMinutes>=375&&localMinutes<420)) {
    if(await step('collect',()=>collect(store,now)))store.meta('collection_slot',slot);
  }
  if(c.mode==='production')await step('notion_outbox',()=>flushOutbox(store));
  const value=report(store,now);
  if(localMinutes>=545)await step('alert',()=>alert(store,value));
  return {status:errors.length?'completed_with_errors':'completed',report:value,errors};
}
export function exportArchive(store:Store) {
  const files=archiveFiles(store.root);const previous=store.meta('archive_manifest')??{};const hashes:Row={};
  for(const file of files)hashes[file]=hash(readFileSync(store.root+'/news_archive/'+file));
  const changed=files.filter(p=>previous[p]!==hashes[p]);return {files:hashes,changed,mode:config(store.root).mode};
}
async function alert(store:Store,value:Row) {
  const sync=value.archive_sync;const syncOverdue=sync.status!=='synced'&&sync.first_pending_at&&Date.now()-Date.parse(sync.first_pending_at)>86400000;
  const c=config(store.root);if(value.date<(c.mode==='production'?c.first_production_date:c.shadow_started_on))return;
  if(value.mode==='paused'||value.delivery.outcome==='smtp_accepted'&&!syncOverdue)return;
  const id='alert:'+value.date;if(store.meta(id))return;
  if(process.env.ORDINARY_STATE_AUTHORITY!=='nas'||process.env.ORDINARY_DELIVERY_ENABLED!=='true')return;
  // Independent management notification, never retry an uncertain SMTP result.
  store.meta(id,{status:'sending',at:new Date().toISOString()});
  const transport=nodemailer.createTransport({host:process.env.SERVER,port:465,secure:true,auth:{user:process.env.SENDING_ACCOUNT,pass:process.env.SENDING_PASSWORD},logger:false,debug:false});
  try {const r=await transport.sendMail({from:process.env.SENDING_ACCOUNT,to:OWNER,subject:'普通版早报运行异常｜'+value.date,
    text:JSON.stringify({date:value.date,outcome:value.delivery.outcome,counts:value.delivery.counts,archive:sync.status},null,2),disableFileAccess:true,disableUrlAccess:true});
    store.meta(id,{status:r.accepted?.includes(OWNER)?'smtp_accepted':'unknown_do_not_retry',at:new Date().toISOString()});
  }catch{store.meta(id,{status:'unknown_do_not_retry',at:new Date().toISOString()});}finally{transport.close();}
}
