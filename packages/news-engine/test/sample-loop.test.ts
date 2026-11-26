import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.ts';
import { atomic, digest, pyjson, policy, stamp, RECIPIENT, type Row } from '../src/core.ts';
import { cacheKey } from '../src/model.ts';
import { launchSample, samplePath } from '../src/pool.ts';

const text = '公司计划在中国测试这一人工智能模型，尚未独立验证。'.repeat(20);

function setup() {
  const root = mkdtempSync(tmpdir() + '/sample-loop-');
  atomic(root + '/trial.json', { schema_version: 1, mode: 'internal_test', testing_period: 'continuous', enabled: true, model_enabled: true, delivery_enabled: true, production_enabled: false, start: '2026-10-19', days: null, expires_at: null, allowed_recipient: RECIPIENT, daily_budget_cny: 2 });
  atomic(root + '/test-delivery-config.json', { allowed_recipient: RECIPIENT });
  // 权威账本前提：私有交接标记 + 已存在的主状态快照，模拟 NAS 接管后的现场。
  mkdirSync(root + '/durable', { recursive: true }); writeFileSync(root + '/durable/state.json', JSON.stringify({ schema_version: 1, tables: { articles: [], observations: [], jobs: [], issues: [], calls: [], meta: [] } }) + '\n');
  writeFileSync(root + '/.nas-authority.json', JSON.stringify({ schema_version: 1, kind: 'nas_private_checkpoint', previous_runner_stopped: true,
    source_commit: 'a'.repeat(40), source_state_sha256: 'b'.repeat(64) }));
  chmodSync(root, 0o700); chmodSync(root + '/.nas-authority.json', 0o600);
  return { root, store: new Store(root, false, true), close() { this.store.db.close(); rmSync(root, { recursive: true, force: true }); } };
}

/** 第一条正文为空、第二条有效；只有第二条能进入写稿与审核。 */
function spec(root: string, store: Store) {
  const p = policy(); const cutoff = stamp(); const generation = stamp(new Date(Date.now() + 3600000));
  const bad: Row = { id: 'bad-empty-body', title: 'AI 大模型正式发布', url: 'https://example.org/bad', published_at: cutoff, content_fingerprint: digest('bad'),
    source: 'ithome', source_name: 'IT之家', text: '', content_status: 'usable_excerpt', output_schema: 'dual-2' };
  const good: Row = { id: 'good-usable-body', title: 'NVIDIA 芯片更新', url: 'https://example.org/good', published_at: cutoff, content_fingerprint: digest(text),
    source: 'nvidia', source_name: 'NVIDIA', text, content_status: 'usable_excerpt', output_schema: 'dual-2' };
  const articles = [bad, good].map((a) => { a.job_key = cacheKey(a, p); store.run('INSERT OR IGNORE INTO jobs(key,article,status) VALUES (?,?,?)', a.job_key, pyjson({ ...a, generation_policy: p }), 'queued'); return a; });
  const id = 'sample-ts-acceptance-retry-unit'; const path = samplePath(root, 'acceptance-retry');
  atomic(path, { id, mode: 'current_24h_sample', pool_edition: true, makeup_for: null, articles, rejected: [], collection_cutoff: cutoff, generation_cutoff: generation, created_at: cutoff });
  store.checkpoint(); return { id, path };
}

function responses(posts: { count: number }) {
  return (async (_url: any, options: any) => {
    posts.count++;
    const body = JSON.parse(String(options?.body ?? '{}'));
    const system = String(body?.messages?.[0]?.content ?? '');
    const review = system.includes('审稿员');
    const payload = review
      ? { verdict: 'pass', update_has_new_facts: false, checks: [
        { field: 'title', pass: true, reason: '与原文一致', evidence: '公司计划在中国测试这一人工智能模型' },
        { field: 'summary', pass: true, reason: '与原文一致', evidence: '公司计划在中国测试这一人工智能模型' },
        { field: 'short_summary', pass: true, reason: '保留未独立验证限定', evidence: '尚未独立验证。公司计划在中国测试' },
        { field: 'points', pass: true, reason: '空要点', evidence: '' },
        { field: 'why', pass: true, reason: '空关注理由', evidence: '' }] }
      : { title: '人工智能模型测试', summary: '公司计划在中国测试这一模型，尚未独立验证。', short_summary: '模型进入测试阶段，尚未独立验证。',
        why: '', points: [], uncertainties: [], claims: [{ claim: '模型测试', evidence: '公司计划在中国测试这一人工智能模型' }] };
    return Response.json({ usage: { prompt_tokens: 100, completion_tokens: 100 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(payload) } }] });
  }) as unknown as typeof fetch;
}

