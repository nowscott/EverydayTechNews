// 常驻调度：进程内按时调用 tick()，不再靠 crontab 每轮起容器。
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Store } from './store.ts';
import { recoverArchive } from './archive.ts';
import { tick } from './runtime.ts';
import { atomic, safeError, VERSION } from './core.ts';
import { nextTick, describe, startupTickEnabled } from './schedule.ts';

const args=process.argv.slice(2);const index=args.indexOf('--data');
const root=resolve(index>=0?args[index+1]:'ordinary_data');const once=args.includes('--once');
mkdirSync(root+'/scheduler',{recursive:true,mode:0o700});
const statusPath=root+'/scheduler/status.json';
const runsDir=root+'/scheduler/runs';
const logsDir=root+'/scheduler/logs';
mkdirSync(runsDir,{recursive:true,mode:0o700});
mkdirSync(logsDir,{recursive:true,mode:0o700});
const runName=(iso:string)=>iso.replace(/:/g,'-');
function writeRun(record:any){atomic(runsDir+'/'+runName(record.started_at)+'-'+record.run_id.slice(-8)+'.json',record);atomic(runsDir+'/latest.json',record);}
function writeTickLog(record:any,status:string,errors:any[],summary:any){atomic(logsDir+'/'+runName(record.started_at)+'-'+record.run_id.slice(-8)+'.json',
  {schema_version:1,component:'ordinary',run_id:record.run_id,at:record.started_at,finished_at:record.finished_at,status,exit_code:record.exit_code,errors,summary});}
function trimRuns(){for(const dir of [runsDir,logsDir]){const names=readdirSync(dir).filter(n=>/^\d/.test(n)).sort();for(const n of names.slice(0,Math.max(0,names.length-500)))rmSync(dir+'/'+n,{force:true});}}
let stopping=false,busy=false,timer:NodeJS.Timeout|undefined,beat:NodeJS.Timeout|undefined;
let ticks=0,errors=0,last:any=null;

function publish(extra:Record<string,any>={}) {
  atomic(statusPath,{schema_version:1,component:'ordinary-news',scheduler:{version:VERSION,pid:process.pid,mode:'resident',policy:describe(),
    started_at:started,heartbeat_at:new Date().toISOString(),stopping,ticks,errors,last_tick:last,next_tick:next?next.toISOString():null,...extra}});
}

const started=new Date().toISOString();
let next:Date|null=null;
const store=new Store(root);
recoverArchive(root);

async function cycle() {
  if(stopping)return;
  busy=true;
  const at=new Date(),startedAt=at.toISOString(),runId=startedAt+'-'+randomUUID().slice(0,8);
  const record:any={run_id:runId,component:'ordinary',started_at:startedAt,finished_at:null,state:'running',exit_code:null};
  writeRun(record);
  try {
    const result:any=await tick(store,at);
    ticks++;last={at:startedAt,status:result.status,ticked:result.report?.date??null,error_count:result.errors?.length??0};
    if(result.errors?.length)errors++;
    Object.assign(record,{finished_at:new Date().toISOString(),state:'completed',exit_code:result.status==='completed'?0:1});
    const r=result.report??{};
    writeTickLog(record,result.status,result.errors??[],{date:r.date??null,count:r.content?.count??null,delivery:r.delivery?.outcome??null,
      archive_sync:r.archive_sync?.status??null,collection_at:r.collection?.at??null,last_error:r.last_error??null});
  } catch(error) {
    errors++;last={at:startedAt,status:'failed',error:safeError(error)};console.error(JSON.stringify({at:startedAt,error:safeError(error)}));
    Object.assign(record,{finished_at:new Date().toISOString(),state:'completed',exit_code:1});
    writeTickLog(record,'failed',[{at:new Date().toISOString(),stage:'tick',error:safeError(error)}],{});
  } finally {busy=false;writeRun(record);trimRuns();}
  next=nextTick(new Date());timer=setTimeout(cycle,Math.max(0,next.getTime()-Date.now()));
  publish();console.log(JSON.stringify({at:new Date().toISOString(),ticks,errors,last,next:next.toISOString()}));
}

function shutdown(signal:string) {
  if(stopping)return;stopping=true;
  if(timer)clearTimeout(timer);if(beat)clearInterval(beat);
  publish({stopped_at:new Date().toISOString(),signal});
  const finish=()=>{store.close();process.exit(0);};
  if(busy){const wait=setInterval(()=>{if(!busy){clearInterval(wait);finish();}},200);}else finish();
}

process.on('SIGTERM',()=>shutdown('SIGTERM'));process.on('SIGINT',()=>shutdown('SIGINT'));

publish();
console.log(JSON.stringify({at:new Date().toISOString(),status:'scheduler_started',policy:describe(),version:VERSION}));
if(once) { busy=true; const at=new Date(),runId=at.toISOString()+'-'+randomUUID().slice(0,8); const record:any={run_id:runId,component:'ordinary',started_at:at.toISOString(),finished_at:null,state:'running',exit_code:null}; writeRun(record); try{const result:any=await tick(store,at);ticks=1;last={status:result.status};Object.assign(record,{finished_at:new Date().toISOString(),state:'completed',exit_code:result.status==='completed'?0:1});writeTickLog(record,result.status,result.errors??[],{once:true,date:result.report?.date??null});publish();console.log(JSON.stringify({status:result.status,once:true}));}catch(error){Object.assign(record,{finished_at:new Date().toISOString(),state:'completed',exit_code:1});writeTickLog(record,'failed',[{stage:'tick',error:safeError(error)}],{once:true});throw error;}finally{writeRun(record);store.close();}process.exit(0); }
beat=setInterval(()=>publish(),60000);
if(startupTickEnabled(process.argv.slice(2))){void cycle();}
else{next=nextTick(new Date());timer=setTimeout(cycle,Math.max(0,next.getTime()-Date.now()));publish();}
