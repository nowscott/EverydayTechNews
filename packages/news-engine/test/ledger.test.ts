import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { declaredLedger, storedLedger } from '../src/ledger.ts';

function seed(root: string): void {
  const store = new Store(root);
  try {
    store.run('INSERT INTO issues VALUES (?,?)', 'issue-1', JSON.stringify({
      id: 'issue-1', day: '2026-11-26', subject: '每日科技早报',
      articles: [{ title: '标题', text: '正文内容', description_clean: '摘要', url: 'https://example.com/a' }],
    }));
    store.run('INSERT INTO calls (id,day,job,reserved,cost,status) VALUES (?,?,?,?,?,?)', 1, '2026-11-26', 'job-a', 0.02, 0.01, 'settled');
    store.checkpoint();
  } finally { store.db.close(); }
}

test('state.json 声明的内容与从它恢复的 SQLite 逐行一致（含正文）', () => {
  const root = mkdtempSync(join(tmpdir(), 'etn-ledger-'));
  try {
    seed(root);
    const declared = declaredLedger(join(root, 'durable/state.json'));
    // 模拟主库丢失后重新开始：只剩 state.json。
    rmSync(join(root, 'state.sqlite3'));
    const restored = new Store(root, false, false, { sqlitePrimary: true, lightCheckpoint: true });
    try {
      assert.equal(new Set(restored.missing).size, 0, '正文必须能从 transient 里还原');
      assert.deepEqual(storedLedger(restored.db), declared.tables);
    } finally { restored.db.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('行数不变时金额变化也会改变指纹（旧的只比行数校验会漏过）', () => {
  const root = mkdtempSync(join(tmpdir(), 'etn-ledger-amount-'));
  try {
    seed(root);
    const file = join(root, 'durable/state.json');
    const before = declaredLedger(file);
    writeFileSync(file, readFileSync(file, 'utf8').replace('"cost":0.01', '"cost":0.02'));
    const after = declaredLedger(file);
    assert.notEqual(after.tables.calls, before.tables.calls, '金额变化必须体现在指纹里');
    assert.equal(after.tables.issues, before.tables.issues, '没动的表指纹保持稳定');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('行数不变时冻结刊物换掉正文引用也会改变指纹', () => {
  const root = mkdtempSync(join(tmpdir(), 'etn-ledger-body-'));
  try {
    seed(root);
    const file = join(root, 'durable/state.json');
    const text = readFileSync(file, 'utf8');
    const before = declaredLedger(file);
    const ref = /bodies\/([a-f0-9]{64})\.json/.exec(text);
    assert.ok(ref, '正文应当被折算成 bodies 引用');
    writeFileSync(file, text.replace(ref![0], 'bodies/' + 'f'.repeat(64) + '.json'));
    const after = declaredLedger(file);
    assert.notEqual(after.tables.issues, before.tables.issues, '正文引用变化必须体现在指纹里');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
