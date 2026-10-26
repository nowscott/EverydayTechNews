import {load} from 'cheerio/slim';
import type {Row} from './core.ts';
export function materialRequest(value:string):Row|null{
 try{
  const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||u.search)return null;
  if(u.hostname==='github.com'){
   const m=/^\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9_.-]{1,100})\/releases\/tag\/(.+?)\/?$/.exec(u.pathname);if(!m||['.','..'].includes(m[2]))return null;
   const tag=decodeURIComponent(m[3]);if(!tag||tag.length>200||/[\x00-\x1f]/.test(tag))return null;
   return {kind:'release_notes',owner:m[1],repo:m[2],tag,fetch_url:`https://api.github.com/repos/${m[1]}/${m[2]}/releases/tags/${encodeURIComponent(tag)}`,canonical_url:`https://github.com/${m[1]}/${m[2]}/releases/tag/${encodeURIComponent(tag)}`};
  }
  if(u.hostname==='arxiv.org'){
   const m=/^\/abs\/((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Za-z]{2})?\/\d{7}))(?:v([1-9]\d*))?\/?$/.exec(u.pathname);if(!m)return null;
   const version=Number(m[2]??1);return {kind:'preprint_abstract',paper:m[1],version,fetch_url:`https://arxiv.org/abs/${m[1]}v${version}`,canonical_url:`https://arxiv.org/abs/${m[1]}v${version}`};
  }
 }catch{/* Invalid metadata never authorizes a fetch. */}return null;
}
export function parseMaterial(raw:string,request:Row):Row{
 if(request.kind==='release_notes'){
  const v=JSON.parse(raw);const canonical=materialRequest(v.html_url??'');
  if(v.draft!==false||typeof v.body!=='string'||!v.body.trim()||v.tag_name!==request.tag||canonical?.canonical_url.toLowerCase()!==request.canonical_url.toLowerCase())return {body_probe_status:'release_metadata_unconfirmed'};
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(v.published_at??'')||!Number.isFinite(Date.parse(v.published_at)))return {body_probe_status:'publication_timestamp_unconfirmed'};
  const $=load(v.body);$('script,style,form,img,iframe').remove();
  return {body_probe_status:'parsed',text:[v.name??v.tag_name,v.prerelease?'Prerelease: true':'', $.root().text()].filter(Boolean).join('\n'),publication_raw:v.published_at,canonical_url:request.canonical_url,material_kind:request.kind,content_origin:'hn_github_release',publisher_host:'github.com',source_name:v.prerelease?'GitHub 预发布说明（作者自述）':'GitHub 发布说明（作者自述）',material_version:v.tag_name};
 }
 const $=load(raw),title=$('meta[name="citation_title"]').attr('content')?.trim(),id=$('meta[name="citation_arxiv_id"]').attr('content')?.replace(/v\d+$/,'');
 if(!title||id!==request.paper)return {body_probe_status:'paper_identity_unconfirmed'};
 const abstract=$('blockquote.abstract').first().clone();abstract.find('.descriptor').remove();
 const text=abstract.text().trim();
 const history=$('.submission-history').text();
 const dates=[...history.matchAll(/\[v(\d+)\]\s*((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+\d\d:\d\d:\d\d\s+UTC)/g)].filter(m=>Number(m[1])===request.version);
 if(dates.length!==1||!Number.isFinite(Date.parse(dates[0][2])))return {body_probe_status:'publication_timestamp_unconfirmed'};
 // The visible version marker must agree; a server returning a different revision is not usable evidence.
 const served=materialRequest($('meta[property="og:url"]').attr('content')??'');
 if(served?.paper!==request.paper||served?.version!==request.version||!text)return {body_probe_status:'paper_version_unconfirmed'};
 return {body_probe_status:'parsed',text:title+'\n'+text,publication_raw:new Date(Date.parse(dates[0][2])).toISOString(),canonical_url:request.canonical_url,material_kind:request.kind,content_origin:'hn_arxiv_abstract',publisher_host:'arxiv.org',source_name:'arXiv 预印本摘要（论文作者陈述）',material_version:'v'+request.version};
}
