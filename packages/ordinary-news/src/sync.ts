// Isolated archive publisher. No SMTP, Notion or subscriber database is mounted into this container.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync, lstatSync } from 'node:fs';
import { atomic, read, hash, type Row } from './core.ts';
const API='https://api.github.com/repos/nowscott/EverydayTechNews';
const WORKFLOWS=['technews.yml','news-sorter.yml','run-selenium-script.yml'];
const blobHash=(s:Buffer)=>createHash('sha1').update(Buffer.concat([Buffer.from('blob '+s.length+'\0'),s])).digest('hex');
export async function syncArchive(archive:string,state:string,control:Row,token:string,fetcher:typeof fetch=fetch):Promise<Row> {
  if(control.mode!=='production'||control.archive_sync_enabled!==true)return {status:'disabled_in_shadow'};
  const previous=read(state+'/status.json',{}),baseline=read(state+'/baseline.json');
  const pending=(reason:string)=>{const r={status:reason,at:new Date().toISOString(),first_pending_at:previous.first_pending_at??new Date().toISOString()};atomic(state+'/status.json',r);return r;};
  if(!token)return pending('archive_credential_missing');
  if(!baseline?.files)return pending('archive_baseline_required');
  async function api(path:string,body?:Row,auth=true):Promise<Row> {
    const r=await fetcher(API+path,{method:body?'POST':'GET',headers:{Accept:'application/vnd.github+json',...(auth?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000),redirect:'error'});
    if(!r.ok)throw new Error('archive_github_'+r.status);return await r.json() as Row;
  }
  try {
    for(const workflow of WORKFLOWS)if((await api('/actions/workflows/'+workflow,undefined,false)).state!=='disabled_manually')return pending('legacy_archive_writers_not_disabled');
    const head=await api('/git/ref/heads/main');const commit=await api('/git/commits/'+head.object.sha);const tree=await api('/git/trees/'+commit.tree.sha+'?recursive=1');
    if(tree.truncated)throw new Error('archive_remote_tree_truncated');
    const remote=new Map<string,string>(tree.tree.filter((r:Row)=>r.type==='blob'&&r.path.startsWith('news_archive/')).map((r:Row)=>[r.path,r.sha]));
    const prior=read(state+'/published.json',{files:baseline.files});const changes:Row[]=[];
    for(const folder of readdirSync(archive,{withFileTypes:true})) {
      if(folder.isSymbolicLink())throw new Error('archive_symlink_refused');if(!folder.isDirectory()||!/^\d{4}-\d\d$/.test(folder.name))continue;
      for(const file of readdirSync(archive+'/'+folder.name)) {
        if(!/^\d\d\.md$/.test(file))continue;
        const full=archive+'/'+folder.name+'/'+file;if(lstatSync(full).isSymbolicLink())throw new Error('archive_symlink_refused');
        const path='news_archive/'+folder.name+'/'+file,content=readFileSync(full),sha=blobHash(content),old=remote.get(path);
        if(old===sha)continue;
        if(old&&old!==prior.files[path])return pending('archive_conflict_preserved');
        const blob=await api('/git/blobs',{content:content.toString('utf8'),encoding:'utf-8'});
        if(blob.sha!==sha)throw new Error('archive_blob_integrity_failed');changes.push({path,mode:'100644',type:'blob',sha});
      }
    }
    if(changes.length) {
      const newTree=await api('/git/trees',{base_tree:commit.tree.sha,tree:changes});
      const next=await api('/git/commits',{message:'更新 NAS 普通版新闻归档',tree:newTree.sha,parents:[head.object.sha]});
      const r=await fetcher(API+'/git/refs/heads/main',{method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/vnd.github+json'},
        body:JSON.stringify({sha:next.sha,force:false}),signal:AbortSignal.timeout(30000),redirect:'error'});
      if(!r.ok)throw new Error('archive_fast_forward_conflict');for(const c of changes)remote.set(c.path,c.sha);
    }
    atomic(state+'/published.json',{files:Object.fromEntries(remote)});
    const result={status:'synced',at:new Date().toISOString(),changed:changes.length};atomic(state+'/status.json',result);return result;
  }catch{return pending('archive_sync_failed');}
}
if(process.argv[1]?.endsWith('/sync.ts')) {
  const [archive,state,control]=process.argv.slice(2);if(!archive||!state||!control)throw new Error('archive_arguments_required');
  console.log(JSON.stringify(await syncArchive(archive,state,read(control,{}),process.env.ARCHIVE_GITHUB_TOKEN??'')));
}
