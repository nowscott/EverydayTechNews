import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as tar from 'tar';
import { Store, extractEvidence } from '../src/store.ts';
import { atomic, policy, digest, pyjson, EXPIRY, RECIPIENT, stamp, type Row } from '../src/core.ts';
import { paidRequest, cacheKey, gate, validate, verifyRules } from '../src/model.ts';
import { candidates, compose, due, reconcile, collect, assess, writingWindow, reportTrial, launchSample, attemptedVersions, enrich, samplePath } from '../src/pool.ts';
import { preferences } from '../src/ranking.ts';
import { buildEmail, freezeIssue, sendOnce } from '../src/mail.ts';
import { mapLimit } from '../src/sources.ts';
import { ACTIVE_SOURCES } from '../src/constants.ts';
import { reviewDraft } from '../src/review.ts';
import { reviewKey, displayFields } from '../src/quality.ts';
import { article } from './fixtures.ts';

const domainTitles = ['AI模型发布', '开源编译器重大更新', 'NVIDIA 芯片发布', '火箭重大突破', '机器人重大升级'];
const text = '公司计划在中国测试这一人工智能模型，尚未独立验证。'.repeat(20);
const a: Row = { ...article(), source_name: 'GitHub', url: 'https://example.org/test', text, description_clean: text, content_fingerprint: digest(text), fetched_at: '2026-10-18T04:30:00+08:00', original_article_published_at: '2026-10-18T04:00:00+08:00', output_schema: 'dual-1' };
const result = { title: '新模型测试', summary: '公司计划在中国测试这一人工智能模型。', short_summary: '公司测试模型，尚未独立验证。', points: [], why: '', uncertainties: [], claims: [{ claim: '模型测试', evidence: '公司计划在中国测试这一人工智能模型' }], generated_at: '2026-10-18T06:00:00+08:00' };
function approved(input: Row, draft: Row = structuredClone(result)): Row {
  const copy = structuredClone(draft);
  copy.ai_review = { key: reviewKey(input, copy, policy()), reviewed_at: copy.generated_at, result: {
    verdict: 'pass', update_has_new_facts: false,
    checks: Object.entries(displayFields(copy)).map(([field, value]) => ({ field, pass: true, reason: 'synthetic supported field', evidence: value ? '公司计划在中国测试这一人工智能模型' : '' })) } };
  return copy;
}
const now = () => new Date('2026-10-18T12:00:00+08:00');
const permit = { mode: 'internal_test_anytime', issue_id: 'sample-ts-unit', expires_at: '2026-10-18T12:30:00+08:00' };
function setup() {
  const root = mkdtempSync(tmpdir() + '/ts-recovery-'); const store = new Store(root);
  atomic(root + '/trial.json', { schema_version: 1, mode: 'internal_test', enabled: true, start: '2026-10-19', days: 7, expires_at: EXPIRY, allowed_recipient: RECIPIENT, daily_budget_cny: 2, model_enabled: true, delivery_enabled: true, production_enabled: false });
  atomic(root + '/test-delivery-config.json', { allowed_recipient: RECIPIENT });
  const p = policy(); const key = cacheKey(a, p); store.run('INSERT INTO jobs(key,article,status) VALUES (?,?,?)', key, pyjson(a), 'queued');
  const close = () => { store.db.close(); rmSync(root, { recursive: true, force: true }); };
  return { root, store, p, key, close };
}
const goodResponse = () => new Response(JSON.stringify({ usage: { prompt_tokens: 1000, completion_tokens: 300, prompt_cache_hit_tokens: 100 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] }), { status: 200 });
test('paid call persists reservation before POST and reuses validated cache', async () => {
  const { store, p, key, close } = setup(); let calls = 0;
  try {
    const fetcher = (async () => {
      calls++; const snapshot = JSON.parse(readFileSync(store.root + '/durable/state.json', 'utf8'));
      assert.equal(snapshot.tables.calls[0].status, 'reserved'); assert.equal(snapshot.tables.jobs[0].status, 'inflight');
      return goodResponse();
    }) as typeof fetch;
    await paidRequest(store, key, a, p, permit, { now, fetcher, verify: async () => true, token: 'test-token' });
    assert.equal(store.one('SELECT status FROM jobs WHERE key=?', key)!.status, 'pending_ai_review');
    assert.equal(await paidRequest(store, key, a, p, permit, { now, fetcher }), 'cached'); assert.equal(calls, 1);
  } finally { close(); }
});
test('budget, price failure, expiry and persistence failure prevent POST', async () => {
  for (const failure of ['budget', 'rules', 'expiry', 'checkpoint']) {
    const { store, p, key, close } = setup(); let calls = 0;
    try {
      if (failure === 'budget') store.run('INSERT INTO calls(day,job,reserved,status) VALUES (?,?,?,?)', '2026-10-18', 'old-unknown', 2, 'reserved');
      if (failure === 'checkpoint') store.checkpoint = () => { throw new Error('push_failed'); };
      const fn = () => paidRequest(store, key, a, p, permit, { now: failure === 'expiry' ? () => new Date(EXPIRY) : now,
        fetcher: (async () => { calls++; return goodResponse(); }) as typeof fetch, verify: async () => failure !== 'rules', token: 'test' });
      if (failure === 'checkpoint') await assert.rejects(fn, /push_failed/); else assert.ok(await fn());
      assert.equal(calls, 0);
    } finally { close(); }
  }
});
test('time is rechecked after durable reservation', async () => {
  const { store, p, key, close } = setup(); let clock = now(); let calls = 0; const checkpoint = store.checkpoint.bind(store);
  try {
    store.checkpoint = () => { checkpoint(); clock = new Date('2026-10-18T12:28:00+08:00'); };
    assert.equal(await paidRequest(store, key, a, p, permit, { now: () => clock, verify: async () => true, token: 'test', fetcher: (async () => { calls++; return goodResponse(); }) as typeof fetch }), 'test_permit_expired');
    assert.equal(calls, 0); assert.equal(store.one('SELECT cost FROM calls')!.cost, 0);
  } finally { close(); }
});
test('midnight or tariff changes during reservation prevent POST under the old accounting period', async () => {
  for (const [start, end] of [['2026-10-18T23:59:59+08:00', '2026-10-19T00:00:00+08:00'], ['2026-10-19T08:59:59+08:00', '2026-10-19T09:00:00+08:00']]) {
    const { store, p, key, close } = setup(); let current = new Date(start); let calls = 0; const checkpoint = store.checkpoint.bind(store);
    try {
      store.checkpoint = () => { checkpoint(); current = new Date(end); };
      const permit = { mode: 'internal_test_anytime', issue_id: 'test-billing', expires_at: '2026-10-20T00:00:00+08:00' };
      assert.equal(await paidRequest(store, key, a, p, permit, { now: () => current, verify: async () => true, token: 'test', fetcher: (async () => { calls++; return goodResponse(); }) as typeof fetch }), 'billing_period_changed');
      assert.equal(calls, 0); assert.equal(store.one('SELECT cost FROM calls')!.cost, 0);
    } finally { close(); }
  }
});
test('timeouts, 429, invalid usage and interrupted calls cannot cause another paid call', async () => {
  for (const failure of ['timeout', '429', 'usage', 'interrupted']) {
    const { store, p, key, close } = setup(); let calls = 0;
    try {
      if (failure === 'interrupted') { store.run("UPDATE jobs SET status='inflight' WHERE key=?", key); store.run('INSERT INTO calls(day,job,reserved,status) VALUES (?,?,?,?)', '2026-10-18', key, .02, 'reserved'); reconcile(store); }
      const fetcher = (async () => { calls++; if (failure === 'timeout') throw new DOMException('timeout', 'TimeoutError');
        return failure === '429' ? new Response('{}', { status: 429 }) : new Response(JSON.stringify({ usage: {}, choices: [] })); }) as typeof fetch;
      const deps = { now, fetcher, verify: async () => true, token: 'test' };
      await paidRequest(store, key, a, p, permit, deps); const before = calls; const held = await paidRequest(store, key, a, p, permit, deps);
      assert.ok(held); assert.equal(calls, before); assert.ok(store.one('SELECT reserved FROM calls WHERE job=?', key));
    } finally { close(); }
  }
});
test('known-cost invalid output is retained for bounded repair, evidence failures never enter ready pool', async () => {
  const { store, p, key, close } = setup();
  try {
    const fetcher = (async () => new Response(JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 10 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...result, short_summary: '中'.repeat(81) }) } }] }))) as typeof fetch;
    await paidRequest(store, key, a, p, permit, { now, fetcher, verify: async () => true, token: 'test' });
    assert.equal(store.one('SELECT status FROM jobs')!.status, 'failed_validation_review'); assert.ok(store.one('SELECT cost FROM calls')!.cost > 0);
    assert.throws(() => validate({ ...result, claims: [{ claim: '编造', evidence: '这是一段原文中不存在的证据' }] }, a));
  } finally { close(); }
});
test('archive integrity, expiry and unsafe extraction fail closed', () => {
  const { store, root, close } = setup();
  try {
    const ref = 'bodies/test.json'; store.putBulk(ref, Buffer.from(pyjson({ text, description_clean: text })));
    const expanded = store.expand({ _body_ref: ref }); assert.equal(expanded.text, text);
    writeFileSync(root + '/transient/' + ref, 'tampered'); assert.throws(() => store.expand({ _body_ref: ref }), /integrity/);
    store.objects[ref].expires_at = '2020-01-01T00:00:00Z'; assert.equal(store.expand({ _body_ref: ref }).evidence_expired_or_missing, true);
    mkdirSync(root + '/bad', { recursive: true }); writeFileSync(root + '/bad/payload.txt', 'bad');
    tar.c({ file: root + '/bad.tar.gz', cwd: root, sync: true, gzip: true }, ['bad']);
    assert.throws(() => extractEvidence(root, root + '/bad.tar.gz'), /unsafe_archive/);
  } finally { close(); }
});
test('dedupe history and missing update approvals block unchanged and unreviewed reuse', () => {
  const { store, root, close } = setup();
  try {
    const old = { ...a }; atomic(root + '/issues/old/edition.json', { articles: [old] }); atomic(root + '/deliveries/old.json', { issue: 'old', recipient: RECIPIENT, status: 'smtp_accepted' });
    store.run('INSERT INTO articles VALUES (?,?,?)', a.id, 'v1', pyjson(a));
    const [chosen, rejected] = candidates(store, stamp(now())); assert.equal(chosen.length, 0); assert.equal(rejected[0].reason, 'already_sent_unchanged');
    atomic(root + '/issues/old/edition.json', { kind: 'diagnostic', articles: [old] });
    const [retained] = candidates(store, stamp(now())); assert.equal(retained.length, 1);
    atomic(root + '/issues/old/edition.json', { kind: 'newsletter', articles: [old] });
    const updated = { ...a, content_fingerprint: digest(text + '更新'), text: text + '更新' };
    store.run('DELETE FROM articles'); store.run('INSERT INTO articles VALUES (?,?,?)', a.id, 'v2', pyjson(updated));
    assert.equal(candidates(store, stamp(now()))[1].at(-1)!.reason, 'update_prior_evidence_missing');
  } finally { close(); }
});
test('single recipient, frozen hashes, sending claim, duplicate attempt and QUIT error handling', async () => {
  const { store, root, close } = setup(); const before = { sender: process.env.SENDING_ACCOUNT, password: process.env.SENDING_PASSWORD, server: process.env.SERVER };
  process.env.SENDING_ACCOUNT = 'sender@example.org'; process.env.SENDING_PASSWORD = 'test'; process.env.SERVER = 'smtp.example.org'; let sent = 0;
  try {
    a.job_key = cacheKey(a, policy()); store.run("UPDATE jobs SET result=?,status='ai_approved' WHERE key=?", pyjson(approved(a)), a.job_key);
    const issue = { quality_policy: 'fidelity-1', id: 'sample-mail-unit', kind: 'newsletter', mode: 'current_24h_sample', pool_edition: true, collection_cutoff: stamp(now()), generation_cutoff: permit.expires_at, articles: [a], rejected: [], source_health: null };
    freezeIssue(store, issue, [{ article: a, result: approved(a), calls: [] }]);
    const transport = { sendMail: async (message: Row) => { sent++; assert.equal(message.to, RECIPIENT); assert.deepEqual(message.envelope.to, [RECIPIENT]); assert.equal(message.cc, undefined); assert.equal(message.bcc, undefined);
      assert.equal(JSON.parse(readFileSync(root + '/durable/state.json', 'utf8')).schema_version, 1); assert.ok(existsSync(root + '/deliveries')); return { accepted: [RECIPIENT] }; }, close: () => { throw new Error('QUIT disconnected'); } };
    assert.equal((await sendOnce(store, issue.id, { transport, now, authorize: async () => true })).status, 'smtp_accepted');
    assert.equal((await sendOnce(store, issue.id, { transport, now, authorize: async () => true })).reused, true); assert.equal(sent, 1);
    atomic(root + '/test-delivery-config.json', { allowed_recipient: 'other@example.org' }); await assert.rejects(() => sendOnce(store, issue.id, { transport, now, authorize: async () => true }), /recipient/);
    atomic(root + '/test-delivery-config.json', { allowed_recipient: RECIPIENT }); writeFileSync(root + '/issues/' + issue.id + '/email.txt', 'changed');
    await assert.rejects(() => sendOnce(store, issue.id, { transport, now, authorize: async () => true }), /frozen_content_changed/);
  } finally {
    for (const [key, value] of [['SENDING_ACCOUNT', before.sender], ['SENDING_PASSWORD', before.password], ['SERVER', before.server]]) { if (value === undefined) delete process.env[key!]; else process.env[key!] = value; } close();
  }
});
test('unknown SMTP result persists and is never automatically resent', async () => {
  const { store, close } = setup(); const env = { ...process.env }; let sent = 0;
  try {
    process.env.SENDING_ACCOUNT = 'sender@example.org'; process.env.SENDING_PASSWORD = 'test'; process.env.SERVER = 'smtp.example.org';
    const issue = { id: 'sample-mail-unknown', kind: 'diagnostic', mode: 'current_24h_sample', pool_edition: true, collection_cutoff: stamp(now()), generation_cutoff: permit.expires_at, articles: [], rejected: [], source_health: null };
    freezeIssue(store, issue, []);
    const transport = { sendMail: async () => { sent++; throw Object.assign(new Error('disconnected'), { command: 'DATA' }); }, close: () => {} };
    assert.equal((await sendOnce(store, issue.id, { transport, now, authorize: async () => true })).status, 'unknown_do_not_retry');
    assert.equal((await sendOnce(store, issue.id, { transport, now, authorize: async () => true })).reused, true); assert.equal(sent, 1);
  } finally { process.env = env; close(); }
});
test('SMTP rechecks the 09:00 cutoff after the durable sending claim', async () => {
  const { store, close } = setup(); const env = { ...process.env }; let current = new Date('2026-10-19T08:59:59+08:00'); let sent = 0;
  try {
    process.env.SENDING_ACCOUNT = 'sender@example.org'; process.env.SENDING_PASSWORD = 'test'; process.env.SERVER = 'smtp.example.org';
    const issue = { id: 'test-2026-10-19', kind: 'diagnostic', mode: 'daily_24h', pool_edition: true, collection_cutoff: '2026-10-19T06:00:00+08:00', generation_cutoff: '2026-10-19T06:15:00+08:00', articles: [], rejected: [], source_health: null };
    freezeIssue(store, issue, []); const checkpoint = store.checkpoint.bind(store);
    store.checkpoint = () => { checkpoint(); current = new Date('2026-10-19T09:00:00+08:00'); };
    const transport = { sendMail: async () => { sent++; return { accepted: [RECIPIENT] }; }, close: () => {} };
    assert.equal((await sendOnce(store, issue.id, { transport, now: () => current, authorize: async () => true })).status, 'not_sent_outside_window'); assert.equal(sent, 0);
  } finally { process.env = env; close(); }
});
test('schedule honors Shanghai cutoffs, trial expiry, writing floor and no late deliveries', () => {
  const { store, close } = setup();
  try {
    assert.equal(due(store, new Date('2026-10-19T06:12:00+08:00')).enrich, false);
    const batchPermit = { mode: 'internal_test_anytime', issue_id: 'test-pool-2026-10-19', expires_at: '2026-10-19T06:15:00+08:00' };
    assert.equal(gate(policy(), new Date('2026-10-19T06:11:59+08:00'), true), null);
    assert.equal(gate(policy(), new Date('2026-10-19T06:11:59+08:00'), true, batchPermit), 'scheduled_job_cannot_use_anytime_permit');
    assert.equal(gate(policy(), new Date('2026-10-19T06:12:00+08:00'), true), 'outside_window_or_margin');
    assert.equal(due(store, new Date('2026-10-19T06:15:00+08:00')).compose, true);
    assert.equal(due(store, new Date('2026-10-19T06:30:00+08:00')).deliver, true);
    assert.equal(due(store, new Date(EXPIRY)).enrich, false);
    assert.equal(compose(store, new Date('2026-10-19T06:14:59+08:00')).status, 'generation_deadline_not_reached');
    assert.equal(writingWindow(new Date('2026-10-19T00:01:00+08:00'))[1], '2026-10-18T00:01:00+08:00');
    assert.equal(reportTrial(store).days.length, 7);
  } finally { close(); }
});
test('collector maintenance performs GET only, isolates source errors and bounds concurrency', async () => {
  const { store, close } = setup(); let active = 0; let peak = 0;
  try {
    const fetcher = (async (_url: any, options: any) => { assert.notEqual(options?.method, 'POST'); active++; peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 2)); active--; throw new Error('network unavailable'); }) as typeof fetch;
    const report = await collect(store, 4, fetcher); assert.equal(report.sources.length, ACTIVE_SOURCES.length); assert.equal(report.sources.filter((s: Row) => s.ok).length, 0);
    assert.ok(peak <= 4 && peak > 1); assert.equal(store.one('SELECT COUNT(*) n FROM calls')!.n, 0);
    await assert.rejects(() => collect(store, 5, fetcher));
  } finally { close(); }
});
test('offline end-to-end collection, assessment, cached composition and frozen archive', async () => {
  const { store, root, close } = setup();
  try {
    const fetcher = (async (url: any, options: any) => {
      assert.notEqual(options?.method, 'POST'); const host = new URL(String(url)).hostname;
      // One valid source with 20 unrelated synthetic stories; all other sources fail independently.
      if (host !== 'www.ithome.com') return new Response('', { status: 503 });
      const entries = Array.from({ length: 20 }, (_, i) => {
        const unique = Array.from({ length: 30 }, (_, j) => String.fromCodePoint(0x4e00 + i * 31 + j)).join('');
        return `<item><title>${domainTitles[i % 5]} ${unique}</title><link>https://www.ithome.com/${i}</link><pubDate>Mon, 19 Oct 2026 04:00:00 +0800</pubDate><description><![CDATA[${text + unique}]]></description></item>`;
      }).join('');
      return new Response(`<rss><channel>${entries}</channel></rss>`, { status: 200 });
    }) as typeof fetch;
    const health = await collect(store, 4, fetcher); assert.equal(health.sources.filter((s: Row) => s.ok).length, 1);
    assert.equal(store.one('SELECT COUNT(*) n FROM articles')!.n, 20);
    // Fix observation time independently of the calendar date on the CI host.
    for (const row of store.all('SELECT id,fingerprint,data FROM articles')) {
      const record = JSON.parse(row.data); record.fetched_at = '2026-10-19T05:59:00+08:00';
      store.run('UPDATE articles SET data=? WHERE id=? AND fingerprint=?', pyjson(record), row.id, row.fingerprint);
    }
    store.run('UPDATE observations SET observed_at=?', '2026-10-19T05:59:00+08:00');
    assess(store, new Date('2026-10-19T05:59:00+08:00'));
    const jobs = store.all('SELECT * FROM jobs WHERE key<>?', cacheKey(a, policy())); assert.equal(jobs.length, 20);
    for (const job of jobs) store.run("UPDATE jobs SET status='pending_human_review',result=? WHERE key=?", pyjson(approved(JSON.parse(job.article), { ...result, generated_at: '2026-10-19T06:10:00+08:00' })), job.key);
    const frozen = compose(store, new Date('2026-10-19T06:15:00+08:00'));
    assert.equal(frozen.kind, 'diagnostic'); assert.equal(frozen.articles.length, 0);
    assert.ok(frozen.rejected.some((r: Row) => r.reason === 'edition_review_not_ready'));
    const html = readFileSync(root + '/issues/' + frozen.id + '/email.html', 'utf8');
    assert.ok(html.includes('诊断')); assert.equal((html.match(/精编短讯<\/span>/g) ?? []).length, 0);
    assert.ok(!html.includes(text)); assert.equal(store.one('SELECT COUNT(*) n FROM calls')!.n, 0);
    const firstHash = frozen.html_sha256; assert.equal(compose(store, new Date('2026-10-19T06:20:00+08:00')).html_sha256, firstHash);
    const archive = store.archive(); assert.ok(existsSync(archive));
    const target = root + '/restored'; mkdirSync(target); extractEvidence(target, archive);
    assert.ok(existsSync(target + '/transient/reviews/' + frozen.id + '/comparison-full.json'));
  } finally { close(); }
});
test('official price parser handles header footnotes and rejects changed rules or prices', async () => {
  const p = policy();
  const html = `<table><tr><th>模型</th><th>deepseek-flash<sup>(1)</sup></th><th>other</th></tr><tr><td>base</td></tr><tr><td>base2</td></tr><tr><td>模型版本</td><td>${p.model_version}</td><td>other</td></tr><tr><td>空闲时段</td><td>0.02元</td><td>1元</td></tr><tr><td>空闲时段</td><td>1元</td><td>2元</td></tr><tr><td>空闲时段</td><td>4元</td><td>8元</td></tr></table><p>北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。</p>`;
  const fake = (body: string) => (async () => new Response(body)) as typeof fetch;
  assert.equal(await verifyRules(p, fake(html)), true);
  assert.equal(await verifyRules(p, fake(html.replace('0.02元', '0.03元'))), false);
  assert.equal(await verifyRules(p, fake(html.replace('9:00', '8:00'))), false);
});
test('known-cost repairs stop at the shared three-attempt limit', async () => {
  const { store, p, key, close } = setup(); let count = 0;
  try {
    const fetcher = (async () => { count++; return new Response(JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 10 }, choices: [{ finish_reason: 'stop', message: { content: '{}' } }] })); }) as typeof fetch;
    for (let i = 0; i < 3; i++) { store.run("UPDATE jobs SET status='queued' WHERE key=?", key); await paidRequest(store, key, a, p, permit, { now, verify: async () => true, fetcher, token: 'test' }); }
    store.run("UPDATE jobs SET status='queued' WHERE key=?", key);
    assert.equal(await paidRequest(store, key, a, p, permit, { now, verify: async () => true, fetcher, token: 'test' }), 'attempt_limit'); assert.equal(count, 3);
  } finally { close(); }
});
test('100-version limit allows cached pool reuse and admits only remaining new versions', async t => {
  assert.equal(preferences().new_versions_per_day, 100);
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-18T12:00:00+08:00').getTime() });
  const originalToken = process.env.DEEPSEEK_API_KEY; process.env.DEEPSEEK_API_KEY = 'test-token';
  try {
    for (const cached of [true, false]) {
      const { store, p, close } = setup(); let posts = 0;
      try {
        store.syncGit = true; store.push = () => {}; // Offline fixture: checkpoints stay on disk, never touch GitHub.
        const previous = cached ? 100 : 99;
        for (let i = 0; i < previous; i++) {
          store.run('INSERT INTO jobs(key,article,status) VALUES (?,?,?)', 'prior-' + i, pyjson({ output_schema: 'dual-1' }), 'pending_human_review');
          store.run('INSERT INTO calls(day,job,reserved,cost,status) VALUES (?,?,?,?,?)', '2026-10-18', 'prior-' + i, .001, .001, 'response_received');
        }
        for (let i = 0; i < 20; i++) {
          const unique = Array.from({ length: 30 }, (_, j) => String.fromCodePoint(0x4e00 + i * 31 + j)).join('');
          const input = { ...a, id: `cached-${i}`, title: domainTitles[i % 5] + ' ' + unique, url: `https://publisher-${i % 7}.example/cached/${i}`, text: text + unique, content_fingerprint: digest(text + unique) };
          const key = cacheKey(input, p); store.run('INSERT INTO articles VALUES (?,?,?)', input.id, 'version', pyjson(input));
          if (cached) store.run('INSERT INTO jobs(key,article,status,result) VALUES (?,?,?,?)', key, pyjson(input), 'ai_approved', pyjson(approved(input)));
        }
        const prices = `<table><tr><th>模型</th><th>deepseek-flash</th><th>other</th></tr><tr><td>base</td></tr><tr><td>base</td></tr><tr><td>version</td><td>${p.model_version}</td></tr><tr><td>空闲时段</td><td>0.02元</td><td>1元</td></tr><tr><td>空闲时段</td><td>1元</td><td>2元</td></tr><tr><td>空闲时段</td><td>4元</td><td>8元</td></tr></table><p>北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。</p>`;
        const fetchMock = t.mock.method(globalThis, 'fetch', (async (_url: any, options: any) => {
          if (options?.method === 'POST') {
            posts++; const request = JSON.parse(options.body); const evidence = JSON.parse(request.messages[1].content);
            if (evidence.articles) return Response.json({ usage: { prompt_tokens: 100, completion_tokens: 100 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ checked_ids: evidence.articles.map((a: Row) => a.id), exclusions: [] }) } }] });
            if (evidence.draft) return new Response(JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 100 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(approved({ ...a, text: evidence.text }, evidence.draft).ai_review.result) } }] }));
            return goodResponse();
          } return new Response(prices);
        }) as typeof fetch);
        const issue = await launchSample(store, 'serif'); fetchMock.mock.restore();
        assert.equal(issue.articles.length, cached ? 20 : 0); assert.equal(posts, cached ? 1 : 2);
        assert.equal(attemptedVersions(store, '2026-10-18').size, 100);
        const html = readFileSync(store.root + '/issues/' + issue.id + '/email.html', 'utf8');
        if (cached) { assert.ok(html.includes('Songti SC')); assert.ok(html.includes('morning-4-pool-ts-serif')); }
      } finally { close(); }
    }
  } finally { if (originalToken === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = originalToken; t.mock.timers.reset(); }
});

