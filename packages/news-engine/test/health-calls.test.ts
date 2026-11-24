import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCalls } from '../src/health.ts';

test('readCalls 只抽取 calls 数组，不解析整份大状态', () => {
  const dir = mkdtempSync(join(tmpdir(), 'etn-calls-'));
  const file = join(dir, 'state.json');
  writeFileSync(file, JSON.stringify({ tables: { articles: Array.from({ length: 5000 }, (_, i) => ({ id: 'a' + i, body: 'x'.repeat(200) })), calls: [{ id: 1, day: '2026-11-24', cost: 0.1 }, { id: 2, day: '2026-11-24', cost: null }], issues: [] } }));
  assert.deepEqual(readCalls(file).map((c) => c.id), [1, 2]);
  rmSync(dir, { recursive: true, force: true });
});
