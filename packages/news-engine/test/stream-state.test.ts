import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.ts';
import { assess } from '../src/pool.ts';

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

test('assessment retains the latest snapshot per day without deleting older reports', () => {
  const root = mkdtempSync(tmpdir() + '/news-daily-assessment-'); const store = new Store(root);
  try {
    const dir = root + '/durable/assessments'; mkdirSync(dir, { recursive: true });
    writeFileSync(dir + '/20261019090000000000.json', '{"legacy":true}');
    assess(store, new Date('2026-10-19T01:00:00Z'));
    assess(store, new Date('2026-10-19T02:00:00Z'));
    assess(store, new Date('2026-10-20T01:00:00Z'));
    const names = readdirSync(dir).sort(); assert.equal(names.length, 3);
    assert.equal(names[0], '20261019090000000000.json'); assert.equal(names[1], '20261019235959999999.json');
    assert.equal(JSON.parse(readFileSync(dir + '/' + names[1], 'utf8')).at, '2026-10-19T10:00:00+08:00');
    assert.equal(JSON.parse(readFileSync(dir + '/' + names[0], 'utf8')).legacy, true);
  } finally { store.db.close(); rmSync(root, { recursive: true, force: true }); }
});