test('publisher capacity blocks additional paid work before pricing or model requests', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-19T05:10:00+08:00') });
  const { store, p, close } = setup(); let requests = 0;
  try {
    store.syncGit = true; store.push = () => {};
    for (let i = 0; i < 9; i++) {
      const unique = Array.from({ length: 30 }, (_, j) => String.fromCodePoint(0x5000 + i * 31 + j)).join('');
      const input = { ...a, id: `publisher-${i}`, source: 'ithome', title: domainTitles[i % domainTitles.length] + unique,
        url: `https://www.ithome.com/news/${i}`, text: text + unique, content_fingerprint: digest(text + unique),
        published_at: '2026-10-19T04:00:00+08:00', original_article_published_at: '2026-10-19T04:00:00+08:00', fetched_at: '2026-10-19T04:30:00+08:00' };
      const key = cacheKey(input, p);
      store.run('INSERT INTO articles VALUES (?,?,?)', input.id, 'version', pyjson(input));
      store.run('INSERT INTO jobs(key,article,status,result) VALUES (?,?,?,?)', key, pyjson(input), i < 8 ? 'ai_approved' : 'queued',
        i < 8 ? pyjson(approved(input, { ...result, generated_at: '2026-10-19T05:01:00+08:00' })) : null);
    }
    const mocked = t.mock.method(globalThis, 'fetch', (async () => { requests++; throw new Error('unexpected_request'); }) as typeof fetch);
    const outcome = await enrich(store); mocked.mock.restore();
    assert.equal(outcome.calls, 0); assert.equal(requests, 0);
  } finally { close(); t.mock.timers.reset(); }
});

