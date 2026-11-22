// 出刊调度策略：与 NAS 上的旧 crontab 完全等价，单独成模块以便测试。
// 05:00–09:59 每 2 分钟一次；其余时段每小时 :07 与 :37。
export function dueAt(hour:number,minute:number):boolean {
  if(hour>=5&&hour<=9)return minute%2===0;
  return minute===7||minute===37;
}
export function nextTick(from:Date):Date {
  const next=new Date(from.getTime());next.setSeconds(0,0);next.setMinutes(next.getMinutes()+1);
  for(let i=0;i<1500;i++){if(dueAt(next.getHours(),next.getMinutes()))return next;next.setMinutes(next.getMinutes()+1);}
  throw new Error('ordinary_schedule_unreachable');
}
export function describe():string {
  return '05-09:*/2,else:07,37';
}
