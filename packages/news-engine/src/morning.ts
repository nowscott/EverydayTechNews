import { appendFileSync, writeFileSync } from 'node:fs';
import { Store, acknowledgeArtifact } from './store.ts';
import { command, atomic, read, digest, pyjson, stamp, day, at, active, trial, type Row } from './core.ts';
import { collect, assess, enrich, compose, deliver, due, reportTrial } from './pool.ts';

export function morningTime(now: Date): boolean {
  return now >= at(day(now), '04:00:00') && now < at(day(now), '09:00:00');
}
export function phase(store: Store, name: string, now = new Date()) {
  atomic(store.root + '/durable/mornings/' + day(now) + '.json', { ...(() => { try { return read(store.root + '/durable/mornings/' + day(now) + '.json'); } catch { return {}; } })(), [name]: stamp(now) });
  store.checkpoint();
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
  const entry = { ...today, at: stamp(now), quality_control: 'ai_fidelity_review' };
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