test('enrich prioritizes current selection over stale queued scores', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-19T05:10:00+08:00') });
  const { store, p, close } = setup();
  try {
    store.syncGit = true; store.push = () => {};
    const base = { ...a, source:'macrumors', published_at:'2026-10-19T04:00:00+08:00',
      original_article_published_at:'2026-10-19T04:00:00+08:00', fetched_at:'2026-10-19T04:30:00+08:00' };
    const launch = { ...base, id:'launch', url:'https://www.macrumors.com/launch',
      title:'Apple Announces New iPad Mini With OLED Display', content_fingerprint:digest(text+'launch'), ranking:{score:70} };
    const color = { ...base, id:'color', url:'https://www.macrumors.com/color',
      title:'New iPad Mini Available in Just Two Colors', content_fingerprint:digest(text+'color'), ranking:{score:99} };
    for (const item of [launch, color]) {
      store.run('INSERT INTO articles VALUES (?,?,?)', item.id, item.content_fingerprint, pyjson(item));
      store.run('INSERT INTO jobs(key,article,status) VALUES (?,?,?)', cacheKey(item,p), pyjson(item), 'queued');
    }
    t.mock.method(globalThis, 'fetch', (async () => { throw new Error('pricing unavailable'); }) as typeof fetch);
    const outcome = await enrich(store);
    assert.equal(outcome.jobs?.[0]?.job, cacheKey(launch,p));
    assert.equal(outcome.jobs?.[0]?.status, 'official_rules_unconfirmed');
    assert.equal(outcome.calls, 0);
  } finally { close(); t.mock.timers.reset(); }
});

