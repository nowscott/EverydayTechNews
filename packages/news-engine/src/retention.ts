import { existsSync, lstatSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { atomic, day, stamp, type Row } from './core.ts';
import { Store, files } from './store.ts';

export interface RetentionPolicy {
  transient_days: number;
  assessment_days: number;
  observation_days: number;
  article_days: number;
  job_days: number;
}

export interface RetentionPlan {
  policy: RetentionPolicy;
  generated_at: string;
  cutoff: { transient: string; assessment: string; observation: string; article: string; job: string };
  files: { assessments: { count: number; bytes: number; names: string[] }; transient: { count: number; bytes: number; refs: string[] } };
  tables: { observations: number; articles: number; jobs: number };
  estimated_bytes: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  transient_days: 7,
  assessment_days: 14,
  observation_days: 30,
  article_days: 30,
  job_days: 14,
};

export function retentionPolicy(overrides: Partial<RetentionPolicy> = {}): RetentionPolicy {
  return Object.fromEntries(Object.entries({ ...DEFAULT_RETENTION, ...overrides }).map(([key, value]) => {
    if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 3650) throw new Error('invalid_retention_days');
    return [key, Number(value)];
  })) as unknown as RetentionPolicy;
}

const cutoffAt = (now: Date, days: number) => stamp(new Date(now.getTime() - days * 86400000));
const dateOnly = (now: Date, days: number) => day(new Date(now.getTime() - days * 86400000)).replaceAll('-', '');

function fileBytes(path: string): number {
  try { return lstatSync(path).size; } catch { return 0; }
}

function assessmentFiles(root: string, cutoffDay: string): { names: string[]; bytes: number } {
  const directory = join(root, 'durable', 'assessments');
  if (!existsSync(directory)) return { names: [], bytes: 0 };
  const names: string[] = []; let bytes = 0;
  for (const name of files(directory)) {
    const base = name.slice(name.lastIndexOf('/') + 1);
    if (!/^\d{14,24}\.json$/.test(base)) continue;
    if (base.slice(0, 8) >= cutoffDay) continue;
    names.push(name); bytes += fileBytes(name);
  }
  return { names, bytes };
}

function transientFiles(store: Store, now: Date, days: number): { refs: string[]; bytes: number } {
  const cutoff = now.getTime() - days * 86400000;
  const refs: string[] = []; let bytes = 0;
  for (const path of files(join(store.root, 'transient'))) {
    const relative = path.slice(store.root.length + '/transient/'.length);
    const entry = store.objects[relative];
    // 仍被账本引用且未过期的证据必须保留；其余按时间回收。
    if (entry && now.getTime() < Date.parse(entry.expires_at)) continue;
    let stat; try { stat = lstatSync(path); } catch { continue; }
    if (stat.mtimeMs > cutoff) continue;
    refs.push(relative); bytes += stat.size;
  }
  return { refs, bytes };
}

function oldArticles(store: Store, cutoff: string): string[] {
  const referenced = new Set<string>();
  for (const row of store.all('SELECT article FROM jobs')) {
    try { const article = JSON.parse(row.article); if (article?.id) referenced.add(article.id); } catch { /* invalid rows are handled by the state verifier */ }
  }
  const ids: string[] = [];
  for (const row of store.all('SELECT rowid,id,data FROM articles')) {
    if (referenced.has(row.id)) continue;
    let fetched = '';
    try { fetched = JSON.parse(row.data).fetched_at ?? ''; } catch { /* keep malformed rows for verification */ }
    if (!fetched || fetched >= cutoff) continue;
    ids.push(String(row.rowid));
  }
  return ids;
}

function oldJobs(store: Store, cutoff: string): string[] {
  const keep = new Set(['ai_approved', 'edition_reviewed', 'review_passed']);
  const ids: string[] = [];
  for (const row of store.all('SELECT rowid,status,article FROM jobs')) {
    if (keep.has(row.status)) continue;
    let at = '';
    try {
      const article = JSON.parse(row.article);
      at = article.queued_at ?? article.fetched_at ?? article.published_at ?? '';
    } catch { /* malformed rows stay for the verifier to reject */ }
    if (at && at < cutoff) ids.push(String(row.rowid));
  }
  return ids;
}

export function retentionPlan(store: Store, overrides: Partial<RetentionPolicy> = {}, now = new Date()): RetentionPlan {
  const policy = retentionPolicy(overrides);
  const transient = transientFiles(store, now, policy.transient_days);
  const assessments = assessmentFiles(store.root, dateOnly(now, policy.assessment_days));
  const observations = Number(store.one('SELECT count(*) AS n FROM observations WHERE observed_at < ?', cutoffAt(now, policy.observation_days))?.n ?? 0);
  const articles = oldArticles(store, cutoffAt(now, policy.article_days));
  const jobs = oldJobs(store, cutoffAt(now, policy.job_days));
  return { policy, generated_at: stamp(now),
    cutoff: { transient: cutoffAt(now, policy.transient_days), assessment: dateOnly(now, policy.assessment_days),
      observation: cutoffAt(now, policy.observation_days), article: cutoffAt(now, policy.article_days), job: cutoffAt(now, policy.job_days) },
    files: { assessments: { count: assessments.names.length, bytes: assessments.bytes, names: assessments.names },
      transient: { count: transient.refs.length, bytes: transient.bytes, refs: transient.refs } },
    tables: { observations, articles: articles.length, jobs: jobs.length },
    estimated_bytes: assessments.bytes + transient.bytes };
}

export function retentionSummary(plan: RetentionPlan): Row {
  return { policy: plan.policy, generated_at: plan.generated_at, cutoff: plan.cutoff,
    files: { assessments: { count: plan.files.assessments.count, bytes: plan.files.assessments.bytes },
      transient: { count: plan.files.transient.count, bytes: plan.files.transient.bytes } },
    tables: plan.tables, estimated_bytes: plan.estimated_bytes };
}

export function applyRetention(store: Store, plan: RetentionPlan, now = new Date()): Row {
  // 先删库再重写账本：即使进程在中途被杀，下一次运行也能从 SQLite 重新生成一致状态。
  let articleDelete: string[] = []; let jobDelete: string[] = [];
  store.tx(() => {
    store.run('DELETE FROM observations WHERE observed_at < ?', plan.cutoff.observation);
    // 先删旧任务，再算文章引用，避免已被淘汰的 queued 任务继续保护旧文章。
    jobDelete = oldJobs(store, plan.cutoff.job);
    for (const rowid of jobDelete) store.run('DELETE FROM jobs WHERE rowid=?', Number(rowid));
    articleDelete = oldArticles(store, plan.cutoff.article);
    for (const rowid of articleDelete) store.run('DELETE FROM articles WHERE rowid=?', Number(rowid));
  });
  for (const ref of plan.files.transient.refs) rmSync(join(store.root, 'transient', ref), { force: true });
  for (const name of plan.files.assessments.names) rmSync(name, { force: true });
  store.checkpoint(true);
  const result = { status: 'applied', at: stamp(now), policy: plan.policy, removed: {
    transient_files: plan.files.transient.count, transient_bytes: plan.files.transient.bytes,
    assessment_files: plan.files.assessments.count, assessment_bytes: plan.files.assessments.bytes,
    observations: plan.tables.observations, articles: articleDelete.length, jobs: jobDelete.length,
    estimated_bytes: plan.estimated_bytes } };
  atomic(join(store.root, 'durable', 'retention.json'), result);
  return result;
}

export function retentionDue(now = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }).format(now));
  return hour === 3;
}
