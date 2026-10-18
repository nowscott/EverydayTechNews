import { mkdirSync, existsSync } from 'node:fs';
import { Store, files } from './store.ts';
import { atomic, read, pyjson, digest, policy, trial, active, stamp, day, localParts, at, EXPIRY, type Row } from './core.ts';
import { preferences, VERSION } from './ranking.ts';
import { duplicate, select } from './editor.ts';
import { cacheKey, paidRequest, validate, codepoints } from './model.ts';
import { fetchSource, mapLimit, SOURCES } from './sources.ts';
import { freezeIssue, sendOnce } from './mail.ts';

export function rows(store: Store, cutoff = stamp()): Row[] {
  const last = new Map(store.all('SELECT id,fingerprint,MAX(observed_at) observed FROM observations WHERE observed_at<=? GROUP BY id,fingerprint', cutoff).map(r => [r.id + '\0' + r.fingerprint, r.observed]));
  return store.all('SELECT data FROM articles').map(r => { const a = JSON.parse(r.data); a._last_observed_at = last.get(a.id + '\0' + a.content_fingerprint) ?? a.fetched_at; return a; });
}
export function candidates(store: Store, cutoff: string, target = Number.MAX_SAFE_INTEGER, floor?: string): [Row[], Row[]] {
  const prior = files(store.root + '/deliveries').map(read).filter(r => r.status === 'smtp_accepted').flatMap(r => {
    const path = store.root + '/issues/' + r.issue + '/edition.json';
    if (!existsSync(path)) return [];
    const edition = read(path);
    // A diagnostic does not display its article drafts, so it must not consume them.
    return edition.kind === 'diagnostic' ? [] : edition.articles;
  });
  const articles: Row[] = []; const reasons: Row[] = [];
  for (const a of rows(store, cutoff)) {
    let reason: string | null = null;
    if (floor && Date.parse(a.published_at) < Date.parse(floor)) reason = 'expires_before_next_edition';
    else if (a.evidence_expired_or_missing) reason = 'evidence_expired_or_missing';
    else if (!a.original_article_published_at && ['hn_submission', 'atom_update_not_publication', 'discovery_time_not_publication'].includes(a.published_time_kind)) reason = 'article_publication_unconfirmed';
    if (reason) { reasons.push({ id: a.id, reason }); continue; }
    const matches = prior.filter(x => duplicate(a, x));
    if (matches.some(x => a.content_fingerprint === x.content_fingerprint)) { reasons.push({ id: a.id, reason: 'already_sent_unchanged' }); continue; }
    if (matches.length) { a.prior_versions = matches.map(x => ({ url: x.url, fingerprint: x.content_fingerprint })); a.update_review_required = true; }
    a.output_schema = 'dual-1'; articles.push(a);
  }
  const [chosen, rejected] = select(articles, cutoff, false, target); const approved: Row[] = [];
  for (const a of chosen) {
    if (a.update_review_required) {
      let record: Row | undefined;
      try { record = read(store.root + '/durable/update-approvals/' + a.content_fingerprint + '.json'); } catch { /* Missing approval is a rejection. */ }
      const facts = record?.new_facts;
      if (!record || record.fingerprint !== a.content_fingerprint || !record.reviewed_by || !record.reviewed_at || !Array.isArray(facts) || !facts.length
        || !facts.every(f => f && f.fact && typeof f.evidence === 'string' && codepoints(f.evidence) >= 8 && a.text.includes(f.evidence))) {
        rejected.push({ id: a.id, reason: 'update_delta_pending_review', prior_versions: a.prior_versions }); continue;
      }
      a.confirmed_update_facts = facts;
    }
    approved.push(a);
  }
  return [approved, [...reasons, ...rejected]];
}
export function writingWindow(now = new Date()): [string, string] {
  let end = at(day(now), '06:00:00'); if (now.getTime() >= end.getTime() + 15 * 60000) end = new Date(end.getTime() + 86400000);
  return [stamp(new Date(Math.min(now.getTime(), end.getTime()))), stamp(new Date(end.getTime() - 86400000))];
}
export function attemptedVersions(store: Store, date = day()): Set<string> {
  return new Set(store.all('SELECT DISTINCT c.job,j.article FROM calls c LEFT JOIN jobs j ON j.key=c.job WHERE c.day=?', date)
    .filter(r => !r.article || JSON.parse(r.article).output_schema === 'dual-1').map(r => r.job));
}
function queue(store: Store, articles: Row[], p: Row) {
  for (const a of articles) { a.job_key = cacheKey(a, p); a.queued_at ??= stamp(); a.generation_policy ??= { ...p };
    store.run('INSERT OR IGNORE INTO jobs(key,article,status) VALUES (?,?,?)', a.job_key, pyjson(a), 'queued'); }
}
export function assess(store: Store, now = new Date()) {
  const config = preferences(); const p = policy(); const [cutoff, floor] = writingWindow(now);
  const [selected, rejected] = candidates(store, cutoff, Number.MAX_SAFE_INTEGER, floor); queue(store, selected, p);
  const excluded: Row = {}; for (const r of rejected) excluded[r.reason] = (excluded[r.reason] ?? 0) + 1;
  const report = { at: stamp(now), ranking_version: VERSION, config, selected: selected.map(a => ({ id: a.id, fingerprint: a.content_fingerprint, title: a.title, ranking: a.ranking })),
    rejections: rejected, funnel: { total_versions: rows(store).length, selected: selected.length, excluded } };
  atomic(store.root + '/durable/assessments/' + stamp(now).replaceAll(/[^0-9]/g, '') + '.json', report); store.checkpoint(); return report;
}
export async function collect(store: Store, workers = 4, fetcher: typeof fetch = fetch) {
  if (!Number.isInteger(workers) || workers < 1 || workers > 4) throw new Error('collection_workers_must_be_1_to_4');
  const start = performance.now(); const cpu = process.cpuUsage();
  const results = await mapLimit(Object.keys(SOURCES), workers, source => fetchSource(source, store.root, fetcher));
  store.tx(() => {
    for (const result of results) for (const a of result.rows) {
      store.run('INSERT INTO observations VALUES (?,?,?,?)', a.id, a.content_fingerprint, a.source_observed_at, a.feed_sha256);
      store.run('INSERT OR IGNORE INTO articles VALUES (?,?,?)', a.id, digest(pyjson([a.content_fingerprint, a.title, a.published_at])), pyjson(a));
    }
  });
  const used = process.cpuUsage(cpu); const health = { at: stamp(), sources: results.map(r => r.health),
    performance: { collection_workers: workers, wall_seconds: (performance.now() - start) / 1000, cpu_seconds: (used.user + used.system) / 1e6, source_seconds_sum: results.reduce((n, r) => n + r.health.seconds, 0) },
    coverage_gaps: [{ source: 'spacex', status: 'no_verified_accessible_official_feed', note: 'Official updates page blocked; NASA is partial coverage only' }], engine: 'typescript' };
  store.run('INSERT OR REPLACE INTO meta VALUES (?,?)', 'health', pyjson(health)); atomic(store.root + '/source-health.json', health); store.checkpoint(); assess(store); return health;
}
function repairKnown(store: Store, job: Row, p: Row) {
  if (job.status === 'failed_validation_review' && job.attempts < p.max_attempts && store.one("SELECT id FROM calls WHERE job=? AND status='invalid_response' AND cost IS NOT NULL", job.key)
    && !store.one('SELECT id FROM calls WHERE job=? AND cost IS NULL', job.key)) store.run("UPDATE jobs SET status='queued' WHERE key=?", job.key);
}
export async function enrich(store: Store) {
  const config = trial(store.root); if (!active(config) || !config.model_enabled) return { status: 'trial_or_model_disabled_or_expired', calls: 0 };
  const p = policy(); p.daily_budget_cny = Math.min(p.daily_budget_cny, config.daily_budget_cny);
  let batchDeadline = at(day(), '06:15:00'); if (Date.now() >= batchDeadline.getTime()) batchDeadline = new Date(batchDeadline.getTime() + 86400000);
  // A batch admitted at 06:10 must stop admitting requests at 06:12 even if it runs long.
  const permit = { mode: 'internal_test_anytime', issue_id: 'test-pool-' + config.start, expires_at: stamp(new Date(Math.min(batchDeadline.getTime(), Date.parse(config.expires_at)))) };
  const [cutoff, floor] = writingWindow(); const [eligible] = candidates(store, cutoff, Number.MAX_SAFE_INTEGER, floor);
  const ready = recordsReady(store, eligible, permit.expires_at, []);
  if (ready.length >= Number(preferences().edition_maximum)) return { status: 'ready_pool_sufficient', ready: ready.length, calls: 0 };
  const keys = new Set(eligible.map(a => cacheKey(a, p))); const attempted = attemptedVersions(store); let invoked = 0; const statuses: Row[] = [];
  const jobs = store.all('SELECT * FROM jobs WHERE result IS NULL').sort((a, b) => (JSON.parse(b.article).ranking?.score ?? 0) - (JSON.parse(a.article).ranking?.score ?? 0));
  for (const job of jobs) {
    if (invoked >= Number(preferences().batch_size)) break; if (!keys.has(job.key)) continue;
    if (!attempted.has(job.key) && attempted.size >= Number(preferences().new_versions_per_day)) break;
    const a = JSON.parse(job.article); if (!a.text || a.evidence_expired_or_missing) continue; repairKnown(store, job, p);
    const before = store.one('SELECT COUNT(*) n FROM calls')!.n;
    const blocked = await paidRequest(store, job.key, a, p, permit); const added = store.one('SELECT COUNT(*) n FROM calls')!.n - before;
    invoked += added; if (added) attempted.add(job.key); statuses.push({ job: job.key, status: blocked ?? store.one('SELECT status FROM jobs WHERE key=?', job.key)!.status });
    if (blocked && ['budget_exhausted', 'missing_api_key', 'official_rules_unconfirmed', 'rules_expired_or_future', 'test_permit_expired', 'trial_expired'].includes(blocked)) break;
  }
  store.checkpoint(); return { status: 'processed_or_pending', calls: invoked, jobs: statuses };
}
export function status(store: Store) {
  const ledger = store.all('SELECT day,COUNT(*) calls,SUM(cost) estimated_cny,SUM(CASE WHEN cost IS NULL THEN reserved ELSE 0 END) unknown_reserved_cny FROM calls GROUP BY day');
  for (const item of ledger) {
    const usages = store.all('SELECT usage FROM calls WHERE day=? AND usage IS NOT NULL', item.day).map(r => JSON.parse(r.usage));
    item.actual_api_tokens = Object.fromEntries(['prompt_tokens', 'completion_tokens', 'prompt_cache_hit_tokens'].map(k => [k, usages.reduce((n, u) => n + (u[k] ?? 0), 0)])); item.calls_with_usage = usages.length;
  }
  const health = store.one("SELECT data FROM meta WHERE key='health'"); const storage = store.one("SELECT data FROM meta WHERE key='artifact_storage'");
  const report = { at: stamp(), engine: 'typescript', jobs: store.all('SELECT status,COUNT(*) count FROM jobs GROUP BY status'), calls: ledger,
    missing_or_expired_evidence: new Set(store.missing).size, cost_is_estimate: true, sources: health ? JSON.parse(health.data) : null,
    archive_bytes: Object.values(store.objects).filter((v: any) => v.status !== 'expired').reduce((n: number, v: any) => n + v.bytes, 0),
    actual_artifact_storage: storage ? JSON.parse(storage.data) : null, storage_quota: 'Check private Actions billing; storage is not assumed free or unlimited' };
  atomic(store.root + '/status.json', report); return report;
}
export function reconcile(store: Store) {
  store.run("UPDATE jobs SET status='uncertain_requires_review' WHERE status='inflight'");
  store.run("UPDATE calls SET status='interrupted_usage_unknown' WHERE status='reserved'"); store.expire(); store.checkpoint(); return status(store);
}
function recordsReady(store: Store, articles: Row[], deadline: string, rejected: Row[]): Row[] {
  const records: Row[] = []; const p = policy();
  for (const a of articles) {
    const key = cacheKey(a, p); const job = store.one('SELECT * FROM jobs WHERE key=?', key);
    if (!job?.result) { rejected.push({ id: a.id, reason: 'ai_not_ready', job_status: job?.status ?? 'not_queued' }); continue; }
    const g = JSON.parse(job.result);
    if (!g.generated_at || Date.parse(g.generated_at) > Date.parse(deadline)) { rejected.push({ id: a.id, reason: 'generated_after_deadline' }); continue; }
    try { validate(g, a); } catch { rejected.push({ id: a.id, reason: 'saved_result_failed_current_validation' }); continue; }
    a.job_key = key; records.push({ article: a, result: g, status: job.status, calls: store.all('SELECT * FROM calls WHERE job=?', key), human_review: 'not_started' });
    if (records.length >= Number(preferences().edition_maximum)) break;
  }
  return records;
}
export function compose(store: Store, now = new Date()) {
  const config = trial(store.root); if (!active(config, now)) return { status: 'trial_disabled_or_expired' };
  const cutoff = stamp(at(day(now), '06:00:00')); const deadline = stamp(at(day(now), '06:15:00'));
  if (now.getTime() < Date.parse(deadline)) return { status: 'generation_deadline_not_reached' };
  const id = 'test-' + day(now); const path = store.root + '/issues/' + id + '/edition.json'; if (existsSync(path)) return read(path);
  const [chosen, rejected] = candidates(store, cutoff, Number.MAX_SAFE_INTEGER); const records = recordsReady(store, chosen, deadline, rejected);
  const issue = { id, pool_edition: true, mode: 'daily_24h', collection_cutoff: cutoff, generation_cutoff: deadline, frozen_at: stamp(now), articles: records.map(r => r.article), rejected,
    source_health: status(store).sources, shortfall: Math.max(0, Number(preferences().edition_minimum) - records.length), human_review: 'not_started', kind: records.length >= Number(preferences().edition_minimum) ? 'newsletter' : 'diagnostic', sendable_count: 0, engine: 'typescript' };
  return freezeIssue(store, issue, records);
}
export type SampleRevision = 'initial' | 'serif';
export function samplePath(root: string, revision: SampleRevision = 'initial') {
  if (!['initial', 'serif'].includes(revision)) throw new Error('invalid_sample_revision');
  return root + (revision === 'serif' ? '/durable/ts-launch-serif.json' : '/durable/ts-launch.json');
}
export async function launchSample(store: Store, revision: SampleRevision = 'initial') {
  if (!store.syncGit) throw new Error('launch_requires_authoritative_private_git');
  const t = trial(store.root); if (!t.enabled || !t.model_enabled || Date.now() >= Date.parse(EXPIRY)) return { status: 'trial_or_model_disabled_or_expired' };
  const path = samplePath(store.root, revision); const p = policy();
  if (!existsSync(path)) {
    const cutoff = stamp(); const [chosen, rejected] = candidates(store, cutoff, Number.MAX_SAFE_INTEGER); queue(store, chosen, p);
    const spec = { id: (revision === 'serif' ? 'sample-ts-serif-' : 'sample-ts-launch-') + day(), mode: 'current_24h_sample', pool_edition: true, articles: chosen, rejected, collection_cutoff: cutoff,
      generation_cutoff: stamp(new Date(Math.min(Date.parse(cutoff) + 30 * 60000, Date.parse(EXPIRY), Date.parse(p.valid_until)))), created_at: stamp(), source_health: status(store).sources };
    atomic(path, store.shrink(spec)); store.checkpoint();
  }
  const spec = store.expand(read(path)); const out = store.root + '/issues/' + spec.id + '/edition.json'; if (existsSync(out)) return read(out);
  const permit = { mode: 'internal_test_anytime', issue_id: spec.id, expires_at: spec.generation_cutoff }; const attempted = attemptedVersions(store);
  processing: for (const a of spec.articles) {
    // Reuse all valid accumulated drafts before paying for any missing ones.
    if (recordsReady(store, spec.articles, spec.generation_cutoff, []).length >= Number(preferences().edition_maximum)) break;
    let job = store.one('SELECT * FROM jobs WHERE key=?', a.job_key)!;
    while (!job.result && job.attempts < p.max_attempts) {
      if (!attempted.has(job.key) && attempted.size >= Number(preferences().new_versions_per_day)) { spec.rejected.push({ id: a.id, reason: 'daily_new_version_limit' }); break processing; }
      repairKnown(store, job, p); const before = store.one('SELECT COUNT(*) n FROM calls')!.n;
      const blocked = await paidRequest(store, job.key, a, p, permit); job = store.one('SELECT * FROM jobs WHERE key=?', a.job_key)!;
      const after = store.one('SELECT COUNT(*) n FROM calls')!.n; if (after > before) attempted.add(job.key);
      if (blocked) {
        spec.rejected.push({ id: a.id, reason: blocked });
        if (['budget_exhausted', 'billing_period_changed', 'missing_api_key', 'official_rules_unconfirmed', 'rules_expired_or_future', 'test_permit_expired', 'trial_expired'].includes(blocked)) break processing;
        break;
      }
      if (after === before || job.status !== 'failed_validation_review') break;
    }
    const ready = recordsReady(store, spec.articles, spec.generation_cutoff, []).length;
    console.log(JSON.stringify({ stage: 'launch_progress', ready, attempted_versions: attempted.size }));
    if (ready >= Number(preferences().edition_maximum)) break;
  }
  const records = recordsReady(store, spec.articles, spec.generation_cutoff, spec.rejected);
  const issue = { ...spec, articles: records.map(r => r.article), shortfall: Math.max(0, Number(preferences().edition_minimum) - records.length),
    human_review: 'not_started', is_trial_day: false, kind: records.length >= Number(preferences().edition_minimum) ? 'newsletter' : 'diagnostic', engine: 'typescript' };
  return freezeIssue(store, issue, records);
}
export async function verifyApi(store: Store) {
  if (!store.syncGit) throw new Error('acceptance_requires_authoritative_private_git');
  const t = trial(store.root); if (!t.enabled || !t.model_enabled || Date.now() >= Date.parse(EXPIRY)) return { status: 'trial_or_model_disabled_or_expired' };
  const path = store.root + '/durable/ts-api-acceptance.json'; const p = policy();
  if (!existsSync(path)) {
    const [chosen] = candidates(store, stamp(), 1); if (!chosen.length) return { status: 'no_eligible_acceptance_article' }; queue(store, chosen, p);
    atomic(path, { mode: 'internal_test_anytime', issue_id: 'test-ts-api-' + day(), job_key: chosen[0].job_key, expires_at: stamp(new Date(Math.min(Date.now() + 30 * 60000, Date.parse(EXPIRY)))) }); store.checkpoint();
  }
  const permit = read(path); const job = store.one('SELECT * FROM jobs WHERE key=?', permit.job_key)!; repairKnown(store, job, p);
  const blocked = await paidRequest(store, job.key, JSON.parse(job.article), p, permit);
  const result = { status: blocked ?? store.one('SELECT status FROM jobs WHERE key=?', job.key)!.status, mail_sent: false, is_trial_day: false, accounting: status(store).calls };
  atomic(store.root + '/durable/ts-api-verification.json', result); store.checkpoint(); return result;
}
export async function deliver(store: Store, sample = false, now = new Date(), revision: SampleRevision = 'initial') {
  const t = trial(store.root); const { hour, minute } = localParts(now);
  if (!sample && (!active(t, now) || hour !== 6 || minute < 30)) return { status: 'outside_0630_0700_delivery_window' };
  let id: string;
  if (sample) { const path = samplePath(store.root, revision); if (!existsSync(path)) return { status: 'sample_missing' }; id = read(path).id; }
  else id = 'test-' + day(now);
  if (!existsSync(store.root + '/issues/' + id + '/edition.json')) return { status: 'edition_missing_do_not_send' };
  return sendOnce(store, id);
}
export function reportTrial(store: Store) {
  const t = trial(store.root); const receipts = files(store.root + '/deliveries').map(read); const days = [];
  for (let i = 0; i < t.days; i++) {
    const date = day(new Date(at(t.start, '00:00:00').getTime() + i * 86400000)); const id = 'test-' + date;
    const path = store.root + '/issues/' + id + '/edition.json'; const issue = existsSync(path) ? read(path) : null; const delivery = receipts.filter(r => r.issue === id).map(r => r.status);
    days.push({ day: date, status: issue?.kind ?? 'missing', reason: !issue && (date < day() || date === day() && localParts().hour >= 7) ? 'scheduler_missed_delivery_deadline' : null,
      generated: issue?.articles.length ?? 0, delivery, human_review: 'not_started', normal_edition: !!issue && issue.kind === 'newsletter' && delivery.includes('smtp_accepted') });
  }
  const result = { days, completed_normal_editions: days.filter(d => d.normal_edition).length, accounting: status(store).calls, human_fact_review: 'not_completed', bill_paid: 'not_verified', engine: 'typescript' };
  atomic(store.root + '/trial-report.json', result); store.checkpoint(); return result;
}
export function due(store: Store, now = new Date()) {
  const t = trial(store.root); const enabled = active(t, now); const { hour, minute } = localParts(now); const morning = hour === 6;
  const path = store.root + '/source-health.json'; const observed = existsSync(path) ? read(path).at : null;
  let collect = !observed || now.getTime() - Date.parse(observed) >= 1800000;
  if (hour === 5 && minute >= 55 && (!observed || Number(observed.slice(14, 16)) < 50)) collect = true;
  return { compose: enabled && morning && minute >= 15 && !existsSync(store.root + '/issues/test-' + day(now) + '/edition.json'),
    deliver: enabled && morning && minute >= 30, collect: collect && !(morning && minute >= 15), enrich: enabled && t.model_enabled && !(morning && minute >= 12), maintain: true };
}