test('pricing preflight failure leaves retry sample unfrozen and makes no paid request', async t => {
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-18T12:00:00+08:00')});
  const { store, close } = setup(); let posts = 0;
  try {
    store.syncGit = true; store.push = () => {};
    t.mock.method(globalThis, 'fetch', (async (_url: any, options: any) => {
      if (options?.method === 'POST') posts++;
      return new Response('temporarily unavailable', { status: 503 });
    }) as typeof fetch);
    const blocked = await launchSample(store, 'serif-retry');
    assert.equal(blocked.status, 'official_rules_unconfirmed');
    assert.equal(blocked.pricing.reason, 'http_error');
    assert.equal(blocked.pricing.http_status, 503);
    assert.equal(posts, 0);
    assert.equal(existsSync(store.root + '/durable/ts-launch-serif-retry.json'), false);
    assert.equal(existsSync(store.root + '/issues/sample-ts-serif-retry-2026-10-18/edition.json'), false);
  } finally { close();t.mock.timers.reset(); }
});

test('shared title exclusions stop legacy queued articles before pricing and paid POST', async () => {
  const { store, p, close } = setup(); let network = 0;
  try {
    for (const title of ['华为发布新模型', '新款手机 3999 元']) {
      const blockedArticle = { ...a, title }; const key = cacheKey(blockedArticle, p);
      store.run('INSERT INTO jobs(key,article,status) VALUES (?,?,?)', key, pyjson(blockedArticle), 'queued');
      const result = await paidRequest(store, key, blockedArticle, p, permit, { now, verify: async () => { network++; return true; }, fetcher: (async () => { network++; return goodResponse(); }) as typeof fetch, token: 'test' });
      assert.equal(result, title.startsWith('华为') ? 'shared_filter_keyword' : 'shared_filter_price');
    }
    assert.equal(network, 0); assert.equal(store.one('SELECT COUNT(*) n FROM calls')!.n, 0);
  } finally { close(); }
});

