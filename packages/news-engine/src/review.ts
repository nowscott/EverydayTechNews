import { Store } from './store.ts';
import { pyjson, type Row } from './core.ts';
import { paidRequest, validate, type PaidDependencies } from './model.ts';
import { REVIEW_VERSION, reviewKey, displayFields, isApproved } from './quality.ts';

export async function reviewDraft(store: Store, job: Row, a: Row, p: Row, permit?: Row, deps: PaidDependencies = {}): Promise<string> {
  if (!job.result) return 'no_draft';
  const draft = JSON.parse(job.result);
  try { validate(draft, a); } catch { return 'invalid_cached_draft'; }
  if (isApproved(a, draft, p)) return 'ai_approved';
  const key = reviewKey(a, draft, p);
  const independentDraft = Object.fromEntries(['title', 'summary', 'short_summary', 'points', 'why'].map(k => [k, draft[k]]));
  const input = { ...a, output_schema: 'review-1', task_kind: 'review', review_draft: independentDraft, review_fields: Object.keys(displayFields(draft)) };
  store.run('INSERT OR IGNORE INTO jobs(key,article,status) VALUES (?,?,?)', key, pyjson(input), 'queued');
  const blocked = await paidRequest(store, key, input, p, permit, deps);
  const review = store.one('SELECT * FROM jobs WHERE key=?', key)!;
  if (!review.result) return blocked ?? review.status;
  const result = JSON.parse(review.result);
  store.run('UPDATE jobs SET status=? WHERE key=?', result.verdict === 'pass' ? 'review_passed' : 'review_rejected', key); const reviewedAt = result.generated_at;
  draft.ai_review = { key, version: REVIEW_VERSION, reviewed_at: reviewedAt, result };
  if (result.verdict === 'pass') {
    store.run("UPDATE jobs SET result=?,status='ai_approved' WHERE key=?", pyjson(draft), job.key);
  } else {
    // The rejected draft remains immutable in the review job; only a known-cost new revision may replace it.
    a.revision_feedback = result.checks.filter((c: Row) => !c.pass);
    store.run("UPDATE jobs SET result=?,article=?,status='ai_rejected' WHERE key=?", pyjson(draft), pyjson(a), job.key);
  }
  store.checkpoint();
  return result.verdict === 'pass' ? 'ai_approved' : 'ai_rejected';
}
export function prepareRevision(store: Store, job: Row, p: Row): boolean {
  if (job.status !== 'ai_rejected' || job.attempts >= Math.min(3, p.max_attempts)
      || store.one('SELECT id FROM calls WHERE job=? AND cost IS NULL', job.key)) return false;
  store.run("UPDATE jobs SET result=NULL,status='queued' WHERE key=?", job.key); store.checkpoint(); return true;
}
