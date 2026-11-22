import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { atomicWrite, readJson, withLock } from '../src/controller/fsx.ts';
import { choose, compare, protectedWindow, shanghaiIso, version } from '../src/controller/version.ts';

test('version parses prefixed tags and rejects drift', () => {
  assert.deepEqual(version('ordinary-news-v2.7.5', 'ordinary-news-v'), [2, 7, 5]);
  assert.deepEqual(version('ordinary-news-v2.7.10', 'ordinary-news-v'), [2, 7, 10]);
  assert.equal(version('ordinary-news-v2.7', 'ordinary-news-v'), null);
  assert.equal(version('ordinary-news-v02.7.5', 'ordinary-news-v'), null);
  assert.equal(version('v2.7.5', 'ordinary-news-v'), null);
  assert.equal(version(undefined, 'ordinary-news-v'), null);
});

test('choose picks the highest published non-prerelease release above the floor', () => {
  const releases = [
    { tag_name: 'ordinary-news-v2.7.4', published_at: '2026-11-22T03:00:00Z' },
    { tag_name: 'ordinary-news-v2.7.5', published_at: '2026-11-22T04:00:00Z' },
    { tag_name: 'ordinary-news-v2.7.6', draft: true, published_at: '2026-11-22T05:00:00Z' },
    { tag_name: 'ordinary-news-v2.8.0', prerelease: true, published_at: '2026-11-22T05:00:00Z' },
    { tag_name: 'ordinary-news-v2.6.4', published_at: '2026-10-01T00:00:00Z' },
  ];
  assert.equal(choose(releases, [2, 7, 2], 'ordinary-news-v')?.tag_name, 'ordinary-news-v2.7.5');
  assert.equal(choose(releases, [2, 7, 5], 'ordinary-news-v'), null);
  assert.ok(compare([2, 8, 0], [2, 7, 10]) > 0);
});

test('protected window covers 04:00-08:59 Shanghai and nothing else', () => {
  assert.equal(protectedWindow(new Date('2026-11-21T20:00:00Z')), true);  // 04:00
  assert.equal(protectedWindow(new Date('2026-11-22T00:59:00Z')), true);  // 08:59
  assert.equal(protectedWindow(new Date('2026-11-22T01:00:00Z')), false); // 09:00
  assert.equal(protectedWindow(new Date('2026-11-21T19:59:00Z')), false); // 03:59
  assert.equal(shanghaiIso(new Date('2026-11-22T03:51:49Z')), '2026-11-22T11:51:49.000+08:00');
});

test('atomicWrite creates a 0600 file and round-trips JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etn-atomic-'));
  const file = path.join(dir, 'nested', 'state.json');
  atomicWrite(file, { tag: 'ordinary-news-v2.7.5', n: 1 });
  assert.deepEqual(readJson(file, null), { tag: 'ordinary-news-v2.7.5', n: 1 });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(readJson(path.join(dir, 'missing.json'), { fallback: true }), { fallback: true });
});

test('withLock is exclusive, honours non-blocking and releases after the body', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etn-lock-'));
  const file = path.join(dir, 'scheduler.lock');
  const seen: string[] = [];
  await withLock(file, { blocking: true }, async (acquired) => { seen.push('a:' + acquired); });
  await withLock(file, { blocking: true }, async (acquired) => {
    seen.push('b:' + acquired);
    const inner = await withLock(file, { blocking: false }, (got) => got);
    seen.push('inner:' + inner);
  });
  assert.deepEqual(seen, ['a:true', 'b:true', 'inner:false']);
  assert.equal(fs.existsSync(file), false);
});

test('withLock treats a stale lock file as free', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etn-stale-'));
  const file = path.join(dir, 'state.lock');
  fs.writeFileSync(file, '{"pid":123}');
  const old = new Date(Date.now() - 2 * 3600 * 1000);
  fs.utimesSync(file, old, old);
  const got = await withLock(file, { blocking: false }, (acquired) => acquired);
  assert.equal(got, true);
  assert.equal(fs.existsSync(file), false);
});
