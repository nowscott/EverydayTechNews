import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Controller, primaryLedgerDigest } from '../../../deploy/nas/base-manage.ts';
import { Store } from '../src/store.ts';
import { storedLedger } from '../src/ledger.ts';

function data(): { root: string; data: string } {
  const root = mkdtempSync(join(tmpdir(), 'etn-backup-'));
  const directory = join(root, 'data');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'config.json'), JSON.stringify({ data: directory }));
  return { root, data: directory };
}

function seed(directory: string): void {
  const store = new Store(directory);
  try {
    store.run('INSERT INTO issues VALUES (?,?)', 'issue-1', JSON.stringify({
      id: 'issue-1', day: '2026-11-26', articles: [{ title: '标题', text: '冻结前的正文', description_clean: '摘要' }],
    }));
    store.run('INSERT INTO calls (id,day,job,reserved,cost,status) VALUES (?,?,?,?,?,?)', 1, '2026-11-26', 'job-a', 0.02, 0.01, 'settled');
    store.checkpoint();
    // 日常轮次只写 SQLite：后面这条不会进 state.json。
    store.run('INSERT INTO calls (id,day,job,reserved,cost,status) VALUES (?,?,?,?,?,?)', 2, '2026-11-26', 'job-b', 0.04, 0.02, 'settled');
  } finally { store.db.close(); }
}

test('部署快照带着最新 SQLite 主库，备份恢复后费用与冻结刊物与在线一致', () => {
  const { root, data: directory } = data();
  try {
    seed(directory);
    const live = new Store(directory, false, false, { sqlitePrimary: true, lightCheckpoint: true });
    let fingerprint: Record<string, string>;
    try {
      // 在线账本已经是两条费用；state.json 里只有一条（轻量 checkpoint 的必然结果）。
      assert.equal(Number(live.one('SELECT count(*) AS n FROM calls')?.n), 2);
      fingerprint = storedLedger(live.db);
    } finally { live.db.close(); }

    const controller = new Controller(root);
    const snapshot = join(root, 'snapshot');
    controller.snapshot(snapshot);
    assert.ok(existsSync(join(snapshot, 'state.sqlite3')), '备份不能漏掉 SQLite 主库');
    assert.equal(primaryLedgerDigest(join(snapshot, 'state.sqlite3')), primaryLedgerDigest(join(directory, 'state.sqlite3')),
      '备份里的主库必须与在线主库是同一份账本');

    // 从备份恢复：主库存在时走快速启动，不能再回落到过期的 state.json。
    const restored = new Store(snapshot, false, false, { sqlitePrimary: true, lightCheckpoint: true });
    try {
      assert.equal(Number(restored.one('SELECT count(*) AS n FROM calls')?.n), 2, '漏掉的那笔费用必须回来');
      assert.equal(Number(restored.one('SELECT sum(cost) AS n FROM calls')?.n), 0.03);
      assert.deepEqual(storedLedger(restored.db), fingerprint, '费用与冻结刊物内容必须与在线一致');
    } finally { restored.db.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('普通版账本没有 calls 表也能算指纹，部署不会因此失败', () => {
  const root = mkdtempSync(join(tmpdir(), 'etn-ordinary-ledger-'));
  try {
    const file = join(root, 'state.sqlite3');
    const db = new DatabaseSync(file);
    try {
      db.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE issues(id TEXT PRIMARY KEY, day TEXT, mode TEXT, data TEXT NOT NULL);
        CREATE TABLE deliveries(id TEXT PRIMARY KEY, issue TEXT, email TEXT, status TEXT, attempts INTEGER, data TEXT NOT NULL);
        CREATE TABLE outbox(id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
      db.exec(`INSERT INTO issues VALUES ('2231-1','2026-11-26','production','{}');
        INSERT INTO deliveries VALUES ('d1','2231-1','reader@example.test','sent',1,'{}');`);
    } finally { db.close(); }
    const first = primaryLedgerDigest(file);
    assert.notEqual(first, null, '普通版库必须算得出指纹，而不是抛 no such table');
    const again = new DatabaseSync(file);
    try {
      again.exec("UPDATE deliveries SET status = 'failed' WHERE id = 'd1'");
    } finally { again.close(); }
    assert.notEqual(primaryLedgerDigest(file), first, '投递状态变化必须体现在指纹里');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('没有主库的备份无法证明账本完整，指纹比对会暴露差异', () => {
  const { root, data: directory } = data();
  try {
    seed(directory);
    const controller = new Controller(root);
    const snapshot = join(root, 'snapshot');
    controller.snapshot(snapshot);
    rmSync(join(snapshot, 'state.sqlite3'));
    assert.equal(primaryLedgerDigest(join(snapshot, 'state.sqlite3')), null);
    assert.notEqual(primaryLedgerDigest(join(directory, 'state.sqlite3')), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
