import { Store } from './store.ts';
import { pyjson, stamp, day, policy, type Row } from './core.ts';
import { editionInput, editionReviewKey, validateEditionReview, auditMembers, EDITION_REVIEW_VERSION } from './edition-quality.ts';
import { paidRequest, type PaidDependencies } from './model.ts';
import { limitDomains } from './editorial-policy.ts';
import { preferences } from './ranking.ts';

export function editionExclusions(store: Store, records: Row[], deadline: string, rejected: Row[] = []): Row[] {
  const row = store.one('SELECT data FROM meta WHERE key=?', 'edition_exclusions:' + day(new Date(deadline)));
  const exclusions: Row[] = row ? JSON.parse(row.data) : [];
  return records.filter(r => {
    const member = auditMembers([r])[0];
    const finding = exclusions.find(e => e.id === member.id && e.fingerprint === member.fingerprint && e.draft_hash === member.draft_hash && e.input_hash === member.input_hash);
    if (finding) rejected.push({ id: member.id, reason: 'edition_' + finding.finding.reason, finding: finding.finding, review_key: finding.key });
    return !finding;
  });
}
export function checkedEdition(store: Store, records: Row[], deadline: string, rejected: Row[] = []): Row[] {
  // A previously audited superset is valid for a subset (e.g. articles expire before delivery).
  // Never mix individually approved articles from different whole-edition reviews.
  const snapshot = store.one("SELECT data FROM meta WHERE key='edition_review'");
  if (!snapshot) { rejected.push(...records.map(r => ({ id: r.article.id, reason: 'edition_review_not_ready' }))); return []; }
  const audit = JSON.parse(snapshot.data);
  if (audit.day !== day(new Date(deadline))) return [];
  const p = policy();
  const job = store.one('SELECT article,result FROM jobs WHERE key=?', audit.key);
  if (!job?.result) return [];
  const input = JSON.parse(job.article).edition_input; const result = JSON.parse(job.result);
  if (audit.key !== editionReviewKey(input, p) || !Number.isFinite(Date.parse(result.generated_at)) || Date.parse(result.generated_at) > Date.parse(deadline)) return [];
  try { validateEditionReview(result, input); } catch { return []; }
  const members = auditMembers(records); const excluded = new Map(result.exclusions.map((e: Row) => [e.id, e]));
  const accepted: Row[] = [];
  for (const r of records) {
    const m = members.find(m => m.id === r.article.id)!;
    const bound = audit.members.some((old: Row) => old.id === m.id && old.fingerprint === m.fingerprint && old.draft_hash === m.draft_hash && old.input_hash === m.input_hash);
    const finding = excluded.get(m.id) as Row | undefined;
    if (!bound || finding) rejected.push({ id: m.id, reason: !bound ? 'edition_review_not_ready' : 'edition_' + finding!.reason, ...(finding ? { finding } : {}), review_key: audit.key });
    else accepted.push(r);
  }
  return limitDomains(accepted, rejected);
}
export async function reviewEdition(store: Store, records: Row[], p: Row, deadline: string, permit?: Row, deps: PaidDependencies = {}): Promise<Row> {
  // Audit a bounded reserve, including replacements before domain/publisher caps.
  const pool = records.slice(0, 40);
  if (pool.length < Number(preferences().edition_minimum)) return { status: 'edition_pool_insufficient', calls: 0 };
  const input = editionInput(pool); const key = editionReviewKey(input, p);
  const a = { id: key, title: '整期科技新闻一致性验收', url: 'https://example.invalid/edition/' + key, task_kind: 'edition_review',
    output_schema: EDITION_REVIEW_VERSION, content_status: 'usable_excerpt', text: pyjson(input), content_fingerprint: key,
    source_name: '冻结前整期检查', published_at: stamp(), edition_input: input };
  store.run('INSERT OR IGNORE INTO jobs(key,article,status) VALUES (?,?,?)', key, pyjson(a), 'queued');
  const job = store.one('SELECT * FROM jobs WHERE key=?', key)!;
  if (job.status === 'failed_validation_review' && job.attempts < Math.min(3, p.max_attempts)
    && !store.one('SELECT id FROM calls WHERE job=? AND cost IS NULL', key)) store.run("UPDATE jobs SET status='queued' WHERE key=?", key);
  const before = store.one('SELECT COUNT(*) n FROM calls')!.n;
  const blocked = await paidRequest(store, key, a, p, permit, deps);
  const saved = store.one('SELECT result FROM jobs WHERE key=?', key);
  if (saved?.result) {
    const result = JSON.parse(saved.result); validateEditionReview(result, input);
    if (Date.parse(result.generated_at) <= Date.parse(deadline)) {
      const exclusionKey = 'edition_exclusions:' + day(new Date(deadline));
      const old = store.one('SELECT data FROM meta WHERE key=?', exclusionKey);
      const findings = result.exclusions.map((finding: Row) => ({ ...auditMembers(pool).find(m => m.id === finding.id), finding, key }));
      store.run('INSERT OR REPLACE INTO meta VALUES (?,?)', exclusionKey, pyjson([...(old ? JSON.parse(old.data) : []), ...findings]));
      store.run('INSERT OR REPLACE INTO meta VALUES (?,?)', 'edition_review', pyjson({ key, day: day(new Date(deadline)), version: EDITION_REVIEW_VERSION, members: auditMembers(pool), policy: pyjson(p) }));
      store.run("UPDATE jobs SET status='edition_reviewed' WHERE key=?", key); store.checkpoint();
    }
  }
  return { status: saved?.result ? 'edition_reviewed' : blocked ?? 'edition_review_pending', key,
    calls: store.one('SELECT COUNT(*) n FROM calls')!.n - before };
}
