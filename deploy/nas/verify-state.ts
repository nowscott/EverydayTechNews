// Offline deployment check: no model, SMTP, source fetching, or credentials.
import assert from 'node:assert/strict';
import { openSync, readSync, closeSync, readdirSync } from 'node:fs';
import { JSONParser } from './packages/news-engine/node_modules/@streamparser/json/dist/mjs/index.js';
import { Store } from './packages/news-engine/src/store.ts';
import { trial, policy } from './packages/news-engine/src/core.ts';
const root = '/data';
// ledger.ts 可能晚于本脚本进入镜像：缺失时退回历史上的行数口径（输出里 content_check 标 rows_only）。
type Ledger = typeof import('./packages/news-engine/src/ledger.ts');
const ledger: Ledger | null = await import('./packages/news-engine/src/ledger.ts').catch(() => null);
const state = root + '/durable/state.json';
const declared = ledger ? ledger.declaredLedger(state) : null;
// 旧口径：只读一次 state.json 数行，用于没有 ledger.ts 的镜像和早期快照。
function declaredCounts() {
  const counts = { calls: 0, issues: 0 }; let schema: unknown;
  const parser = new JSONParser({ paths: ['$.schema_version', '$.tables.calls.*', '$.tables.issues.*'], keepStack: false });
  parser.onValue = ({ value, key, stack }) => {
    if (stack.length === 1 && key === 'schema_version') { schema = value; return; }
    counts[(stack[2].key as 'calls' | 'issues')]++;
  };
  const fd = openSync(state, 'r'); const buffer = Buffer.allocUnsafe(256 * 1024);
  try { let size: number; while ((size = readSync(fd, buffer, 0, buffer.length, null)) > 0) parser.write(buffer.subarray(0, size)); if (!parser.isEnded) parser.end(); }
  finally { closeSync(fd); }
  return { counts, schema };
}
// 快照可能没有 state.sqlite3（早期版本或手工构造）：Store 必须在主库缺失时从 state.json 恢复全部内容，
// 而不是把新建的空库当成已有主库；这里只做轻量 checkpoint，避免再完整重写 431MB。
const store = new Store(root, false, true, { sqlitePrimary: false, lightCheckpoint: true });
try {
  const config = trial(root);
  assert.equal(config.production_enabled, false);
  assert.ok(policy().daily_budget_cny <= 2);
  assert.equal(new Set(store.missing).size, 0, 'missing evidence');
  const calls = Number(store.one('SELECT count(*) AS n FROM calls')?.n ?? 0);
  const issues = Number(store.one('SELECT count(*) AS n FROM issues')?.n ?? 0);
  let schema: unknown = declared?.schema;
  if (ledger) {
    // 逐行内容指纹：金额或冻结刊物正文变化时行数可以不变，只比行数会漏过。
    assert.deepEqual(ledger.storedLedger(store.db), declared!.tables, 'restored ledger content differs from state.json');
  } else {
    const legacy = declaredCounts();
    assert.equal(calls, legacy.counts.calls, 'state calls count differs from sqlite');
    assert.equal(issues, legacy.counts.issues, 'state issues count differs from sqlite');
    schema = legacy.schema;
  }
  store.checkpoint();
  console.log(JSON.stringify({ verified: true, calls, issues, schema, content_check: ledger ? 'row_hash' : 'rows_only',
    delivery_files: readdirSync(root + '/deliveries').length }));
} finally { store.db.close(); }