test('scheduled writer never calls pricing or model outside 0500-0612 even when invoked directly', async t => {
  const { store, close } = setup(); let requests = 0;
  try {
    t.mock.method(globalThis, 'fetch', (async () => { requests++; throw new Error('network must not run'); }) as typeof fetch);
    for (const time of ['00:36:00', '04:59:59', '06:12:00', '07:06:52', '09:10:00', '23:00:00']) {
      const now = new Date('2026-10-19T' + time + '+08:00'); t.mock.timers.enable({ apis: ['Date'], now: now.getTime() });
      assert.equal(due(store, now).enrich, false, time);
      assert.equal((await enrich(store)).status, 'outside_window_or_margin', time);
      t.mock.timers.reset();
    }
    assert.equal(requests, 0); assert.equal(store.one('SELECT COUNT(*) n FROM calls')!.n, 0);
    assert.equal(due(store, new Date('2026-10-19T05:00:00+08:00')).enrich, true);
  } finally { t.mock.timers.reset(); close(); }
});
test('a late cron may freeze evidence but never requests a late SMTP send; report preserves missed delivery', () => {
  const { store, close } = setup();
  try {
    const late = new Date('2026-10-19T09:06:00+08:00'); const plan = due(store, late);
    assert.equal(plan.compose, true); assert.equal(plan.deliver, false); assert.equal(plan.enrich, false);
    const issue = compose(store, late); assert.equal(issue.id, 'test-2026-10-19');
    const report = reportTrial(store, late); const today = report.days.find(d => d.day === '2026-10-19')!;
    assert.equal(today.reason, 'scheduler_missed_delivery_deadline'); assert.deepEqual(today.delivery, []);
    assert.equal(report.completed_normal_editions, 0);
  } finally { close(); }
});

