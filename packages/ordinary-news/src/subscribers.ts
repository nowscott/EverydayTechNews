import { notionRequest, dataSource } from '../../news-common/src/notion.ts';
import { validEmail, type Row } from './core.ts';
export type Subscriber = { email:string;name:string;page_id:string;status_name:string;status_type:string;premium:boolean };
export async function subscribers(env:Row=process.env,fetcher:typeof fetch=fetch,allowEmpty=false):Promise<Subscriber[]> {
  const id=await dataSource(env,fetcher);const seen=new Set<string>(),cursors=new Set<string>();const found:Subscriber[]=[];let cursor:string|undefined;
  do {
    const data=await notionRequest('/data_sources/'+id+'/query',env,fetcher,{method:'POST',body:JSON.stringify({page_size:100,...(cursor?{start_cursor:cursor}:{})})});
    if(!Array.isArray(data.results)||typeof data.has_more!=='boolean')throw new Error('notion_invalid_page');
    for(const r of data.results) {
      const p=r.properties??{},statusName='状态' in p?'状态':'Status',status=p[statusName]??{};
      if(!r.archived&&!r.in_trash&&(!p.Email||!p[statusName]||(String(env.PREMIUM_PRODUCTION_ENABLED??'false').toLowerCase()==='true'&&!p['高级订阅'])))throw new Error('notion_invalid_subscriber_record');
      const email=String(p.Email?.email??'').trim().toLowerCase();const premium=p['高级订阅']?.checkbox===true;
      if(r.archived||r.in_trash||String((status.status??status.select)?.name??'').trim()!=='正常'||!validEmail(email)||seen.has(email))continue;
      if(String(env.PREMIUM_PRODUCTION_ENABLED??'false').toLowerCase()==='true'&&premium)continue;
      seen.add(email);const title=p.Name?.title?.[0];
      found.push({email,name:String(title?.plain_text??title?.text?.content??'').trim()||'订阅者',page_id:r.id,status_name:statusName,status_type:status.status?'status':'select',premium});
    }
    if(!data.has_more)break;cursor=data.next_cursor;
    if(!cursor||cursors.has(cursor))throw new Error('notion_pagination_invalid');cursors.add(cursor);
  }while(true);
  if(!found.length&&!allowEmpty)throw new Error('notion_no_eligible_subscribers');return found;
}
export async function markAbnormal(user:Subscriber,env:Row=process.env,fetcher:typeof fetch=fetch) {
  const page=await notionRequest('/pages/'+user.page_id,env,fetcher);
  const p=page.properties?.[user.status_name]??{};
  if(page.archived||page.in_trash||(p.status??p.select)?.name!=='正常')return 'status_changed_not_overwritten';
  await notionRequest('/pages/'+user.page_id,env,fetcher,{method:'PATCH',body:JSON.stringify({properties:{[user.status_name]:{[user.status_type]:{name:'异常'}}}})});
  return 'marked_abnormal';
}

export async function resolveSubscribers(root:string,env:Row=process.env,deadline=new Date(Date.now()+120000),fallback=true) {
  const { resolveAudience } = await import('../../news-common/src/subscriber-backup.ts');
  const kind=String(env.PREMIUM_PRODUCTION_ENABLED??'false').toLowerCase()==='true'?'ordinary-premium-excluded':'ordinary';
  return resolveAudience<Subscriber>({root,kind,deadline,fallback,get:()=>subscribers({...env,NOTION_REQUEST_DEADLINE:deadline.getTime()},fetch,true),valid:(value:unknown):value is Subscriber=>{
    const u=value as Subscriber;return !!u&&typeof u==='object'&&typeof u.email==='string'&&validEmail(u.email)&&typeof u.name==='string'
      &&typeof u.page_id==='string'&&!!u.page_id&&['状态','Status'].includes(u.status_name)&&['status','select'].includes(u.status_type)&&typeof u.premium==='boolean';
  }});
}