test('第一条候选坏掉时整轮继续，第二条确实进入写稿与审核', async () => {
  const s = setup(); const old = process.env.DEEPSEEK_API_KEY;
  try {
    delete process.env.DEEPSEEK_API_KEY;
    const { id } = spec(s.root, s.store); const posts = { count: 0 };
    const deps = { verify: async () => true, token: 'test-token', fetcher: responses(posts), now: () => new Date() } as any;
    await launchSample(s.store, 'acceptance-retry', deps);
    const report = JSON.parse(readFileSync(s.root + '/durable/sample-reports/' + id + '.json', 'utf8'));
    assert.ok(report.skipped.insufficient_content >= 1, '空正文候选必须记录跳过原因');
    assert.ok(report.drafts >= 1, '有效候选必须进入写稿');
    assert.ok(report.model_requests >= 2, '写稿与单篇审核都必须真正发出请求');
    const good = s.store.one("SELECT result FROM jobs WHERE article LIKE '%good-usable-body%'")!;
    assert.ok(good?.result, '有效候选必须留下草稿');
    const edition = JSON.parse(readFileSync(s.root + '/issues/' + id + '/edition.json', 'utf8'));
    assert.equal(edition.kind, 'diagnostic');
    // 不足 15 条时不组刊：诊断刊不带正文，只留排障记录。
    assert.equal(edition.articles.length, 0);
    assert.equal(report.edition_review, 'edition_pool_insufficient');
  } finally { if (old !== undefined) process.env.DEEPSEEK_API_KEY = old; s.close(); }
});

test('缺凭据是全局阻断：不发出任何模型请求，并记录阻断阶段', async () => {
  const s = setup(); const old = process.env.DEEPSEEK_API_KEY;
  try {
    delete process.env.DEEPSEEK_API_KEY;
    const { id } = spec(s.root, s.store); const posts = { count: 0 };
    const deps = { verify: async () => true, fetcher: (async () => { posts.count++; throw new Error('unexpected POST'); }) as unknown as typeof fetch, now: () => new Date() } as any;
    const edition = await launchSample(s.store, 'acceptance-retry', deps);
    const report = JSON.parse(readFileSync(s.root + '/durable/sample-reports/' + id + '.json', 'utf8'));
    assert.equal(posts.count, 0, '全局阻断后不得再发请求');
    assert.equal(report.stop.stage, 'writing');
    assert.equal(report.stop.reason, 'missing_api_key');
    assert.equal(report.terminal, 'blocked_at_writing');
    assert.equal(report.model_requests, 0);
    assert.equal(edition.kind, 'diagnostic');
  } finally { if (old !== undefined) process.env.DEEPSEEK_API_KEY = old; s.close(); }
});

test('诊断样刊即使冻结成功也不允许发送', async () => {
  const s = setup(); const old = process.env.DEEPSEEK_API_KEY;
  try {
    delete process.env.DEEPSEEK_API_KEY;
    spec(s.root, s.store);
    const deps = { verify: async () => true, token: 'test-token', fetcher: responses({ count: 0 }), now: () => new Date() } as any;
    await launchSample(s.store, 'acceptance-retry', deps);
    const id = 'sample-ts-acceptance-retry-unit';
    assert.equal(existsSync(s.root + '/issues/' + id + '/edition.json'), true);
    assert.equal(JSON.parse(readFileSync(s.root + '/issues/' + id + '/edition.json', 'utf8')).kind, 'diagnostic');
  } finally { if (old !== undefined) process.env.DEEPSEEK_API_KEY = old; s.close(); }
});