test('rolling 24h pool includes the whole preceding day without an early next-issue floor', () => {
  const { store, close } = setup();
  try {
    const cutoff = '2026-10-19T06:20:00+08:00';
    const input: Row = { ...a, published_at: '2026-10-18T06:20:00+08:00', original_article_published_at: '2026-10-18T06:20:00+08:00', fetched_at: '2026-10-19T06:19:00+08:00' };
    store.run('INSERT INTO articles VALUES (?,?,?)', input.id, 'v1', pyjson(input));
    assert.equal(candidates(store, cutoff)[0].length, 1);
    assert.equal(candidates(store, '2026-10-19T06:20:01+08:00')[1].at(-1)?.reason, 'old_news');
    assert.equal(writingWindow(new Date('2026-10-19T00:01:00+08:00'))[1], '2026-10-18T00:01:00+08:00');
  } finally { close(); }
});
test('previous-day samples are reusable, but same-day samples and ordinary issues retain sent dedupe', () => {
  const { store, root, close } = setup();
  try {
    const input: Row = { ...a, published_at: '2026-10-18T12:00:00+08:00', original_article_published_at: '2026-10-18T12:00:00+08:00', fetched_at: '2026-10-18T13:00:00+08:00' };
    store.run('INSERT INTO articles VALUES (?,?,?)', input.id, 'v1', pyjson(input));
    const prior = 'sample-authorized-reuse';
    atomic(root + '/issues/' + prior + '/edition.json', { kind: 'newsletter', collection_cutoff: '2026-10-18T19:00:00+08:00', articles: [input] });
    atomic(root + '/deliveries/reuse.json', { issue: prior, recipient: RECIPIENT, status: 'smtp_accepted' });
    assert.equal(candidates(store, '2026-10-19T06:20:00+08:00')[0].length, 1);
    assert.equal(candidates(store, '2026-10-18T20:00:00+08:00')[1][0].reason, 'already_sent_unchanged');
    atomic(root + '/issues/test-2026-10-18/edition.json', { kind: 'newsletter', collection_cutoff: '2026-10-18T19:00:00+08:00', articles: [input] });
    atomic(root + '/deliveries/ordinary.json', { issue: 'test-2026-10-18', recipient: RECIPIENT, status: 'smtp_accepted' });
    assert.equal(candidates(store, '2026-10-19T06:20:00+08:00')[1][0].reason, 'already_sent_unchanged');
  } finally { close(); }
});


