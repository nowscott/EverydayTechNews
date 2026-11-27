import { appendFileSync, writeFileSync, existsSync } from 'node:fs';
import { Store, acknowledgeArtifact } from './store.ts';
import { command, atomic, read, digest, pyjson, stamp, day, at, active, trial, type Row } from './core.ts';
import { resolveTestSubscribers } from './subscribers.ts';
import { collect, assess, enrich, compose, deliver, due, reportTrial } from './pool.ts';

export function morningTime(now: Date): boolean {
  return now >= at(day(now), '04:00:00') && now < at(day(now), '09:00:00');
}
export function phase(store: Store, name: string, now = new Date()) {
  atomic(store.root + '/durable/mornings/' + day(now) + '.json', { ...(() => { try { return read(store.root + '/durable/mornings/' + day(now) + '.json'); } catch { return {}; } })(), [name]: stamp(now) });
  store.checkpoint();
}

/** 写稿阶段只留了时间戳，零调用时看不出原因。这里单独落盘状态、调用数与跳过原因汇总。 */
export function summarizeEnrich(result: Row = {}): Row {
  const skipped: Row = {};
  for (const item of result?.jobs ?? []) { const key = String(item?.status ?? 'unknown'); skipped[key] = (skipped[key] ?? 0) + 1; }
  return { candidates_ready: result?.candidates_ready ?? null, ready: result?.ready ?? null, pending_review: result?.pending_review ?? null,
    publishable: result?.publishable ?? null, jobs: (result?.jobs ?? []).length, skipped };
}

export function recordEnrichment(store: Store, today: string, entry: Row) {
  const base = store.root + '/durable/mornings/';
  atomic(base + today + '-enrichment.json', entry);
  const historyPath = base + today + '-enrichment-history.json';
  let history: Row[] = []; try { if (existsSync(historyPath)) history = read(historyPath); } catch { history = []; }
  history.push(entry); if (history.length > 50) history = history.slice(-50);
  atomic(historyPath, history);
  store.checkpoint();
}

/** 单步可续跑：每次进程只做一步，进度写在 durable/mornings/<day>.json，下一轮从下一步继续。 */
export async function morningStep(store: Store, now = new Date(), deps = { collect, assess, enrich, compose, deliver }): Promise<Row> {
  const t = trial(store.root);
  if (!active(t, now)) return { status: 'trial_disabled_or_expired', terminal: true };
  if (now >= at(day(now), '09:00:00')) return { status: 'deadline_missed', terminal: true };
  const today = day(now); const progressPath = store.root + '/durable/mornings/' + today + '.json';
  let progress: Row = {}; try { progress = read(progressPath); } catch {}
  const issueId = 'test-' + today; const issuePath = store.root + '/issues/' + issueId + '/edition.json';
  const stepPath = store.root + '/durable/mornings/' + today + '-stage.json';
  const mark = (stage: string, extra: Row = {}) => atomic(stepPath, { day: today, stage, at: stamp(now), ...extra });

  if (existsSync(issuePath)) {
    if (now < at(day(now), '06:30:00')) { mark('deliver_waiting'); return { status: 'waiting_for_delivery', issue: issueId }; }
    mark('deliver');
    const receipt = await deps.deliver(store, false, now);
    phase(store, 'smtp_' + receipt.status, now);
    mark('done', { delivery: receipt.status });
    return { status: receipt.status, issue: issueId, terminal: ['smtp_accepted', 'unknown_do_not_retry', 'sending', 'recipient_refused'].includes(receipt.status) };
  }

  if (now < at(day(now), '06:15:00')) {
    if (!progress.candidates_ready) {
      mark('collect');
      await deps.collect(store);
      phase(store, 'candidates_ready', now);
      return { status: 'collected' };
    }
    if (!progress.assessment_completed) {
      mark('assess');
      deps.assess(store, now);
      atomic(progressPath, { ...progress, assessment_completed: stamp(now) });
      return { status: 'assessed' };
    }
    if (!progress.pool_ready) {
      mark('enrich');
      const started = stamp(now);
      try {
        const result = await deps.enrich(store);
        recordEnrichment(store, today, { day: today, stage: 'enrich', status: result?.status ?? 'enriched', calls: result?.calls ?? 0,
          started_at: started, finished_at: stamp(now), ...summarizeEnrich(result), at: stamp(now) });
        phase(store, 'writing_progress', now);
        if (result.status === 'ready_pool_sufficient') { atomic(progressPath, { ...progress, assessment_completed: progress.assessment_completed ?? stamp(now), writing_progress: stamp(now), pool_ready: stamp(now) }); mark('compose_waiting'); }
        return { status: result.status ?? 'enriched' };
      } catch (error) {
        recordEnrichment(store, today, { day: today, stage: 'enrich', status: 'enrich_error', calls: 0, started_at: started,
          finished_at: stamp(now), pending_review: null, publishable: null, error_code: (error as Error).message, at: stamp(now) });
        throw error;
      }
    }
    mark('compose_waiting');
    return { status: 'pool_ready_waiting_compose' };
  }

  mark('compose');
  const issue = deps.compose(store, now);
  phase(store, 'edition_frozen', now);
  return { status: 'edition_frozen', issue: issue.id };
}

