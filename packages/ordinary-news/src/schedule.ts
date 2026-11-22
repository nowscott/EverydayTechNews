// 出刊调度策略：白天保持原节奏，夜间（23:00–04:59）降到每天 3 轮，避免 NAS 夜间持续负载。
// 05:00–09:59 每 2 分钟一次；23 点 / 02 点 / 04 点的 :07 各一轮；其余时段每小时 :07 与 :37。
export function quietNow(at:Date=new Date()):boolean { const h=at.getHours(); return h>=23||h<5; }
export function dueAt(hour:number,minute:number):boolean {
  if(hour>=5&&hour<=9)return minute%2===0;
  if(hour===23||hour===2||hour===4)return minute===7;
  if(hour>=0&&hour<5)return false;
  return minute===7||minute===37;
}
export function nextTick(from:Date):Date {
  const next=new Date(from.getTime());next.setSeconds(0,0);next.setMinutes(next.getMinutes()+1);
  for(let i=0;i<1500;i++){if(dueAt(next.getHours(),next.getMinutes()))return next;next.setMinutes(next.getMinutes()+1);}
  throw new Error('ordinary_schedule_unreachable');
}
export function describe():string {
  return '05-09:*/2,night:23:07/02:07/04:07,else:07,37';
}

// 部署/重启后是否立刻跑一轮：默认开（不用干等到下一个整点），--no-startup-tick 可关。
export function startupTickEnabled(args:string[]):boolean {
  return !args.includes('--no-startup-tick');
}

