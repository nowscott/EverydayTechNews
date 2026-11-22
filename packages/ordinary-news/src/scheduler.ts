// 常驻调度：进程内按时调用 tick()，不再靠 crontab 每轮起容器。
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from './store.ts';
import { recoverArchive } from './archive.ts';
import { tick } from './runtime.ts';
import { atomic, safeError, VERSION } from './core.ts';
import { nextTick, describe } from './schedule.ts';

const args=process.argv.slice(2);const index=args.indexOf('--data');
const root=resolve(index>=0?args[index+1]:'ordinary_data');const once=args.includes('--once');
mkdirSync(root+'/scheduler',{recursive:true,mode:0o700});
const statusPath=root+'/scheduler/status.json';
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
  const at=new Date();
  try {
    const result:any=await tick(store,at);
    ticks++;last={at:at.toISOString(),status:result.status,ticked:result.report?.date??null,error_count:result.errors?.length??0};
    if(result.errors?.length)errors++;
  } catch(error) {
    errors++;last={at:at.toISOString(),status:'failed',error:safeError(error)};console.error(JSON.stringify({at:at.toISOString(),error:safeError(error)}));
  } finally {busy=false;}
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
if(once) { busy=true; try{const result:any=await tick(store,new Date());ticks=1;last={status:result.status};publish();console.log(JSON.stringify({status:result.status,once:true}));}finally{store.close();}process.exit(0); }
beat=setInterval(()=>publish(),60000);
next=nextTick(new Date());timer=setTimeout(cycle,Math.max(0,next.getTime()-Date.now()));