test('manual makeup has its own daily identity and leaves the scheduled issue intact', () => {
  const { store, root, close } = setup();
  try {
    atomic(root + '/issues/test-2026-10-19/edition.json', { kind: 'diagnostic', articles: [] });
    atomic(root + '/deliveries/makeup.json', { issue: 'sample-ts-makeup-2026-10-19', recipient: RECIPIENT, status: 'smtp_accepted' });
    const report = reportTrial(store, new Date('2026-10-19T12:00:00+08:00'));
    assert.equal(report.days[0].reason, 'scheduler_missed_delivery_deadline');
    assert.deepEqual(report.days[0].manual_makeup_delivery, ['smtp_accepted']);
    assert.equal(report.completed_normal_editions, 0);
    assert.match(samplePath(root, 'makeup'), /ts-launch-makeup-\d{4}-\d{2}-\d{2}\.json$/);
    assert.notEqual(samplePath(root, 'makeup'), samplePath(root, 'serif'));
    const [html, plain] = buildEmail({ collection_cutoff: '2026-10-19T12:00:00+08:00', mode: 'manual_makeup_24h' }, []);
    assert.ok(html.includes('今日补发')); assert.ok(plain.includes('人工授权补发'));
  } finally { close(); }
});

test('legacy human-review drafts migrate durably to automatic review without approving them', () => {
  const { store, root, key, close } = setup();
  try {
    store.run("UPDATE jobs SET status='pending_human_review',result=? WHERE key=?", pyjson(result), key);
    store.run("INSERT INTO jobs(key,article,status) VALUES (?,?,?)", 'empty-legacy', pyjson(a), 'pending_human_review');
    store.checkpoint();
    store.restore();
    assert.equal(store.one('SELECT status FROM jobs WHERE key=?', key)!.status, 'pending_ai_review');
    assert.deepEqual(JSON.parse(store.one('SELECT result FROM jobs WHERE key=?', key)!.result), result);
    assert.equal(store.one("SELECT status FROM jobs WHERE key='empty-legacy'")!.status, 'queued');
    assert.equal(store.one('SELECT COUNT(*) n FROM calls')!.n, 0);
    const saved = JSON.parse(readFileSync(root + '/durable/state.json', 'utf8'));
    assert.equal(saved.tables.jobs.some((j: Row) => j.status === 'pending_human_review'), false);
    store.restore();
    assert.equal(store.one('SELECT status FROM jobs WHERE key=?', key)!.status, 'pending_ai_review');
  } finally { close(); }
});

 test('invalid cached drafts are automatically discarded without a model call', async () => {
  const { store, p, key, close } = setup();
  try {
    store.run("UPDATE jobs SET result=?,status='pending_ai_review' WHERE key=?", pyjson({ ...result, claims: [] }), key);
    const job = store.one('SELECT * FROM jobs WHERE key=?', key)!;
    assert.equal(await reviewDraft(store, job, a, p), 'invalid_cached_draft');
    assert.equal(store.one('SELECT status FROM jobs WHERE key=?', key)!.status, 'discarded_invalid_draft');
    assert.equal(store.one('SELECT COUNT(*) n FROM calls')!.n, 0);
  } finally { close(); }
});

