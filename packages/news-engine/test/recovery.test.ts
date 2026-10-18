import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as tar from 'tar';
import { Store, extractEvidence } from '../src/store.ts';
import { atomic, policy, digest, pyjson, EXPIRY, RECIPIENT, stamp, type Row } from '../src/core.ts';
import { paidRequest, cacheKey, gate, validate, verifyRules } from '../src/model.ts';
import { candidates, compose, due, reconcile, collect, assess, writingWindow, reportTrial, launchSample, attemptedVersions } from '../src/pool.ts';
import { preferences } from '../src/ranking.ts';
import { buildEmail, freezeIssue, sendOnce } from '../src/mail.ts';
import { mapLimit } from '../src/sources.ts';
import { article } from './fixtures.ts';

const domainTitles = ['AI模型发布', '开源编译器重大更新', 'NVIDIA 芯片发布', '火箭重大突破', '机器人重大升级'];
const text = '公司计划在中国测试这一人工智能模型，尚未独立验证。'.repeat(20);
const a = { ...article(), source_name: 'GitHub', url: 'https://example.org/test', text, description_clean: text, content_fingerprint: digest(text), fetched_at: '2026-10-18T04:30:00+08:00', original_article_published_at: '2026-10-18T04:00:00+08:00', output_schema: 'dual-1' };
const result = { title: '新模型测试', summary: '公司计划在中国测试这一人工智能模型。', short_summary: '公司测试模型，尚未独立验证。', points: [], why: '', uncertainties: [], claims: [{ claim: '模型测试', evidence: '公司计划在中国测试这一人工智能模型' }], generated_at: '2026-10-18T06:00:00+08:00' };
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
    assert.equal(store.one('SELECT status FROM jobs WHERE key=?', key)!.status, 'pending_human_review');
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
    assert.equal(candidates(store, stamp(now()))[1].at(-1)!.reason, 'update_delta_pending_review');
  } finally { close(); }
});
test('single recipient, frozen hashes, sending claim, duplicate attempt and QUIT error handling', async () => {
  const { store, root, close } = setup(); const before = { sender: process.env.SENDING_ACCOUNT, password: process.env.SENDING_PASSWORD, server: process.env.SERVER };
  process.env.SENDING_ACCOUNT = 'sender@example.org'; process.env.SENDING_PASSWORD = 'test'; process.env.SERVER = 'smtp.example.org'; let sent = 0;
  try {
    const issue = { id: 'sample-mail-unit', kind: 'newsletter', mode: 'current_24h_sample', pool_edition: true, collection_cutoff: stamp(now()), generation_cutoff: permit.expires_at, articles: [a], rejected: [], source_health: null };
    freezeIssue(store, issue, [{ article: a, result: structuredClone(result), calls: [] }]);
    const transport = { sendMail: async (message: Row) => { sent++; assert.equal(message.to, RECIPIENT); assert.deepEqual(message.envelope.to, [RECIPIENT]); assert.equal(message.cc, undefined); assert.equal(message.bcc, undefined);
      assert.equal(JSON.parse(readFileSync(root + '/durable/state.json', 'utf8')).schema_version, 1); assert.ok(existsSync(root + '/deliveries')); return { accepted: [RECIPIENT] }; }, close: () => { throw new Error('QUIT disconnected'); } };
    assert.equal((await sendOnce(store, issue.id, { transport, now })).status, 'smtp_accepted');
    assert.equal((await sendOnce(store, issue.id, { transport, now })).reused, true); assert.equal(sent, 1);
    atomic(root + '/test-delivery-config.json', { allowed_recipient: 'other@example.org' }); await assert.rejects(() => sendOnce(store, issue.id, { transport, now }), /recipient/);
    atomic(root + '/test-delivery-config.json', { allowed_recipient: RECIPIENT }); writeFileSync(root + '/issues/' + issue.id + '/email.txt', 'changed');
    await assert.rejects(() => sendOnce(store, issue.id, { transport, now }), /frozen_content_changed/);
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
    assert.equal((await sendOnce(store, issue.id, { transport, now })).status, 'unknown_do_not_retry');
    assert.equal((await sendOnce(store, issue.id, { transport, now })).reused, true); assert.equal(sent, 1);
  } finally { process.env = env; close(); }
});
test('SMTP rechecks the 07:00 cutoff after the durable sending claim', async () => {
  const { store, close } = setup(); const env = { ...process.env }; let current = new Date('2026-10-19T06:59:59+08:00'); let sent = 0;
  try {
    process.env.SENDING_ACCOUNT = 'sender@example.org'; process.env.SENDING_PASSWORD = 'test'; process.env.SERVER = 'smtp.example.org';
    const issue = { id: 'test-2026-10-19', kind: 'diagnostic', mode: 'daily_24h', pool_edition: true, collection_cutoff: '2026-10-19T06:00:00+08:00', generation_cutoff: '2026-10-19T06:15:00+08:00', articles: [], rejected: [], source_health: null };
    freezeIssue(store, issue, []); const checkpoint = store.checkpoint.bind(store);
    store.checkpoint = () => { checkpoint(); current = new Date('2026-10-19T07:00:00+08:00'); };
    const transport = { sendMail: async () => { sent++; return { accepted: [RECIPIENT] }; }, close: () => {} };
    assert.equal((await sendOnce(store, issue.id, { transport, now: () => current })).status, 'not_sent_outside_window'); assert.equal(sent, 0);
  } finally { process.env = env; close(); }
});
test('schedule honors Shanghai cutoffs, trial expiry, writing floor and no late deliveries', () => {
  const { store, close } = setup();
  try {
    assert.equal(due(store, new Date('2026-10-19T06:12:00+08:00')).enrich, false);
    const batchPermit = { mode: 'internal_test_anytime', issue_id: 'test-pool-2026-10-19', expires_at: '2026-10-19T06:15:00+08:00' };
    assert.equal(gate(policy(), new Date('2026-10-19T06:11:59+08:00'), true, batchPermit), null);
    assert.equal(gate(policy(), new Date('2026-10-19T06:12:00+08:00'), true, batchPermit), 'test_permit_expired');
    assert.equal(due(store, new Date('2026-10-19T06:15:00+08:00')).compose, true);
    assert.equal(due(store, new Date('2026-10-19T06:30:00+08:00')).deliver, true);
    assert.equal(due(store, new Date(EXPIRY)).enrich, false);
    assert.equal(compose(store, new Date('2026-10-19T06:14:59+08:00')).status, 'generation_deadline_not_reached');
    assert.equal(writingWindow(new Date('2026-10-19T00:01:00+08:00'))[1], '2026-10-18T06:00:00+08:00');
    assert.equal(reportTrial(store).days.length, 7);
  } finally { close(); }
});
test('collector maintenance performs GET only, isolates source errors and bounds concurrency', async () => {
  const { store, close } = setup(); let active = 0; let peak = 0;
  try {
    const fetcher = (async (_url: any, options: any) => { assert.notEqual(options?.method, 'POST'); active++; peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 2)); active--; throw new Error('network unavailable'); }) as typeof fetch;
    const report = await collect(store, 4, fetcher); assert.equal(report.sources.length, 16); assert.equal(report.sources.filter((s: Row) => s.ok).length, 0);
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
    for (const job of jobs) store.run("UPDATE jobs SET status='pending_human_review',result=? WHERE key=?", pyjson({ ...result, generated_at: '2026-10-19T06:10:00+08:00' }), job.key);
    const frozen = compose(store, new Date('2026-10-19T06:15:00+08:00'));
    assert.equal(frozen.kind, 'newsletter'); assert.equal(frozen.articles.length, 20);
    const html = readFileSync(root + '/issues/' + frozen.id + '/email.html', 'utf8');
    assert.equal((html.match(/今日重点<\/span>/g) ?? []).length, 1); assert.equal((html.match(/精编短讯<\/span>/g) ?? []).length, 1);
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
          const input = { ...a, id: `cached-${i}`, title: domainTitles[i % 5] + ' ' + unique, url: 'https://example.org/cached/' + i, text: text + unique, content_fingerprint: digest(text + unique) };
          const key = cacheKey(input, p); store.run('INSERT INTO articles VALUES (?,?,?)', input.id, 'version', pyjson(input));
          if (cached) store.run('INSERT INTO jobs(key,article,status,result) VALUES (?,?,?,?)', key, pyjson(input), 'pending_human_review', pyjson(result));
        }
        const prices = `<table><tr><th>模型</th><th>deepseek-flash</th><th>other</th></tr><tr><td>base</td></tr><tr><td>base</td></tr><tr><td>version</td><td>${p.model_version}</td></tr><tr><td>空闲时段</td><td>0.02元</td><td>1元</td></tr><tr><td>空闲时段</td><td>1元</td><td>2元</td></tr><tr><td>空闲时段</td><td>4元</td><td>8元</td></tr></table><p>北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。</p>`;
        const fetchMock = t.mock.method(globalThis, 'fetch', (async (_url: any, options: any) => {
          if (options?.method === 'POST') { posts++; return goodResponse(); } return new Response(prices);
        }) as typeof fetch);
        const issue = await launchSample(store, 'serif'); fetchMock.mock.restore();
        assert.equal(issue.articles.length, cached ? 20 : 1); assert.equal(posts, cached ? 0 : 1);
        assert.equal(attemptedVersions(store, '2026-10-18').size, 100);
        const html = readFileSync(store.root + '/issues/' + issue.id + '/email.html', 'utf8');
        if (cached) { assert.ok(html.includes('Songti SC')); assert.ok(html.includes('morning-4-pool-ts-serif')); }
      } finally { close(); }
    }
  } finally { if (originalToken === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = originalToken; t.mock.timers.reset(); }
});

test('pricing preflight failure leaves retry sample unfrozen and makes no paid request', async t => {
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
  } finally { close(); }
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
