import { readFileSync, existsSync } from 'node:fs';
import { titleExclusion } from '../../news-common/src/filter.ts';
import { createSubscriptionToken } from '../../news-common/src/tokens.ts';
import { SHELL, ITEM, NOTIFICATION, CLOSING, UNSUBSCRIBE } from './templates.ts';
import { type Item } from './archive.ts';
export const escape = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#x27;'})[c]!);
export function selectedItems(markdown: string): Item[] {
  const input: Item[] = [...markdown.matchAll(/\[(.*?)\]\((.*?)\)/g)].map(m=>[m[1],m[2]]);
  if (markdown.includes('(sorted)')) return input.filter(([t])=>!titleExclusion(t)).slice(0,25);
  const chosen=input.filter(([t])=>!titleExclusion(t)&&Array.from(t).length>=10);
  if(chosen.length<25) for(const a of input) { if(chosen.some(b=>a[0]===b[0]&&a[1]===b[1])||titleExclusion(a[0])) continue;chosen.push(a);if(chosen.length===25)break; }
  return chosen.slice(0,25);
}
export const formatNews = (items: Item[]) => items.map(([t,u],i)=>ITEM.replace('LONG_TITLE_SLOT',escape(t)).replace('URL_SLOT',escape(u)).replace(/01(?=\s*<\/td>)/,String(i+1).padStart(2,'0'))).join('');
export function notifications(path: string): Record<string,string> {
  const result: Record<string,string> = {start_notification:'',end_notification:'',end_comment:''};if(!existsSync(path))return result;
  const keys:Record<string,string>={'开头通知':'start_notification','结尾通知':'end_notification','结尾注释':'end_comment'};let section='';let current='';
  for(const line of readFileSync(path,'utf8').split(/\r?\n/)) {
    if(!line.trim()||/^\s*[;#]/.test(line))continue;
    const match=/^\[(.+)\]\s*$/.exec(line);if(match){section=match[1];current='';continue;}
    const field=/^content\s*=\s*(.*)$/.exec(line);if(field&&keys[section]) {current=keys[section];result[current]=field[1];}
    else if(/^\s+/.test(line)&&current)result[current]+='\n'+line.trim();
  }return result;
}
export function unsubscribeLink(email:string,base:string,secret:string,now=new Date()) {
  const {token}=createSubscriptionToken(email,'unsubscribe',secret,now,45*24*3600);
  return base.replace(/\/+$/,'')+'/?unsubscribe_token='+encodeURIComponent(token);
}
export function buildMessage(name:string,body:string,date:string,notice:Record<string,string>={},unsubscribe=''):string {
  const start=notice.start_notification??'',end=notice.end_notification??'',comment=notice.end_comment??'';
  const closing=(end||comment)?CLOSING.replace('END_SLOT',escape(end)).replace('COMMENT_SLOT',escape(comment)).replace(/<p style="margin:8px 0 0"><\/p>/g,''):'';
  const slots:Record<string,string>={'@@NOTIFICATION@@':start?NOTIFICATION.replace('START_SLOT',escape(start)):'','@@CLOSING@@':closing,
    '@@UNSUBSCRIBE@@':unsubscribe?UNSUBSCRIBE.replace('URL_SLOT',escape(unsubscribe)):'',NAME_SLOT:escape(name),NEWS_SLOT:body,DATE_SLOT:escape(date)};
  return SHELL.replace(/@@NOTIFICATION@@|@@CLOSING@@|@@UNSUBSCRIBE@@|NAME_SLOT|NEWS_SLOT|DATE_SLOT/g,s=>slots[s]);
}