test('Notion audience uses private independent receipts and never repeats uncertain SMTP', async () => {
  const { store, root, close } = setup(); const saved = { ...process.env };
  Object.assign(process.env, { SENDING_ACCOUNT: 'sender@example.org', SENDING_PASSWORD: 'test', SERVER: 'smtp.example.org' });
  const sent: string[] = []; const second = 'second@example.org';
  try {
    const issue = { id: 'sample-audience-unit', kind: 'diagnostic', collection_cutoff: stamp(now()), generation_cutoff: permit.expires_at, articles: [], rejected: [], source_health: null };
    freezeIssue(store, issue, []);
    const deps = { now, subscribers: async () => [RECIPIENT, second, second], transport: {
      sendMail: async (m: Row) => { sent.push(m.to); assert.deepEqual(m.envelope.to, [m.to]); assert.equal(m.cc, undefined); assert.equal(m.bcc, undefined);
        if (m.to === second) throw { command: 'DATA' }; return { accepted: [m.to] }; }, close() {} } };
    const first = await sendOnce(store, issue.id, deps);
    assert.equal(first.status, 'partial_delivery');
    assert.deepEqual(first.deliveries.map((r: Row) => r.status), ['smtp_accepted', 'unknown_do_not_retry']);
    const again = await sendOnce(store, issue.id, deps);
    assert.ok(again.deliveries.every((r: Row) => r.reused)); assert.deepEqual(sent, [RECIPIENT, second]);
    await assert.rejects(() => sendOnce(store, issue.id, { ...deps, subscribers: async () => { throw Error('notion_http_503'); } }), /notion_http_503/);
    assert.deepEqual(sent, [RECIPIENT, second]);
    await sendOnce(store, issue.id, { ...deps, subscribers: async () => [RECIPIENT, 'third@example.org'] });
    assert.deepEqual(sent, [RECIPIENT, second, 'third@example.org']);
  } finally { process.env = saved; close(); }
});

test('scheduled writer uses the configured continuous deadline after the legacy expiry, while fixed expiry and window remain enforced',async t=>{
 const {store,root,close}=setup();
 try{
  store.syncGit=true;store.push=()=>{};
  const clock=new Date('2026-10-26T05:10:00+08:00');t.mock.timers.enable({apis:['Date'],now:clock});
  const continuous={...JSON.parse(readFileSync(root+'/trial.json','utf8')),testing_period:'continuous',days:null,expires_at:null};atomic(root+'/trial.json',continuous);
  const fresh:Row={...a,id:'continuous-writer',fetched_at:'2026-10-26T04:50:00+08:00',published_at:'2026-10-26T04:00:00+08:00',original_article_published_at:'2026-10-26T04:00:00+08:00'};
  store.run('INSERT INTO articles VALUES (?,?,?)',fresh.id,fresh.content_fingerprint,pyjson(fresh));assess(store,clock);
  let gets=0,posts=0;t.mock.method(globalThis,'fetch',(async(_u:any,options:any)=>{if(options?.method==='POST')posts++;else gets++;return new Response('pricing unavailable',{status:503});}) as typeof fetch);
  const permitted=await enrich(store);assert.equal(permitted.status,'processed_or_pending');assert.equal(permitted.jobs?.[0]?.status,'official_rules_unconfirmed');assert.equal(gets,1);assert.equal(posts,0);
  t.mock.timers.setTime(new Date('2026-10-26T06:14:00+08:00').getTime());assert.equal((await enrich(store)).status,'outside_window_or_margin');assert.equal(gets,1);
  atomic(root+'/trial.json',{...continuous,testing_period:'bounded',days:7,expires_at:EXPIRY});
  t.mock.timers.setTime(clock.getTime());assert.equal((await enrich(store)).status,'trial_or_model_disabled_or_expired');assert.equal(gets,1);assert.equal(posts,0);
 }finally{close();t.mock.timers.reset();}
});
