import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';

function seed(files: Record<string, number>) {
  const root = mkdtempSync(join(tmpdir(), 'etn-prune-'));
  const store = new Store(root);
  mkdirSync(root + '/transient/raw/x', { recursive: true });
  const entries: Record<string, unknown> = {};
  for (const [name, ageDays] of Object.entries(files)) {
    const file = root + '/transient/raw/x/' + name;
    writeFileSync(file, JSON.stringify({ name }));
    if (ageDays < 0) continue;
    const at = Date.now() - ageDays * 86400000;
    utimesSync(file, at / 1000, at / 1000);
  }
  entries['raw/x/evidence.json'] = { sha256: '0', bytes: 1, captured_at: '2026-01-01T00:00:00+08:00', expires_at: '2030-01-01T00:00:00+08:00' };
  store.objects = entries as any;
  return { root, store };
}

test('超过保留天数且未登记为证据的缓存会被回收', () => {
  const { root, store } = seed({ 'old.json': 40, 'evidence.json': 40, 'fresh.json': 2 });
  const result = store.pruneTransient(30);
  assert.equal(result.files, 1);
  assert.equal(result.keep_days, 30);
  assert.ok(result.bytes > 0);
  assert.equal(existsSync(root + '/transient/raw/x/old.json'), false);
  assert.equal(existsSync(root + '/transient/raw/x/evidence.json'), true);
  assert.equal(existsSync(root + '/transient/raw/x/fresh.json'), true);
});

test('保留天数可调，0 天也不动仍在保留期内的文件', () => {
  const { root, store } = seed({ 'old.json': 1 });
  assert.equal(store.pruneTransient(60).files, 0);
  assert.equal(existsSync(root + '/transient/raw/x/old.json'), true);
});