export function archiveStage(store: Store) {
  if (process.env.GITHUB_ACTIONS !== 'true') return;
  const path = store.archive(day());
  const name = `pool-evidence-${day()}-${process.env.GITHUB_RUN_ID}-${Date.now()}`;
  command([process.execPath, new URL('../tools/upload-archive.mjs', import.meta.url).pathname, path, name]);
  acknowledgeArtifact(store, name);
}
export async function morningTick(store: Store, now = new Date(), deps = { collect, assess, enrich, compose, deliver }): Promise<Row> {
  if (!active(trial(store.root), now)) return { status: 'trial_disabled_or_expired', terminal: true };
  if (now >= at(day(now), '09:00:00')) return { status: 'deadline_missed', terminal: true };
  if (store.localAuthority && now >= at(day(now), '06:00:00') && now < at(day(now), '06:15:00')) {
    const marker = store.root + '/subscriber-backups/refresh-day.json';
    let refreshed = ''; try { refreshed = read(marker).day; } catch {}
    if (refreshed !== day(now)) {
      atomic(marker, { day: day(now) });
      try { const result = await resolveTestSubscribers(store.root, at(day(now), '06:15:00'), false); atomic(store.root + '/subscriber-backups/premium-report.json', result.report); }
      catch (error) { atomic(store.root + '/subscriber-backups/premium-report.json', { source: 'unavailable', reason: (error as Error).message, at: new Date().toISOString() }); }
    }
  }
  const plan = due(store, now);
  if (now < at(day(now), '06:15:00')) {
    if (plan.collect) { await deps.collect(store); phase(store, 'candidates_ready', now); }
    else if (plan.enrich) deps.assess(store, now);
    if (plan.enrich) { await deps.enrich(store); phase(store, 'writing_progress', now);
      if (store.one("SELECT key FROM jobs WHERE status='ai_approved'")) phase(store, 'ai_review_passed', now); }
    return { status: 'preparing', terminal: false };
  }
  // No network collection/model work after the writing cutoff; only frozen evidence is eligible.
  const issue = deps.compose(store, now); phase(store, 'edition_frozen', now);
  if (!plan.deliver) return { status: 'waiting_for_delivery', terminal: false };
  let receipt: Row;
  try { receipt = await deps.deliver(store, false, now); } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (!message.startsWith('notion_') && !['premium_checkbox_missing', 'premium_test_checkbox_missing'].includes(message)) throw error;
    phase(store, 'notion_delivery_blocked', now);
    return { status: 'notion_delivery_blocked', terminal: false };
  }
  phase(store, 'smtp_' + receipt.status, now);
  return { status: receipt.status, issue: issue.id, terminal: ['smtp_accepted', 'unknown_do_not_retry', 'sending', 'recipient_refused'].includes(receipt.status) };
}
export function publishMorningReport(store: Store, now = new Date()) {
  const report = reportTrial(store, now); const today = report.days.find(d => d.day === day(now));
  let subscribers = null; try { subscribers = read(store.root + '/subscriber-backups/premium-report.json'); } catch {}
  const entry = { ...today, at: stamp(now), quality_control: 'ai_fidelity_review', subscribers };
  atomic(store.root + '/durable/mornings/' + day(now) + '-report.json', entry); store.checkpoint();
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### 晨间出刊 ${day(now)}\n\n${JSON.stringify(entry)}\n`);
  if (process.env.GITHUB_ACTIONS !== 'true' || !today || (!today.reason && today.status !== 'diagnostic' && !today.delivery.some(s => ['sending', 'unknown_do_not_retry'].includes(s)))) return;
  const repo = process.env.GITHUB_REPOSITORY!;
  if (repo !== 'nowscott/EverydayTechNews-data') throw new Error('alert_requires_private_repository');
  const title = 'Premium morning exception ' + day(now);
  try {
  const ids = command(['gh', 'issue', 'list', '--repo', repo, '--state', 'all', '--search', '"' + title + '" in:title', '--json', 'number,title']);
  const existing = JSON.parse(ids).find((v: Row) => v.title === title);
  const bodyPath = store.root + '/.cache/morning-alert.md';
  atomic(bodyPath + '.json', entry);
  // No subscriber lists, article bodies or credentials in operational alerts.
  writeFileSync(bodyPath, `Morning outcome: ${today.status}\nDelivery: ${today.delivery.join(', ') || 'not_attempted'}\nReason: ${today.reason ?? 'insufficient_content_or_uncertain_delivery'}\nRun: https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}\n`);
  command(existing ? ['gh', 'issue', 'edit', String(existing.number), '--repo', repo, '--body-file', bodyPath]
    : ['gh', 'issue', 'create', '--repo', repo, '--title', title, '--body-file', bodyPath]);
  } catch { console.log('::warning::Private morning alert could not be updated; durable report remains saved.'); }
}
export async function runMorning(store: Store) {
  phase(store, 'restore_completed'); archiveStage(store);
  const started = Date.now(); let lastArchive = '';
  while (Date.now() - started < 340 * 60000) {
    const outcome = await morningTick(store);
    const signature = digest(pyjson(store.all('SELECT key,status,attempts FROM jobs')) + pyjson(store.all('SELECT id,status FROM calls')) + pyjson(store.all('SELECT id FROM issues')));
    if (signature !== lastArchive || outcome.terminal) { archiveStage(store); lastArchive = signature; }
    if (outcome.terminal) { publishMorningReport(store); return outcome; }
    await new Promise(resolve => setTimeout(resolve, 30000));
  }
  publishMorningReport(store); return { status: 'runtime_limit' };
}
