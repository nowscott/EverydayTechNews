import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Store } from './store.ts';
import { collect, rank, recoverArchive } from './archive.ts';
import { compose, deliver, recover } from './delivery.ts';
import { report, tick, shadowGate, exportArchive } from './runtime.ts';
import { safeError } from './core.ts';
const [operation,...args]=process.argv.slice(2);const index=args.indexOf('--data');const root=resolve(index>=0?args[index+1]:'ordinary_data');
if(!['init','collect','rank','compose','deliver','report','run','gate','export'].includes(operation))throw new Error('ordinary_operation_invalid');
if(args.length&&!(args.length===2&&index===0&&args[1]))throw new Error('ordinary_arguments_invalid');
mkdirSync(root,{recursive:true,mode:0o700});let localLock:string|undefined;
if(!process.env.ORDINARY_FLOCKED) {
  if(process.platform==='linux') {const r=spawnSync('flock',['-x',root+'/runtime.lock',process.execPath,...process.argv.slice(1)],{stdio:'inherit',env:{...process.env,ORDINARY_FLOCKED:'1'}});process.exit(r.status??1);}
  localLock=root+'/offline.lock';mkdirSync(localLock);
}
let store:Store|undefined;
try {
  store=new Store(root);recoverArchive(root);let result:any;
  if(operation==='init')result={status:'initialized_shadow_only'};
  else if(operation==='collect')result=await collect(store);
  else if(operation==='rank')result=await rank(store);
  else if(operation==='compose')result=compose(store);
  else if(operation==='deliver'){recover(store);result=await deliver(store,compose(store));}
  else if(operation==='report')result=report(store);
  else if(operation==='run')result=await tick(store);
  else if(operation==='gate')result=shadowGate(root);
  else result=exportArchive(store);
  // CLI reports are aggregate only; compose can contain titles but no subscription list.
  console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({error:safeError(error)}));process.exitCode=1;}
finally{store?.close();if(localLock&&existsSync(localLock))rmSync(localLock,{recursive:true});}
