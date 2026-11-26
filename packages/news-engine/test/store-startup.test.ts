import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';

const call = (store: Store, id: number, job: string, cost: number) =>
  store.run('INSERT INTO calls (id,day,job,reserved,cost,status) VALUES (?,?,?,?,?,?)', id, '2026-11-26', job, cost * 2, cost, 'settled');

test('SQLite 主库文件丢失时，sqlite-primary 模式仍然从 state.json 恢复', () => {
  const root = mkdtempSync(join(tmpdir(), 'etn-store-startup-'));
  try {
    const first = new Store(root);
    call(first, 1, 'job-a', 0.01);
    first.checkpoint();
    // 日常轮次只有轻量 checkpoint：第二条只落在 SQLite 里。
    call(first, 2, 'job-b', 0.02);
    first.db.close();
    assert.ok(existsSync(join(root, 'durable/state.json')));
    assert.ok(existsSync(join(root, 'durable/sqlite-primary.json')));
    rmSync(join(root, 'state.sqlite3'));

    const reopened = new Store(root, false, false, { sqlitePrimary: true, lightCheckpoint: true });
    try {
      assert.equal(Number(reopened.one('SELECT count(*) AS n FROM calls')?.n), 1,
        '新建的空库不能被当成已有主库，必须回落到 state.json');
      assert.equal(Number(reopened.one('SELECT cost FROM calls WHERE id=1')?.cost), 0.01);
    } finally { reopened.db.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('主库是 0 字节残骸时同样回落到 state.json', () => {
  const root = mkdtempSync(join(tmpdir(), 'etn-store-empty-'));
  try {
    const first = new Store(root);
    call(first, 1, 'job-a', 0.01);
    first.checkpoint();
    first.db.close();
    writeFileSync(join(root, 'state.sqlite3'), '');
    const reopened = new Store(root, false, false, { sqlitePrimary: true, lightCheckpoint: true });
    try { assert.equal(Number(reopened.one('SELECT count(*) AS n FROM calls')?.n), 1); }
    finally { reopened.db.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
