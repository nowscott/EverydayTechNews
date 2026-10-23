import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, statSync, realpathSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { resolve, sep, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { cachedBody, articleUrl } from './body-cache.ts';
import { redact, safeUrl } from './security.ts';
export type Row = Record<string, any>;
export type Component = 'ordinary' | 'premium';
export type Config = { ordinary: string; premium: string; runtime: string; ordinaryDeployment?: string; premiumDeployment?: string; bodies?: string };
export const day = (now = new Date()) => new Date(now.getTime() + 28800000).toISOString().slice(0, 10);
const dateOf = (value: unknown) => { const d = new Date(String(value)); return Number.isFinite(d.getTime()) ? day(d) : null; };
const parse = (value: string | null) => value ? JSON.parse(value) : null;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export class Reader {
  root: string; evidence: Row[] = []; db?: DatabaseSync; snapshotRoot?: string;
  constructor(root: string) { this.root = resolve(root); }
  path(name: string): string {
    const p = resolve(this.root, name);
    if (!p.startsWith(this.root + sep)) throw Error('invalid_path');
    // Existing state symlinks may not escape the mounted root.
    const real = realpathSync(p), base = realpathSync(this.root);
    if (!real.startsWith(base + sep)) throw Error('unsafe_path');
    return p;
  }
  file(name: string, kind: 'json' | 'text' = 'json'): any {
    try {
      const p = this.path(name), s = statSync(p);
      if (!s.isFile() || s.size > 64 * 1024 * 1024) throw Error('invalid_file');
      const value = readFileSync(p, 'utf8'); const data = kind === 'json' ? JSON.parse(value) : value;
      this.evidence.push({ source: name, state: 'ok', source_time: s.mtime.toISOString() }); return data;
    } catch (e: any) { this.evidence.push({ source: name, state: e.code === 'ENOENT' ? 'missing' : 'unreadable', source_time: null }); return null; }
  }
  list(name: string): string[] {
    try { return readdirSync(this.path(name)).sort(); }
    catch (e: any) { this.evidence.push({ source: name, state: e.code === 'ENOENT' ? 'missing' : 'unreadable', source_time: null }); return []; }
  }
  query(sql: string, ...args: any[]): Row[] {
    try {
      if (!this.db) {
        if(this.snapshotRoot)throw Error('database_busy_snapshot_unavailable');
        const p = this.path('state.sqlite3');
        // Never let SQLite create WAL/SHM auxiliaries in a live business mount.
        // A private DB+WAL copy is accepted only if file identity and nanosecond
        // modification metadata stay unchanged over the entire copy interval.
        this.snapshotRoot = mkdtempSync(join(tmpdir(), 'etn-dashboard-'));
        const target = join(this.snapshotRoot, 'state.sqlite3');
        let captured = false, sourceTime: string | null = null, hasWal = false;
        const describe = (path: string) => {
          try {
            this.path(path.slice(this.root.length + 1));
            const s = statSync(path, {bigint:true});
            return { identity: [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':'), size: s.size, time: Number(s.mtimeMs) };
          } catch(e:any) { if(e.code === 'ENOENT') return null; throw e; }
        };
        for(let attempt=0;attempt<3&&!captured;attempt++) {
          const before = [describe(p),describe(p+'-wal'),describe(p+'-journal')];
          if(before[2] && before[2].size>0n) continue;
          if(!before[0] || before.reduce((n,s)=>n+Number(s?.size??0),0)>192*1024*1024) throw Error('snapshot_unavailable');
          try {
            copyFileSync(p,target);
            rmSync(target+'-wal',{force:true});
            if(before[1]) copyFileSync(p+'-wal',target+'-wal');
          } catch(e:any) { if(e.code==='ENOENT') continue; throw e; }
          const after = [describe(p),describe(p+'-wal'),describe(p+'-journal')];
          captured = before.every((v,i)=>v?.identity===after[i]?.identity);
          if(captured) { hasWal=!!before[1];sourceTime=new Date(Math.max(...before.map(v=>v?.time??0))).toISOString(); }
        }
        if(!captured) throw Error('database_busy_snapshot_changed');
        const uri = 'file:' + target + (hasWal ? '?mode=ro' : '?immutable=1&mode=ro');
        this.db = new DatabaseSync(uri, { readOnly: true, timeout: 1000 });
        this.db.exec('PRAGMA query_only=ON; BEGIN');
        this.evidence.push({ source: 'state.sqlite3', state: 'ok', source_time: sourceTime, snapshot: 'verified_private_copy' });
      }
      return this.db.prepare(sql).all(...args) as Row[];
    } catch (e: any) { this.evidence.push({ source: 'state.sqlite3', state: /busy|locked/i.test(e.message) ? 'busy' : 'unreadable', source_time: null }); return []; }
  }
  close() { try { this.db?.close(); } finally { if(this.snapshotRoot)rmSync(this.snapshotRoot,{recursive:true,force:true}); } }
}
const stage = (status: string, hasResult: boolean) => status === 'ai_approved' ? 'approved' : ['ai_rejected','review_rejected','discarded_invalid_draft'].includes(status) ? 'rejected' : /failed|uncertain/.test(status) ? 'failed' : hasResult ? 'rewritten' : status === 'inflight' ? 'processing' : 'queued';
function issues(r: Reader, component: Component): Row[] {
  return r.query(component === 'ordinary' ? 'SELECT * FROM issues' : `SELECT id,json_set(json_remove(data,'$.approved_drafts','$.rejected','$.source_health'), '$.articles', json(COALESCE((SELECT json_group_array(json_object('id',json_extract(value,'$.id'),'url',json_extract(value,'$.url'),'title',json_extract(value,'$.title'))) FROM json_each(issues.data,'$.articles')),'[]'))) data FROM issues`).map(row => {
    const v = parse(row.data); return { id: row.id, date: row.day ?? dateOf(v.collection_cutoff ?? v.frozen_at), mode: v.mode, kind: v.kind ?? 'newsletter', frozen_at: v.frozen_at, count: (v.items ?? v.articles ?? []).length, data: v };
  });
}
function receipts(r: Reader, component: Component): Row[] {
  if (component === 'ordinary') return r.query('SELECT id,issue,email,status,attempts,data FROM deliveries').map(row => {
    const v = parse(row.data); return { id: row.id, issue: row.issue, recipient: row.email, status: row.status, attempts: row.attempts, started_at: v.first_started_at ?? v.started_at, accepted_at: v.accepted_at, reason: v.reason };
  });
  return r.list('deliveries').filter(n => /^[a-f0-9]+\.json$/.test(n)).flatMap(n => {
    const v = r.file('deliveries/' + n); return v ? [{ id: n.slice(0,-5), issue: v.issue, recipient: v.recipient, status: v.status, attempts: v.attempts, started_at: v.started_at, accepted_at: v.accepted_at, reason: v.reason }] : [];
  });
}
function news(r: Reader, component: Component, from: string, to: string): Row[] {
  const editions = issues(r, component), selected = new Map<string, string[]>();
  for (const i of editions) for (const a of i.data.articles ?? i.data.items ?? []) {
    const url = Array.isArray(a) ? a[1] : a.url;
    if (url) selected.set(url, [...(selected.get(url) ?? []), i.id]);
  }
  if (component === 'ordinary') {
    const grades = new Map(r.query('SELECT * FROM grades WHERE day>=? AND day<=?', from, to).map(v => [v.day+'\0'+v.url, v]));
    const result: Row[] = [];
    for (let d = from; d <= to;) {
      const md = r.file('news_archive/'+d.slice(0,7)+'/'+d.slice(8)+'.md', 'text');
      for (const match of (md ?? '').matchAll(/^- \[(.*?)\]\((.*?)\)/gm)) {
        const [,title,url] = match, g = grades.get(d+'\0'+url), raw = g?.status ?? 'ungraded';
        result.push({ id: digest(d+'\0'+url), component, date: d, title, url: safeUrl(url), source: 'IT之家', fetched_at: null, published_at: null,
          date_basis: 'source_archive_day', score: g?.score ?? null, score_system: 'IT之家读者投票', score_detail: g ? parse(g.data) : null,
          stage: raw === 'valid' ? 'graded' : raw === 'failed' ? 'failed' : raw === 'filtered' ? 'filtered' : 'collected', raw_status: raw,
          rewrite: null, review: 'not_applicable', editions: selected.get(url) ?? [] });
      }
      const next = new Date(d+'T00:00:00+08:00'); next.setUTCDate(next.getUTCDate()+1); d = day(next);
      if (d > to) break;
    }
    return result;
  }
  const jobs = r.query("SELECT key,json_remove(article, '$.text', '$.description_clean', '$.ranking.config', '$.generation_policy') article,status,result,attempts FROM jobs WHERE COALESCE(json_extract(article,'$.task_kind'),'') NOT IN ('review','edition_review') AND COALESCE(json_extract(article,'$.output_schema'),'') NOT IN ('review-1','edition-review-1') ORDER BY rowid").map(j => ({...j, article: parse(j.article), result: parse(j.result)}));
  const byArticle = new Map<string, Row>();
  for (const j of jobs) byArticle.set(j.article.id+'\0'+j.article.content_fingerprint, j);
  const seen = new Set<string>();
  return r.query("SELECT id,fingerprint,json_remove(data, '$.text', '$.description_clean') data, MIN(julianday(json_extract(data,'$.fetched_at'))) first_fetch FROM articles GROUP BY id,json_extract(data,'$.content_fingerprint') HAVING date(first_fetch, '+8 hours') BETWEEN ? AND ?",from,to).flatMap(row => {
    const a = parse(row.data), date = dateOf(a.fetched_at);
    if (!date || date < from || date > to) return [];
    const key = a.id+'\0'+a.content_fingerprint; if (seen.has(key)) return []; seen.add(key);
    const j = byArticle.get(key), v = j?.article ?? a, ranking = v.ranking;
    return [{ id: digest(key), component, date, title: a.title, url: safeUrl(a.url), source: a.source_name ?? a.source,
      fetched_at: a.fetched_at, published_at: a.published_at, date_basis: 'first_fetch_day',
      score: ranking?.score ?? null, score_system: ranking?.version ?? '未评分', score_detail: ranking ? { breakdown: ranking.breakdown, signals: ranking.signals, note: ranking.note } : null,
      stage: j ? stage(j.status, !!j.result) : 'collected', raw_status: j?.status ?? 'not_queued', rewrite: j?.result ?? null,
      article_id:a.id,content_fingerprint:a.content_fingerprint,
      review: j?.status === 'ai_approved' ? 'passed' : j?.status === 'ai_rejected' ? 'rejected' : j?.result ? 'pending' : 'not_started', editions: selected.get(a.url) ?? [] }];
  });
}
export function deliveryState(rows: Row[], expected?: number): string {
  if (!rows.length) return 'pending';
  if (rows.some(r => r.status === 'unknown_do_not_retry')) return 'unknown';
  if (rows.some(r => r.status === 'sending')) return 'sending';
  if (rows.some(r => /failed|refused|rejected|expired|exhausted|not_sent/.test(r.status))) return 'failed';
  if (rows.every(r => ['smtp_accepted','subscription_no_longer_eligible'].includes(r.status)) && rows.some(r => r.status === 'smtp_accepted') && (expected == null || rows.length === expected)) return 'smtp_accepted';
  return 'pending';
}
export function operation(record: Row | null, now = new Date(), component: Component = 'ordinary'): Row {
  if (!record) return { state: 'unknown', reason: '暂无任务执行记录' };
  const elapsed = now.getTime() - Date.parse(record.started_at);
  if (record.state === 'running') return { ...record, state: elapsed >= 45*60000 ? 'unknown' : 'running', reason: elapsed >= 45*60000 ? '任务超过45分钟，结果待确认' : null };
  if (record.exit_code !== 0) return { ...record, state: 'failed', reason: '最近一次任务退出失败' };
  const local = new Date(now.getTime()+28800000), h = local.getUTCHours();
  const maxAge = component === 'ordinary' ? 3*60000 : (h >= 4 && h < 9 ? 20 : 40)*60000;
  return { ...record, state: now.getTime()-Date.parse(record.finished_at) > maxAge ? 'overdue' : 'waiting', reason: now.getTime()-Date.parse(record.finished_at) > maxAge ? '超过预期调度间隔，尚无新记录' : null };
}
export function range(params: URLSearchParams, now = new Date()) {
  const to = params.get('to') ?? day(now), from = params.get('from') ?? day(new Date(now.getTime()-6*86400000));
  for (const v of [from,to]) if (!/^\d{4}-\d\d-\d\d$/.test(v) || !Number.isFinite(Date.parse(v+'T00:00:00Z')) || new Date(v+'T00:00:00Z').toISOString().slice(0,10) !== v) throw Error('invalid_date');
  if (from > to || Date.parse(to)-Date.parse(from) > 30*86400000) throw Error('date_range_maximum_31_days');
  const page = Number(params.get('page') ?? '1'); if (!Number.isInteger(page) || page < 1 || page > 100000) throw Error('invalid_page');
  return {from,to,page};
}
export class Dashboard {
  config: Config;
  constructor(config: Config) { this.config = config; }
  read(component: Component, action: (r: Reader) => any) {
    const r = new Reader(this.config[component]);
    try {
      const data = action(r), failures = r.evidence.filter(v => v.state !== 'ok');
      return redact({ component, read_at: new Date().toISOString(), read_state: failures.length ? 'partial' : 'ok', evidence: r.evidence, data });
    } finally { r.close(); }
  }
  overview(now = new Date()) {
    const date = day(now);
    return (['ordinary','premium'] as Component[]).map(component => this.read(component, r => {
      const report = r.file('status.json'), config = r.file(component === 'ordinary' ? 'config.json' : 'trial.json');
      const all = news(r, component, date, date), allReceipts = receipts(r, component), todayIssues = issues(r,component).filter(i => i.date === date);
      const current = allReceipts.filter(v => todayIssues.some(i => i.id === v.issue));
      const calls = component === 'premium' ? r.query('SELECT cost,reserved,status FROM calls WHERE day=?',date) : [];
      const runtime = new Reader(this.config.runtime); let run: Row;
      try { run = operation(runtime.file(component+'/latest.json'),now,component); } finally { r.evidence.push(...runtime.evidence.map(e=>({...e,source:'runtime/'+e.source}))); runtime.close(); }
      const deploymentPath = this.config[component === 'ordinary' ? 'ordinaryDeployment' : 'premiumDeployment']; let version = report?.runtime?.version ?? null;
      if (deploymentPath) { const dep = new Reader(deploymentPath); try { version = dep.file('deployment.json')?.active?.tag ?? version; r.evidence.push(...dep.evidence.map(e=>({...e,source:'deployment/'+e.source}))); } finally { dep.close(); } }
      const feedback = component === 'ordinary' ? r.file('feedback/'+date+'.json') : null;
      const byStage = Object.fromEntries([...new Set(all.map(v=>v.stage))].map(s => [s,all.filter(v=>v.stage===s).length]));
      const sources = component === 'premium' ? r.file('source-health.json') : report?.collection;
      let delivery = deliveryState(current, component === 'ordinary' ? report?.delivery?.expected : undefined);
      const due = now >= new Date(date+'T09:00:00+08:00');
      const enabled = config && (component === 'ordinary' ? config.mode !== 'paused' && date >= (config.mode === 'production' ? config.first_production_date : config.shadow_started_on) : config.enabled && config.delivery_enabled && (!config.expires_at || now < new Date(config.expires_at)));
      const alerts: string[] = [];
      if (['unknown','overdue','failed'].includes(run.state)) alerts.push(run.reason);
      if (due && enabled && delivery !== 'smtp_accepted') alerts.push('已过当日投递窗口，未见完整的服务器接收记录');
      if (delivery === 'unknown') alerts.push('存在发送结果未知记录，不应自动重发');
      if (report?.last_error) alerts.push('业务报告记录了错误，请查看运行记录');
      if (sources?.sources?.some((s: Row) => !s.ok)) alerts.push('部分新闻来源最近采集失败');
      if (calls.some(c=>c.cost==null)) alerts.push('存在待确认模型费用');
      const dbUnavailable = r.evidence.some(e => e.source === 'state.sqlite3' && e.state !== 'ok');
      if (dbUnavailable) { alerts.push('业务数据库无法读取，数量和发送状态待确认'); delivery = 'unknown'; }
      const reportTime = report?.at ?? r.evidence.find(e=>e.source==='status.json')?.source_time ?? null;
      if (!report || !config) alerts.push('业务报告或运行配置缺失，当前运行状态待确认');
      if (reportTime && now.getTime()-Date.parse(reportTime) > (component === 'ordinary' ? 10 : 90)*60000) alerts.push('业务报告已超过预期更新时间');
      return { date, mode: component === 'ordinary' ? config?.mode : config?.production_enabled ? 'production' : config?.mode ?? 'unknown', version,
        operation: run, collected: dbUnavailable ? null : all.length, stages: dbUnavailable ? {} : byStage, delivery, inbox: feedback?.status === 'received_confirmed' ? 'received_confirmed' : 'not_verified',
        issues: todayIssues.map(({data,...v})=>v), calls: component === 'premium' && !dbUnavailable ? calls.length : null,
        estimated_cny: component === 'premium' && !dbUnavailable ? calls.reduce((n,c)=>n+Number(c.cost??0),0) : null,
        unknown_reserved_cny: component === 'premium' && !dbUnavailable ? calls.reduce((n,c)=>n+(c.cost==null?Number(c.reserved??0):0),0) : null,
        sources, alerts, count_basis: component === 'ordinary' ? '新闻数按来源归档日期；未记录精确首次抓取时间。普通版不调用 AI。' : '新闻数按首次抓取日期，按文章及正文指纹去重；各阶段为这些新闻的当前状态。模型调用和费用按调用账本日期。',
        report_time: report?.at ?? r.evidence.find(e=>e.source==='status.json')?.source_time ?? null };
    }));
  }
  news(component: Component, params: URLSearchParams, id?: string) {
    const {from,to,page} = range(params);
    return this.read(component, r => {
      let rows = news(r,component,from,to);
      const sources = [...new Set(rows.map(a=>a.source))].sort();
      if (id) { const row = rows.find(v=>v.id===id); if (!row) throw Error('not_found'); return {...row,original:this.original(r,component,row)}; }
      const q = (params.get('q') ?? '').toLowerCase(), source = params.get('source'), status = params.get('stage');
      rows = rows.filter(a => a.title.toLowerCase().includes(q) && (!source || a.source === source) && (!status || a.stage === status));
      rows.sort(params.get('sort') === 'score' ? (a,b)=>(b.score??-Infinity)-(a.score??-Infinity) : (a,b)=>String(b.fetched_at??b.date).localeCompare(String(a.fetched_at??a.date)));
      return { items: rows.slice((page-1)*30,page*30).map(({rewrite,score_detail,...v})=>v), total: rows.length, page, page_size: 30, sources, from,to };
    });
  }
  original(r: Reader, component: Component, row: Row): Row {
    const cache=cachedBody(this.config.bodies,row.url);
    if(cache?.state==='available')return cache;
    if(component==='premium'){
      const stored=r.query("SELECT data FROM articles WHERE id=? AND json_extract(data,'$.content_fingerprint')=? ORDER BY rowid LIMIT 1",row.article_id,row.content_fingerprint)[0];
      const a=stored?parse(stored.data):null;
      let text=a?.text;
      if(!text&&/^bodies\/[a-f0-9]{64}\.json$/.test(a?._body_ref??'')){
        const manifest=r.file('archive-manifests/objects.json'),entry=manifest?.[a._body_ref];
        if(entry&&Date.parse(entry.expires_at)>Date.now()){
          const raw=r.file('transient/'+a._body_ref,'text');
          if(raw&&digest(raw)===entry.sha256)text=JSON.parse(raw).text;
        }
      }
      if(typeof text==='string'&&text.trim())return {state:'available',kind:/_article_html$/.test(a.content_origin??'')?'article_text':'excerpt',url:row.url,text:text.slice(0,100000),fetched_at:a.body_fetched_at??a.fetched_at,origin:a.content_origin,background_state:cache?.state??'pending'};
    }
    if(cache)return cache;
    try{articleUrl(row.url);}catch{return {state:'unsupported',url:row.url,reason:'publisher_not_supported'};}
    return {state:'pending',url:row.url,reason:'background_capture_pending'};
  }
  issues(component: Component, params: URLSearchParams, id?: string) {
    const {from,to,page}=range(params);
    return this.read(component,r=>{
      const all=issues(r,component).filter(v=>v.date>=from&&v.date<=to).sort((a,b)=>String(b.frozen_at??b.date??'').localeCompare(String(a.frozen_at??a.date??''))), deliveries=receipts(r,component);
      const rows: Row[]=all.map(({data,...v})=>({...v,delivery:deliveryState(deliveries.filter(d=>d.issue===v.id)),delivery_count:deliveries.filter(d=>d.issue===v.id&&d.status==='smtp_accepted').length}));
      if (!id) return {items:rows.slice((page-1)*30,page*30),total:rows.length,page,page_size:30};
      const found=all.find(v=>v.id===id);if(!found)throw Error('not_found');
      const text=component==='premium'?r.file('issues/'+found.id+'/email.txt','text'):(found.data.items??[]).map((item:string[],index:number)=>`${index+1}. ${item[0]}\n${safeUrl(item[1])??'链接不可用'}`).join('\n\n');
      return {...rows.find(v=>v.id===id), preview_text:text, preview_items:component==='ordinary'?found.data.items:found.data.articles.map((a:Row)=>({title:a.title,url:safeUrl(a.url)})), receipts:deliveries.filter(d=>d.issue===id), quality:found.data.edition_review??null};
    });
  }
  runs(component: Component, params: URLSearchParams) {
    const {from,to,page}=range(params), r=new Reader(this.config.runtime);
    try {
      const records=r.list(component).filter(n=>/^\d.*\.json$/.test(n)).reverse().filter(n=>n.slice(0,10)>=from&&n.slice(0,10)<=to);
      const data=records.slice((page-1)*30,page*30).flatMap(n=>{const v=r.file(component+'/'+n);return v?[v.state==='running' && Date.now()-Date.parse(v.started_at)>=45*60000 ? {...v,state:'unknown'} : v]:[];});
      const business=this.read(component,b=>{const s=b.file('status.json');return {sources:component==='premium'?b.file('source-health.json'):s?.collection,last_error:s?.last_error,report_time:s?.at??b.evidence.find(e=>e.source==='status.json')?.source_time};});
      return redact({component,read_at:new Date().toISOString(),read_state:r.evidence.some(e=>e.state!=='ok')?'partial':'ok',evidence:r.evidence,data:{items:data,total:records.length,page,page_size:30,business}});
    } finally {r.close();}
  }
}
