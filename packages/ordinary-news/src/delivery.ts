import nodemailer from 'nodemailer';
import { existsSync, readFileSync } from 'node:fs';
import { Store } from './store.ts';
import { OWNER, hash, day, yesterday, at, config, atomic, read, validEmail, type Row } from './core.ts';
import { archivePath } from './archive.ts';
import { selectedItems, formatNews, buildMessage, notifications, unsubscribeLink } from './email.ts';
import { resolveSubscribers, markAbnormal, type Subscriber } from './subscribers.ts';
export function compose(store:Store,now=new Date()) {
  const c=config(store.root),date=day(now),id=(c.mode==='production'?'ordinary-':'shadow-')+date;
  const old=store.one('SELECT data FROM issues WHERE id=?',id);if(old)return JSON.parse(old.data);
  if(c.mode==='paused'||now<at(date,'06:15:00'))throw new Error('ordinary_freeze_not_due');
  const path=archivePath(store.root,yesterday(now));if(!existsSync(path))throw new Error('yesterday_archive_missing');
  const md=readFileSync(path,'utf8');const items=selectedItems(md);if(!items.length)throw new Error('ordinary_no_sendable_news');
  const issue={id,day:date,mode:c.mode,news_day:yesterday(now),items,body:formatNews(items),notifications:notifications(store.root+'/notifications.ini'),
    sorted:md.includes('(sorted)'),archive_sha256:hash(md),frozen_at:now.toISOString(),source:'nas',schema_version:1};
  store.run('INSERT INTO issues VALUES (?,?,?,?)',id,date,c.mode,JSON.stringify(issue));
  atomic(store.root+'/issues/'+id+'.json',issue);return issue;
}
export function recover(store:Store) {
  store.tx(()=>{for(const row of store.all("SELECT * FROM deliveries WHERE status='sending'")) {
    const receipt={...JSON.parse(row.data),status:'unknown_do_not_retry',reason:'interrupted_after_claim'};
    store.run('UPDATE deliveries SET status=?,data=? WHERE id=?',receipt.status,JSON.stringify(receipt),row.id);
  }});
}
function window(c:Row,issue:Row,now:Date) {
  if(c.mode==='paused'||c.mode!==issue.mode||issue.day!==day(now))return false;
  if(c.mode==='shadow'&&(!c.shadow_started_on||day(now)<c.shadow_started_on))return false;
  if(c.mode==='production'&&(!c.first_production_date||day(now)<c.first_production_date))return false;
  return now>=at(day(now),'06:30:00')&&now<at(day(now),'09:00:00');
}
export interface DeliveryDeps { now?:()=>Date;transport?:any;getSubscribers?:()=>Promise<Subscriber[]>;env?:Row;createTransport?:(onData:()=>void)=>any; }
function realAuthority(store:Store,env:Row) {
  const marker=read(store.root+'/.ordinary-authority.json');
  return process.platform==='linux'&&process.env.ORDINARY_FLOCKED==='1'&&env.ORDINARY_STATE_AUTHORITY==='nas'
    &&env.ORDINARY_DELIVERY_ENABLED==='true'&&marker?.kind==='ordinary_nas'&&marker.schema_version===1;
}
export async function deliver(store:Store,issue:Row,deps:DeliveryDeps={}):Promise<Row> {
  const clock=deps.now??(()=>new Date()),env=deps.env??process.env;let c=config(store.root);
  if(!window(c,issue,clock()))return {status:'outside_delivery_window'};
  if(!deps.transport&&!deps.createTransport&&!realAuthority(store,env))throw new Error('ordinary_smtp_authority_required');
  if(c.mode==='production'&&env.ORDINARY_PRODUCTION_ENABLED!=='true')return {status:'production_delivery_disabled'};
  const saved=store.one('SELECT data FROM issues WHERE id=?',issue.id);if(!saved||hash(saved.data)!==hash(JSON.stringify(issue)))throw new Error('ordinary_frozen_issue_changed');
  const sender=String(env.SENDING_ACCOUNT??'').trim(),password=env.SENDING_PASSWORD,server=env.SERVER,base=String(env.APP_BASE_URL??'').trim(),secret=env.SUBSCRIPTION_CONFIRMATION_SECRET;
  if(!validEmail(sender)||!password||!server||!base.startsWith('https://')||!secret)throw new Error('ordinary_mail_configuration_missing');
  const oldPlan=store.meta('delivery_plan:'+issue.id);
  if(oldPlan&&!store.one("SELECT id FROM deliveries WHERE issue=? AND status IN ('pending','retryable_before_data')",issue.id)) {
    const old=store.meta('delivery:'+issue.id);if(old)return old;
    const rows=store.all('SELECT status,data FROM deliveries WHERE issue=?',issue.id);const states=Object.fromEntries([...new Set(rows.map(r=>r.status))].map(s=>[s,rows.filter(r=>r.status===s).length]));
    const result={status:'recovered_terminal_delivery',issue:issue.id,mode:issue.mode,eligible:oldPlan.eligible,counts:states,first_started_at:oldPlan.created_at,
      finished_at:rows.map(r=>{const v=JSON.parse(r.data);return v.accepted_at??v.started_at;}).filter(Boolean).sort().at(-1),inbox:'not_verified'};
    store.meta('delivery:'+issue.id,result);return result;
  }
  let live:Subscriber[];
  if(deps.getSubscribers) live=await deps.getSubscribers();
  else {
    try { const audience=await resolveSubscribers(store.root,env,at(day(clock()),'09:00:00')); live=audience.subscribers; store.meta('subscriber_audience',audience.report); }
    catch(error) { store.meta('subscriber_audience',{source:'unavailable',reason:(error as Error).message,at:clock().toISOString()}); throw error; }
  }
  if(!window(config(store.root),issue,clock()))return {status:'outside_delivery_window'};
  const planKey='delivery_plan:'+issue.id;const previousPlan=store.meta(planKey);
  const users:Subscriber[]=c.mode==='shadow'?[{email:OWNER,name:'NowScott',page_id:'',status_name:'状态',status_type:'select',premium:false}]:live.filter(u=>!previousPlan||previousPlan.members.includes(u.email.toLowerCase()));
  const allowed=new Set(users.map(u=>u.email.toLowerCase()));
  if(!previousPlan) store.meta(planKey,{members:users.map(u=>u.email.toLowerCase()),eligible:users.length,created_at:clock().toISOString()});
  store.tx(()=>{for(const u of users) {const id=hash('ordinary\0'+issue.id+'\0'+u.email.toLowerCase());store.run('INSERT OR IGNORE INTO deliveries VALUES (?,?,?,?,?,?)',id,issue.id,u.email,'pending',0,JSON.stringify({user:u,status:'pending'}));}});
  let dataStarted=false;let activeAttempt:{id:string;receipt:Row;email:string}|undefined;
  const onData=()=>{dataStarted=true;if(activeAttempt){activeAttempt.receipt.smtp_data_started=true;save(store,activeAttempt.id,activeAttempt.receipt,activeAttempt.email);}};
  const transport=deps.transport??(deps.createTransport?deps.createTransport(onData):createMailTransport(env,onData));
  const started=clock().toISOString();let accepted=0;
  try {
    for(const user of users) {
      c=config(store.root);if(!window(c,issue,clock()))break;
      const id=hash('ordinary\0'+issue.id+'\0'+user.email.toLowerCase());let row=store.one('SELECT * FROM deliveries WHERE id=?',id);
      if(row&&!['retryable_before_data','pending'].includes(row.status))continue;
      const previous=row?JSON.parse(row.data):{};
      if((row?.attempts??0)>=3||previous.retry_after&&clock()<new Date(previous.retry_after))continue;
      const date=issue.day.replace(/^(\d+)-(\d+)-(\d+)$/,'$1年$2月$3日');
      const subject=(issue.mode==='shadow'?'【普通版TS测试】':'')+'今日科技早报｜'+date;
      const messageId=previous.message_id??`<everyday-tech-news-${hash([sender.toLowerCase(),user.email.toLowerCase(),subject,date+'\n'+issue.body].join('\0')).slice(0,32)}@${sender.split('@')[1].toLowerCase()}>`;
      const html=previous.html??buildMessage(user.name,issue.body,date,issue.notifications,unsubscribeLink(user.email,base,secret,clock()));
      const receipt:Row={issue:issue.id,recipient_hash:hash(user.email),status:'sending',message_id:messageId,attempts:(row?.attempts??0)+1,html,subject,
        user,first_started_at:previous.first_started_at??started,started_at:clock().toISOString()};
      // FULL synchronous SQLite commit durably claims the recipient before touching SMTP.
      store.tx(()=>store.run('INSERT OR REPLACE INTO deliveries VALUES (?,?,?,?,?,?)',id,issue.id,user.email,'sending',receipt.attempts,JSON.stringify(receipt)));
      if(!window(config(store.root),issue,clock())) {receipt.status='pending';save(store,id,receipt,user.email);break;}
      dataStarted=false;activeAttempt={id,receipt,email:user.email};
      try {
        const result=await transport.sendMail({from:{name:'每日科技早报',address:sender},to:user.email,envelope:{from:sender,to:[user.email]},messageId,subject,html,disableFileAccess:true,disableUrlAccess:true});
        receipt.status=result.accepted?.some((s:string)=>s.toLowerCase()===user.email.toLowerCase())?'smtp_accepted':'unknown_do_not_retry';
        if(receipt.status==='smtp_accepted'){receipt.accepted_at=clock().toISOString();accepted++;}
        save(store,id,receipt,user.email);
      }catch(error) {
        // A successful SMTP acceptance followed by a persistence failure must abort, never classify as retryable.
        if(receipt.status==='smtp_accepted')throw error;
        const e=error as Row;const command=String(e.command??'');
        if(!dataStarted&&command==='RCPT TO'&&Number(e.responseCode)>=500&&Number(e.responseCode)<600) {
          receipt.status='permanent_recipient_failure';
          if(issue.mode==='production'&&user.page_id)store.run('INSERT OR REPLACE INTO outbox VALUES (?,?)',id,JSON.stringify({user,attempts:0}));
        }else if(!dataStarted&&['CONN','AUTH','EHLO','HELO','STARTTLS','MAIL FROM','RCPT TO'].includes(command)) {
          receipt.status=receipt.attempts>=3?'retries_exhausted_before_data':'retryable_before_data';receipt.retry_after=new Date(clock().getTime()+60000*receipt.attempts).toISOString();
        }else receipt.status='unknown_do_not_retry';
        save(store,id,receipt,user.email);
      }
    }
    // A pending recipient whose subscription was removed is never resumed from the stale queue.
    for(const row of store.all("SELECT * FROM deliveries WHERE issue=? AND status IN ('pending','retryable_before_data')",issue.id))if(!allowed.has(row.email.toLowerCase())) {
      const receipt={...JSON.parse(row.data),status:'subscription_no_longer_eligible'};save(store,row.id,receipt,row.email);
    }
  }finally {try{transport.close();}catch{/* QUIT cannot undo saved SMTP acceptance. */}}
  const counts=Object.fromEntries(store.all('SELECT status,COUNT(*) n FROM deliveries WHERE issue=? GROUP BY status',issue.id).map(r=>[r.status,r.n]));
  const result={status:'delivery_pass_completed',issue:issue.id,mode:issue.mode,eligible:c.mode==='shadow'?1:live.length,accepted_this_pass:accepted,counts,first_started_at:previousPlan?.created_at??started,
    started_at:started,finished_at:clock().toISOString(),inbox:'not_verified'};
  store.meta('delivery:'+issue.id,result);atomic(store.root+'/reports/'+issue.day+'-delivery.json',result);return result;
}
function save(store:Store,id:string,receipt:Row,email:string) {store.run('UPDATE deliveries SET status=?,attempts=?,data=? WHERE id=? AND email=?',receipt.status,receipt.attempts,JSON.stringify(receipt),id,email);}
export async function flushOutbox(store:Store,env:Row=process.env) {
  for(const r of store.all('SELECT * FROM outbox')) {
    const job=JSON.parse(r.data);if(job.attempts>=3)continue;
    try {await markAbnormal(job.user,env);store.run('DELETE FROM outbox WHERE id=?',r.id);}
    catch {job.attempts++;store.run('UPDATE outbox SET data=? WHERE id=?',JSON.stringify(job),r.id);}
  }
}

export function createMailTransport(env:Row,onData:()=>void,overrides:Row={}) {
  const logger:Row={};for(const level of ['trace','debug','info','warn','error','fatal'])logger[level]=(data:Row,message:string,...args:any[])=>{
    // Never output the SMTP transcript. Only recognize the DATA boundary before socket.write.
    if(data?.tnx==='client'&&[message,...args].some(v=>typeof v==='string'&&v.replace(/^C:\s*/,'').trim()==='DATA'))onData();
  };
  return nodemailer.createTransport({host:env.SERVER,port:465,secure:true,auth:{user:env.SENDING_ACCOUNT,pass:env.SENDING_PASSWORD},pool:true,maxConnections:1,maxMessages:100,maxRequeues:0,
    connectionTimeout:30000,greetingTimeout:30000,socketTimeout:30000,logger,debug:true,disableFileAccess:true,disableUrlAccess:true,...overrides});
}
