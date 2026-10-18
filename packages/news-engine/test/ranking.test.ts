import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { choose, evaluate, preferences } from '../src/ranking.ts';
import { execute } from '../src/cli.ts';
import { round2, timestamp } from '../src/compat.ts';
import { article, cutoff, parityCases } from './fixtures.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const python = process.env.PYTHON ?? (existsSync(`${root}.venv/bin/python`) ? `${root}.venv/bin/python` : 'python3');
const config = preferences();

test('all synthetic reference outputs match Python, including Unicode and ties', () => {
  const cases = parityCases();
  const result = spawnSync(python, [fileURLToPath(new URL('../tools/python_reference.py', import.meta.url))], {
    input: JSON.stringify(cases), encoding: 'utf8', maxBuffer: 30 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  const reference = JSON.parse(result.stdout);
  cases.forEach((input, i) => assert.deepEqual(JSON.parse(JSON.stringify(execute(input))), reference[i], `case ${i}`));
});

test('interest bonus is a maximum, not a sum; all five interests detected', () => {
  const ranking = evaluate(article({ title: 'AI Apple NVIDIA Tesla SpaceX 发布' }), cutoff, config);
  assert.equal(ranking.breakdown.interest_bonus, 12); assert.equal(ranking.interests.length, 5);
});

test('score thresholds, sample mode and capacity reasons are preserved', () => {
  const low = article({ title: '日常生活', text: '人工智能', source: 'ithome' });
  const score = evaluate(low, cutoff, config).score;
  assert.ok(score >= 40 && score < 58);
  assert.equal(choose([low], cutoff, config)[1][0].reason, 'editorial_score_below_threshold');
  assert.equal(choose([low], cutoff, config, { sample: true })[0].length, 1);
  assert.equal(choose([article(), article({ id: 'two' })], cutoff, config, { target: 1 })[1][0].reason, 'edition_capacity');
  const boundary = article({ title: '产品', source: 'ithome', published_at: '2026-10-17T07:12:00+08:00' });
  assert.equal(evaluate(boundary, cutoff, config).score, 58);
  assert.equal(choose([boundary], cutoff, config)[0].length, 1);
  const below = { ...boundary, published_at: '2026-10-17T07:11:02+08:00' };
  assert.equal(evaluate(below, cutoff, config).score, 57.99);
  assert.equal(choose([below], cutoff, config)[0].length, 0);
});

test('diversity can reorder within three points, never outside it', () => {
  const a = article({ id: 'z' }); const b = article({ id: 'y' });
  const close = article({ id: 'x', source: 'ithome', topic: '其他科技' });
  assert.deepEqual(choose([a, b, close], cutoff, config)[0].map(a => a.id), ['z', 'x', 'y']);
  const far = article({ ...close, title: 'AI 测试' });
  assert.deepEqual(choose([a, b, far], cutoff, config)[0].map(a => a.id), ['z', 'y', 'x']);
});

test('choose does not mutate input and preserves additional fields', () => {
  const input = [article({ url: 'https://example.org', extra: { retained: true } })]; const before = structuredClone(input);
  const [selected] = choose(input, cutoff, config); assert.deepEqual(input, before);
  assert.deepEqual(selected[0].extra, { retained: true });
});

test('Python binary rounding and timezone interpretation', () => {
  assert.equal(round2(2.675), 2.67); assert.equal(round2(2.685), 2.69); assert.equal(round2(2.625), 2.62);
  assert.equal(timestamp(cutoff), timestamp('2026-10-18T04:00:00Z'));
  assert.throws(() => timestamp('2026-02-31T00:00:00Z')); assert.throws(() => timestamp('2026-10-18T12:00:00'));
});

test('CLI accepts stdin and explicit config; rejects malformed input without stdout', () => {
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const input = { articles: [article()], cutoff, config: { ...config, interest_weights: { AI: 3 } } };
  const result = spawnSync(process.execPath, [cli, '-'], { input: JSON.stringify(input), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), execute(input));
  for (const bad of ['{', JSON.stringify({ articles: [], cutoff: 'local date' }), JSON.stringify({ ...input, target: -1 })]) {
    const failure = spawnSync(process.execPath, [cli], { input: bad, encoding: 'utf8' });
    assert.equal(failure.status, 1); assert.equal(failure.stdout, '');
  }
});
