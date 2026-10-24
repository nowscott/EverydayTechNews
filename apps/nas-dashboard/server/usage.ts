import { createHash } from 'node:crypto';
import { Dashboard, day, range, type Row } from './data.ts';

const stages = ['generation', 'review', 'edition_review', 'unknown'];
const object = (raw: unknown): Row | null => {
  try { const v = typeof raw === 'string' ? JSON.parse(raw) : raw; return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
};
const amount = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const count = (v: unknown) => amount(v) !== null && Number.isSafeInteger(v) ? v as number : null;
const timestamp = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null;
const digest = (v: string) => createHash('sha256').update(v).digest('hex');
export function summarize(rows: Row[]) {
  const sum = (key: string) => rows.reduce((n, r) => n + (r[key] ?? 0), 0);
  const cacheRows = rows.filter(r => r.cache_hit !== null && r.input !== null);
  const denominator = cacheRows.reduce((n, r) => n + r.input, 0);
  return { calls: rows.length, input: sum('input'), output: sum('output'), total: sum('input') + sum('output'), cache_hit: sum('cache_hit'),
    cache_rate: denominator ? cacheRows.reduce((n, r) => n + r.cache_hit, 0) / denominator : null,
    missing_input: rows.filter(r => r.input === null).length, missing_output: rows.filter(r => r.output === null).length,
    missing_usage: rows.filter(r => r.input === null || r.output === null).length, missing_cache: rows.filter(r => r.cache_hit === null).length,
    estimated_cny: sum('cost'), unknown_cost_calls: rows.filter(r => r.cost === null).length,
    unknown_reserved_cny: rows.reduce((n, r) => n + (r.cost === null ? r.reserved ?? 0 : 0), 0),
    repeat_calls: rows.filter(r => r.repeated === true).length, repeat_estimated_cny: rows.filter(r => r.repeated === true).reduce((n, r) => n + (r.cost ?? 0), 0),
    repeat_unknown_cost_calls: rows.filter(r => r.repeated === true && r.cost === null).length,
    repeat_unclassified_calls: rows.filter(r => r.repeated === null).length };
}

/** Token field names deliberately avoid the credential-key redactor's broad /token/ rule. */
export function usage(dashboard: Dashboard, params: URLSearchParams, now = new Date()) {
  const normalized = new URLSearchParams(params);
  if (!normalized.has('from')) normalized.set('from', normalized.get('to') ?? day(now));
  const { from, to, page } = range(normalized, now), stage = params.get('stage') ?? '', status = params.get('status') ?? '', q = (params.get('q') ?? '').toLowerCase();
  if ((stage && !stages.includes(stage)) || status.length > 100 || q.length > 200) throw Error('invalid_usage_filter');
  return dashboard.read('premium', r => {
    const columns = r.query('PRAGMA table_info(calls)').map(v => v.name);
    if (!['id', 'day'].every(c => columns.includes(c))) {
      if (!r.evidence.some(e => e.state !== 'ok')) r.evidence.push({source:'state.sqlite3/calls', state:'unreadable', source_time:null});
      return { available: false, from, to, summary: null, daily: [], stages: [], statuses: [], items: [], total: 0, page, page_size: 30 };
    }
    const tables = r.query("SELECT name FROM sqlite_master WHERE type='table'").map(v => v.name);
    // Select only reporting fields; never load response bodies, prompts or credentials.
    const selected = ['id', 'day', 'job', 'usage', 'cost', 'reserved', 'status', 'seconds'].map(c => columns.includes(c) ? `c.${c}` : `NULL AS ${c}`).join(',');
    const repeat = columns.includes('job') ? '(SELECT MIN(first.id) FROM calls first WHERE first.job=c.job)' : 'NULL';
    const calls = r.query(`SELECT ${selected}, ${repeat} first_id FROM calls c WHERE c.day>=? AND c.day<=? ORDER BY c.id DESC`, from, to);
    const jobs = new Map(tables.includes('jobs') && columns.includes('job') ? r.query("SELECT key, CASE WHEN json_valid(article) THEN json_object('id',json_extract(article,'$.id'),'content_fingerprint',json_extract(article,'$.content_fingerprint'),'task_kind',json_extract(article,'$.task_kind'),'output_schema',json_extract(article,'$.output_schema'),'title',json_extract(article,'$.title')) END article FROM jobs WHERE key IN (SELECT job FROM calls WHERE day>=? AND day<=?)", from, to).map(j => [j.key, object(j.article)]) : []);
    const diagnostics = new Map(tables.includes('meta') ? r.query("SELECT key,data FROM meta WHERE key IN (SELECT 'call_diagnostic:' || id FROM calls WHERE day>=? AND day<=?)", from, to).map(v => [v.key, object(v.data)]) : []);
    const validationErrors = new Map(tables.includes('responses') ? r.query("SELECT call_id,validation_error FROM responses WHERE call_id IN (SELECT id FROM calls WHERE day>=? AND day<=?)", from, to).map(v => [v.call_id, v.validation_error]) : []);
    const articles = new Map(tables.includes('articles') ? r.query("SELECT id, json_extract(data,'$.content_fingerprint') fingerprint, MIN(julianday(json_extract(data,'$.fetched_at'))) first_fetch FROM articles WHERE json_valid(data) GROUP BY id,json_extract(data,'$.content_fingerprint')").map(a => [a.id+'\0'+a.fingerprint, {id:digest(a.id+'\0'+a.fingerprint), date:a.first_fetch == null ? null : day(new Date((a.first_fetch-2440587.5)*86400000))}]) : []);
    const issues = tables.includes('issues') ? r.query("SELECT id,json_extract(data,'$.edition_review.key') review_key,COALESCE(json_extract(data,'$.collection_cutoff'),json_extract(data,'$.frozen_at')) at FROM issues WHERE json_valid(data)") : [];
    const rows = calls.map(c => {
      const a = jobs.get(c.job), d = diagnostics.get('call_diagnostic:'+c.id), u = object(c.usage);
      const reason = d?.error_code ?? validationErrors.get(c.id);
      const input = count(u?.prompt_tokens), output = count(u?.completion_tokens), hit = count(u?.prompt_cache_hit_tokens);
      const kind = a?.task_kind, schema = a?.output_schema;
      const stage = kind === 'edition_review' || schema === 'edition-review-1' ? 'edition_review' : kind === 'review' || schema === 'review-1' ? 'review' : a && !kind && (!schema || ['dual-1','legacy-1'].includes(schema)) ? 'generation' : kind === 'generation' ? 'generation' : 'unknown';
      const article = a ? articles.get(a.id+'\0'+a.content_fingerprint) : null;
      const linkedIssues = stage === 'edition_review' ? issues.filter(i => i.review_key === c.job && timestamp(i.at)) : [];
      return { id:c.id, day:c.day, stage, title:typeof a?.title === 'string' ? a.title : '未关联任务', status:typeof c.status === 'string' ? c.status : 'unknown',
        input, output, total:input !== null && output !== null ? input+output : null, cache_hit:input !== null && hit !== null && hit <= input ? hit : null,
        cost:amount(c.cost), reserved:amount(c.reserved), seconds:amount(c.seconds), repeated:c.job && c.first_id !== null ? c.id !== c.first_id : null,
        started_at:timestamp(d?.started_at), finished_at:timestamp(d?.finished_at),
        error_code:typeof reason === 'string' && /^[a-zA-Z0-9_ .:-]{1,120}$/.test(reason) ? reason : null,
        links:stage === 'edition_review' ? linkedIssues.map(i => ({kind:'issues', id:i.id, date:day(new Date(i.at))})) : article?.date ? [{kind:'news', ...article}] : [] };
    });
    const statuses = [...new Set(rows.map(v => v.status))].sort();
    const filtered = rows.filter(v => (!stage || v.stage === stage) && (!status || v.status === status) && v.title.toLowerCase().includes(q));
    const daily: Row[] = [];
    for (let date = from; date <= to; date = new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10)) daily.push({day:date, ...summarize(filtered.filter(v => v.day === date))});
    const available = !r.evidence.some(e => e.source === 'state.sqlite3' && e.state !== 'ok');
    return { available, unit:'Token', from, to, summary:available ? summarize(filtered) : null, daily:available ? daily : [],
      stages:available ? stages.map(stage => ({stage, ...summarize(filtered.filter(v => v.stage === stage))})) : [], statuses,
      items:available ? filtered.slice((page-1)*30,page*30) : [], total:available ? filtered.length : 0, page, page_size:30 };
  });
}
