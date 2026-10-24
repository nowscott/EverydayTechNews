import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, statSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
export const bodyKey = (url: string) => createHash('sha256').update(url).digest('hex');
export const textHash = (text: string) => createHash('sha256').update(text).digest('hex');
export type Original = {state: string; kind?: string; text?: string; title?: string; url: string; fetched_at?: string; reason?: string; sha256?: string; attempts?: number; retry_at?: string; origin?: string};
export function cachedBody(root: string | undefined, url: string): Original | null {
  if (!root) return null;
  try {
    const file = join(resolve(root),bodyKey(url)+'.json');
    if (!realpathSync(file).startsWith(realpathSync(root)+sep) || statSync(file).size>1024*1024) throw Error('invalid_cache');
    const v=JSON.parse(readFileSync(file,'utf8'));
    if(v.url!==url || !['available','blocked','unavailable','unsupported'].includes(v.state) || (v.state==='available' && (typeof v.text!=='string' || textHash(v.text)!==v.sha256))) throw Error('invalid_cache');
    return v;
  } catch(e:any) {return e.code==='ENOENT'?null:{state:'unavailable',url,reason:'cache_unreadable'};}
}
export function saveBody(root: string, value: Original) {
  mkdirSync(root,{recursive:true,mode:0o700});
  const file=join(root,bodyKey(value.url)+'.json'), temp=file+'.'+randomBytes(6).toString('hex')+'.tmp';
  writeFileSync(temp,JSON.stringify(value),{mode:0o600});renameSync(temp,file);
}

const PUBLISHERS = new Set(['www.ithome.com','ithome.com','www.apple.com','apple.com','developer.apple.com','www.macrumors.com','macrumors.com','blogs.nvidia.com','nvidianews.nvidia.com','github.blog','blog.cloudflare.com','openai.com','www.openai.com','deepmind.google','blog.google','research.google','huggingface.co','www.microsoft.com','microsoft.com','devblogs.microsoft.com','www.nasa.gov','nasa.gov','science.nasa.gov','blogs.nasa.gov','electrek.co','teslanorth.com','www.teslanorth.com','www.qbitai.com','qbitai.com','arstechnica.com','www.quantamagazine.org','news.mit.edu','www.bloomberg.com','bloomberg.com']);
export function articleUrl(raw: string): URL {
  const u=new URL(raw);
  if(u.protocol!=='https:' || u.port || u.username || u.password || !PUBLISHERS.has(u.hostname) || /(?:login|signin|subscribe|unsubscribe|account|logout)/i.test(u.pathname)) throw Error('publisher_not_supported');
  return u;
}
