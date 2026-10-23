// NAS-local operational checks. No model calls, editorial scoring or subscriber lookup.
import {existsSync,mkdirSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import nodemailer from 'nodemailer';
import {active,atomic,day,localParts,read,RECIPIENT,stamp,trial,type Row} from './core.ts';
export function inspectHealth(root:string,now=new Date()):Row {
  const date=day(now),t=trial(root),issues:string[]=[];
  if(!active(t,now))return {date,status:'disabled',issues};
  const local=localParts(now);if(local.hour<9||local.hour===9&&local.minute<5)return {date,status:'before_deadline',issues};
  const id='test-'+date,receipts=existsSync(root+'/deliveries')?readdirSync(root+'/deliveries').filter(f=>f.endsWith('.json')).map(f=>read(join(root,'deliveries',f))).filter(r=>r.issue===id||r.issue?.startsWith(id+'-r-')):[];
  const accepted=receipts.find(r=>r.status==='smtp_accepted');
  if(!accepted)issues.push('no_smtp_acceptance_by_deadline');
  if(receipts.some(r=>['sending','unknown_do_not_retry'].includes(r.status)))issues.push('delivery_result_unknown_do_not_resend');
  const selected=accepted?.issue??id,p=root+'/issues/'+selected+'/edition.json',edition=existsSync(p)?read(p):null;
  if(!edition)issues.push('frozen_edition_missing');
  const state=read(root+'/durable/state.json'),calls=(state.tables.calls as Row[]).filter(c=>c.day===date);
  if(calls.some(c=>c.cost==null))issues.push('model_cost_unknown_held');
  const reserved=calls.reduce((n,c)=>n+Number(c.cost??c.reserved??0),0);if(reserved>Math.min(2,t.daily_budget_cny)+1e-8)issues.push('daily_budget_exceeded');
  const health=existsSync(root+'/source-health.json')?read(root+'/source-health.json'):null;
  if(health?.sources?.length&&health.sources.every((s:Row)=>!s.ok))issues.push('all_sources_unavailable');
  // A delivered diagnostic already informs the only test recipient; don't send the same fault twice.
  const diagnostic=accepted&&edition?.kind==='diagnostic';
  return {date,checked_at:stamp(now),status:issues.length?'abnormal':diagnostic?'diagnostic_already_notified':'healthy',issues,
    edition:edition?.kind??'missing',smtp:accepted?'accepted_not_inbox_confirmation':'not_confirmed',model_calls:calls.length,accounted_cny:reserved,
    source_count:health?.sources?.length??0};
}
export async function checkHealth(root:string,deps:{now?:()=>Date;transport?:any}={}):Promise<Row>{
  const now=deps.now?.()??new Date();
  if(!deps.transport&&(process.platform!=='linux'||process.env.NEWS_HEALTH_AUTHORITY!=='nas'||!existsSync(root+'/.nas-authority.json')))throw Error('health_requires_nas_authority');
  let result:Row;try{result=inspectHealth(root,now);}catch{result={date:day(now),checked_at:stamp(now),status:'abnormal',issues:['health_state_unreadable']};}
  const directory=root+'/durable/health';mkdirSync(directory,{recursive:true,mode:0o700});atomic(directory+'/'+result.date+'.json',result);
  if(result.status!=='abnormal')return {...result,notification:'not_needed'};
  const claim=directory+'/'+result.date+'-notification.json';if(existsSync(claim))return {...result,notification:read(claim).status};
  if(!process.env.SENDING_ACCOUNT||!process.env.SENDING_PASSWORD||!process.env.SERVER)return {...result,notification:'smtp_configuration_missing'};
  atomic(claim,{status:'sending',claimed_at:stamp(now)});
  const transport=deps.transport??nodemailer.createTransport({host:process.env.SERVER,port:465,secure:true,auth:{user:process.env.SENDING_ACCOUNT,pass:process.env.SENDING_PASSWORD},connectionTimeout:20000,greetingTimeout:20000,socketTimeout:45000,logger:false,debug:false});
  let notification='unknown_do_not_retry';
  try{const r=await transport.sendMail({from:process.env.SENDING_ACCOUNT,to:RECIPIENT,subject:'高级版早报运行异常｜'+result.date,text:'NAS自动检查发现异常；以下仅是运行记录，不代表收件箱确认。\n'+JSON.stringify(result,null,2),disableFileAccess:true,disableUrlAccess:true});notification=r.accepted?.includes(RECIPIENT)?'smtp_accepted':'unknown_do_not_retry';}
  catch{/* A possibly submitted notification never auto-retries. */}finally{try{transport.close();}catch{/* SMTP acceptance survives connection shutdown errors. */}}
  atomic(claim,{status:notification,finished_at:stamp()});return {...result,notification};
}
if(process.argv[1]?.endsWith('/health.ts'))console.log(JSON.stringify(await checkHealth(process.argv[2]??'/data')));
