import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.ts';

test('streamed snapshots restore legacy formatting and keep transaction rollback on a truncated file', () => {
  const root = mkdtempSync(tmpdir() + '/news-stream-state-');
  try {
    const first = new Store(root);
    first.run('INSERT INTO articles VALUES (?,?,?)', 'a', 'f', JSON.stringify({ title: '中文 and escaped \\"quote\\"' }));
    for (let i = 0; i < 2000; i++) first.run('INSERT INTO observations VALUES (?,?,?,?)', 'a', 'f', String(i), 'hash');
    first.checkpoint(); first.db.close();
    const state = JSON.parse(readFileSync(root + '/durable/state.json', 'utf8'));
    writeFileSync(root + '/durable/state.json', JSON.stringify(state, null, 2));
    const restored = new Store(root);
    assert.equal(restored.one('SELECT COUNT(*) n FROM observations')!.n, 2000);
    assert.deepEqual(JSON.parse(restored.one('SELECT data FROM articles')!.data), { title: '中文 and escaped \\"quote\\"' });
    restored.checkpoint(); restored.db.close();
    const saved = readFileSync(root + '/durable/state.json', 'utf8');
    assert.deepEqual(JSON.parse(saved), state);
    writeFileSync(root + '/durable/state.json', saved.slice(0, -3));
    assert.throws(() => new Store(root));
    mkdirSync(root + '/durable', { recursive: true }); writeFileSync(root + '/durable/state.json', saved);
    const recovered = new Store(root);
    assert.equal(recovered.one('SELECT COUNT(*) n FROM observations')!.n, 2000); recovered.db.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
