import { appendFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Store, restoreArtifacts, acknowledgeArtifact } from './store.ts';
import { atomic, read, day, EXPIRY, RECIPIENT, type Row } from './core.ts';
import { collect, assess, enrich, compose, deliver, launchSample, verifyApi, reconcile, status, reportTrial, due } from './pool.ts';

const args = process.argv.slice(2); const operation = args.shift(); const flags: Row = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--data', '--sync-git', '--collect-workers', '--maintenance-only', '--launch', '--verify-api', '--sample-revision'].includes(args[i])) throw new Error('unknown_argument');
  if (args[i] === '--sync-git') { flags.syncGit = true; i--; continue; }
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('missing_argument');
  flags[args[i].slice(2)] = args[i + 1];
}
for (const key of ['maintenance-only', 'launch', 'verify-api']) if (flags[key] !== undefined && !['true', 'false'].includes(flags[key])) throw new Error('invalid_boolean');
if (flags['sample-revision'] !== undefined && !['initial', 'serif'].includes(flags['sample-revision'])) throw new Error('invalid_sample_revision');
const root = resolve(flags.data ?? 'premium_data/pool'); mkdirSync(root, { recursive: true });
const allowed = ['init', 'run', 'collect', 'assess', 'enrich', 'verify-api', 'launch-sample', 'fresh-sample', 'send-sample', 'compose', 'deliver', 'reconcile', 'status', 'report', 'archive', 'restore-artifact', 'ack-artifact'];
if (!operation || !allowed.includes(operation)) throw new Error('unknown_command');
let localLock: string | undefined;
if (!process.env.NEWS_ENGINE_FLOCKED) {
  if (process.platform === 'linux') {
    const result = spawnSync('flock', ['-x', root + '/pool.lock', process.execPath, ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, NEWS_ENGINE_FLOCKED: '1' } });
    process.exit(result.status ?? 1);
  }
  if (flags.syncGit) throw new Error('authoritative_operations_require_linux_flock');
  // Local offline copies only. Never clear a live/stale lock automatically.
  localLock = root + '/ts-offline.lock'; mkdirSync(localLock);
}
let store: Store | undefined;
try {
  if (operation === 'restore-artifact') { restoreArtifacts(root); console.log(JSON.stringify({ status: 'restored' })); }
  else {
    if (operation === 'run') restoreArtifacts(root);
    store = new Store(root, !!flags.syncGit);
    if (operation === 'init') {
      if (!existsSync(root + '/trial.json')) {
        atomic(root + '/trial.json', { schema_version: 1, mode: 'internal_test', enabled: false, start: '2026-10-19', days: 7, expires_at: EXPIRY, allowed_recipient: RECIPIENT,
          daily_budget_cny: 2, model_enabled: false, delivery_enabled: false, production_enabled: false, authorization: 'Finite internal trial; no production subscribers' });
        atomic(root + '/test-delivery-config.json', { allowed_recipient: RECIPIENT }); store.checkpoint();
      }
      console.log(JSON.stringify({ status: 'initialized_without_enabling' }));
    } else if (operation === 'run') {
      try {
        reconcile(store); const plan = due(store); const maintenance = flags['maintenance-only'] !== 'false';
        const launch = flags.launch === 'true'; const verify = flags['verify-api'] === 'true';
        if (launch && verify) throw new Error('choose_one_acceptance_mode');
        console.log(JSON.stringify({ stage: 'due', maintenance, plan, engine: 'typescript' }));
        if (!maintenance && !launch && !verify && plan.compose) compose(store);
        if (!maintenance && !launch && !verify && plan.deliver) console.log(JSON.stringify({ stage: 'delivery', receipt: await deliver(store) }));
        if (plan.collect || maintenance || launch || verify) await collect(store, Number(flags['collect-workers'] ?? 4));
        if (!maintenance && launch) { await launchSample(store, flags['sample-revision']); console.log(JSON.stringify({ stage: 'launch_delivery', receipt: await deliver(store, true, new Date(), flags['sample-revision']) })); }
        else if (!maintenance && verify) console.log(JSON.stringify({ stage: 'api_verification', result: await verifyApi(store) }));
        else if (!maintenance && plan.enrich) console.log(JSON.stringify({ stage: 'enrichment', result: await enrich(store) }));
      } finally {
        reportTrial(store); store.archive(process.env.GITHUB_ACTIONS === 'true' ? day() : undefined);
        if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `archive_ready=true\nartifact_name=pool-evidence-${day()}-${process.env.GITHUB_RUN_ID}\n`);
        console.log(JSON.stringify({ stage: 'final', result: status(store) }));
      }
    } else {
      let result: any;
      switch (operation) {
        case 'collect': result = await collect(store, Number(flags['collect-workers'] ?? 4)); break;
        case 'assess': result = assess(store); break;
        case 'enrich': result = await enrich(store); break;
        case 'verify-api': result = await verifyApi(store); break;
        case 'launch-sample': case 'fresh-sample': result = await launchSample(store, flags['sample-revision']); break;
        case 'send-sample': result = await deliver(store, true, new Date(), flags['sample-revision']); break;
        case 'compose': result = compose(store); break;
        case 'deliver': result = await deliver(store); break;
        case 'reconcile': result = reconcile(store); break;
        case 'status': result = status(store); break;
        case 'report': result = reportTrial(store); break;
        case 'archive': result = { archive: store.archive(process.env.GITHUB_ACTIONS === 'true' ? day() : undefined) }; break;
        case 'ack-artifact': acknowledgeArtifact(store); result = { status: 'artifact_pointer_saved' }; break;
      }
      console.log(JSON.stringify(result));
    }
  }
} catch (error) {
  // Never print HTTP payloads, credentials, raw model text, or child command stderr.
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : 'engine_failed' })); process.exitCode = 1;
} finally { store?.db.close(); if (localLock) rmSync(localLock, { recursive: true }); }
