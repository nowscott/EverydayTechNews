// Background public article capture. No model/SMTP credentials or business writes.
import { load } from 'cheerio/slim';
import { readFileSync, existsSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Reader, day, type Config, type Row } from './data.ts';
import { cachedBody, saveBody, textHash, type Original, articleUrl } from './body-cache.ts';
export { articleUrl } from './body-cache.ts';
// Never fetch arbitrary administrator-supplied URLs, local addresses or custom ports.
// Only publisher hosts already used by this service are accepted, including redirects.
export function extractBody(html: string, url: string): {text:string;title:string;kind:string} {
  const $=load(html,{xml:{xmlMode:false,decodeEntities:true}});
  if($('[itemprop="isAccessibleForFree"][content="false"], .paywall, [data-testid="paywall"], #paywall').length)throw Error('publisher_access_restricted');
  $('script,style,noscript,iframe,form,input,button,nav,footer,header,aside,svg,img,video,audio,.ad,.ads,.advertisement,.related,.related-posts,.share,.social,.copyright,.subscribe').remove();
  const selectors = new URL(url).hostname.endsWith('ithome.com') ? ['#paragraph','.post_content','.article-content'] : ['[itemprop="articleBody"]','.article-body','.article__body','.article-content','.entry-content','.post-content','.post_content','.body-copy','.rich-text','.content-body','article','main'];
  let text='';
  for(const selector of selectors){const node=$(selector).first().clone();if(!node.length)continue;node.find('br').replaceWith('\n');node.find('p,div,li,h1,h2,h3,h4,blockquote,pre').each((_i,el)=>{$(el).append('\n\n');});const candidate=node.text().replace(/\r/g,'').split(/\n\s*\n/).map(p=>p.replace(/[\t \u00a0]+/g,' ').trim()).filter(Boolean).join('\n\n').trim();if(candidate.length>=120){text=candidate;break;}}
  if(!text)throw Error('article_body_not_found');
  if(text.length>100000)text=text.slice(0,100000)+'\n\n[正文长度超过保存上限，已截断]';
  return {text,title:($('meta[property="og:title"]').attr('content')??$('title').text()).trim().slice(0,500),kind:text.endsWith('[正文长度超过保存上限，已截断]')?'excerpt':'article_text'};
}
export async function fetchBody(raw: string, fetcher: typeof fetch=fetch): Promise<Original> {
  let url=articleUrl(raw);const signal=AbortSignal.timeout(20000);
  for(let hop=0;hop<4;hop++){
    const response=await fetcher(url.href,{redirect:'manual',signal,headers:{'User-Agent':'EverydayTechNews-reader/1.1 (+local private reading)','Accept':'text/html'}});
    if([301,302,303,307,308].includes(response.status)){
      await response.body?.cancel();const target=response.headers.get('location');if(!target)throw Error('article_redirect_invalid');url=articleUrl(new URL(target,url).href);continue;
    }
    if([401,402,403,429].includes(response.status)){await response.body?.cancel();throw Error(response.status===429?'publisher_rate_limited':'publisher_access_restricted');}
    if(response.status!==200){await response.body?.cancel();throw Error('publisher_http_error');}
    if(!/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type')??'')){await response.body?.cancel();throw Error('article_not_html');}
    if(Number(response.headers.get('content-length'))>2*1024*1024){await response.body?.cancel();throw Error('article_too_large');}
    const stream=response.body?.getReader();if(!stream)throw Error('article_empty');let bytes=0;const chunks:Uint8Array[]=[];
    try{while(true){const part=await stream.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2*1024*1024)throw Error('article_too_large');chunks.push(part.value);}}finally{await stream.cancel().catch(()=>{});}
    const charset=/charset\s*=\s*["']?([\w-]+)/i.exec(response.headers.get('content-type')??'')?.[1]??'utf-8';
    const html=new TextDecoder(charset).decode(Buffer.concat(chunks));const result=extractBody(html,url.href);
    return {state:'available',...result,url:raw,fetched_at:new Date().toISOString(),sha256:textHash(result.text),origin:'publisher_html'};
  }
  throw Error('article_redirect_limit');
}
export function candidates(config: Config, now=new Date()): Row[] {
  const rows:Row[]=[],seen=new Set<string>();
  // Give both editions capacity; ordinary has no saved bodies in its business state.
  const ordinary=new Reader(config.ordinary),premium=new Reader(config.premium);
  try{
    for(let i=0;i<7;i++){
      const d=day(new Date(now.getTime()-i*86400000));
      try{const md=readFileSync(ordinary.path('news_archive/'+d.slice(0,7)+'/'+d.slice(8)+'.md'),'utf8');for(const m of md.matchAll(/^- \[(.*?)\]\((.*?)\)/gm))rows.push({title:m[1],url:m[2],date:d,component:'ordinary'});}catch{/* Missing archive days are not source fetch failures. */}
    }
    const from=day(new Date(now.getTime()-6*86400000));
    rows.push(...premium.query("SELECT json_extract(data,'$.url') url,json_extract(data,'$.title') title,json_extract(data,'$.fetched_at') date,json_extract(data,'$.content_origin') origin FROM articles WHERE date(json_extract(data,'$.fetched_at'),'+8 hours')>=? ORDER BY json_extract(data,'$.fetched_at') DESC",from).filter(a=>!/_article_html$/.test(a.origin??'')).map(a=>({...a,component:'premium'})));
    if(premium.evidence.some(e=>e.source==='state.sqlite3'&&e.state!=='ok'))throw Error('business_snapshot_unavailable');
  }finally{ordinary.close();premium.close();}
  return rows.filter(r=>{if(!r.url||seen.has(r.url))return false;seen.add(r.url);try{articleUrl(r.url);return true;}catch{return false;}});
}
export async function collectBodies(config: Config, cacheRoot: string, deps:{now?:Date;fetcher?:typeof fetch;items?:Row[];pauseMs?:number}={}) {
  const now=deps.now??new Date(),start=Date.now(),rows=deps.items??candidates(config,now),selected:Row[]=[],counts:Record<string,number>={},perEdition:Record<string,number>={};
  for(const row of rows){
    const old=cachedBody(cacheRoot,row.url);if(old?.state==='available'||old?.state==='blocked'||old?.state==='unsupported'||(old?.retry_at&&new Date(old.retry_at)>now)||(old?.attempts??0)>=3)continue;
    const host=articleUrl(row.url).hostname,edition=row.component??'ordinary';if((counts[host]??0)>=20||(perEdition[edition]??0)>=40)continue;
    selected.push(row);counts[host]=(counts[host]??0)+1;perEdition[edition]=(perEdition[edition]??0)+1;if(selected.length>=60)break;
  }
  let done=0,failed=0;
  for(const row of selected){
    if(Date.now()-start>150000)break;
    const old=cachedBody(cacheRoot,row.url),attempts=(old?.attempts??0)+1;
    try{const value=await fetchBody(row.url,deps.fetcher);saveBody(cacheRoot,{...value,title:value.title||row.title,attempts});done++;}
    catch(e:any){const reason=['publisher_not_supported','publisher_access_restricted','publisher_rate_limited','publisher_http_error','article_body_not_found','article_not_html','article_too_large','article_redirect_limit','article_redirect_invalid'].includes(e.message)?e.message:'article_fetch_failed';saveBody(cacheRoot,{url:row.url,title:row.title,state:reason==='publisher_access_restricted'?'blocked':'unavailable',reason,attempts,fetched_at:now.toISOString(),retry_at:new Date(now.getTime()+6*3600000).toISOString()});failed++;}
    await delay(deps.pauseMs??800);
  }
  const status={version:'1.1.0',checked_at:new Date().toISOString(),candidate_count:rows.length,queued:selected.length,completed:done,failed};
  mkdirSync(cacheRoot,{recursive:true,mode:0o700});const temp=join(cacheRoot,'status.tmp');writeFileSync(temp,JSON.stringify(status),{mode:0o600});renameSync(temp,join(cacheRoot,'status.json'));return status;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const config={ordinary:process.env.DASHBOARD_ORDINARY_DATA??'/data/ordinary',premium:process.env.DASHBOARD_PREMIUM_DATA??'/data/premium',runtime:'/data/runtime'},root=process.env.DASHBOARD_BODY_CACHE??'/data/bodies';
  do{try{console.log(JSON.stringify(await collectBodies(config,root)));}catch{console.error('article_collection_unavailable');}if(process.argv.includes('--once'))break;await delay(300000);}while(true);
}
