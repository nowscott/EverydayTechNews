// Offline deployment check: no model, SMTP, source fetching, or credentials.
import assert from 'node:assert/strict';
import { openSync, readSync, closeSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JSONParser } from './packages/news-engine/node_modules/@streamparser/json/dist/mjs/index.js';
import { Store } from './packages/news-engine/src/store.ts';
import { trial, policy } from './packages/news-engine/src/core.ts';
const root = '/data';
function ledger() {
  const hashes = { calls: createHash('sha256'), issues: createHash('sha256') }; const counts = { calls: 0, issues: 0 }; let schema: unknown;
  const parser = new JSONParser({ paths: ['$.schema_version', '$.tables.calls.*', '$.tables.issues.*'], keepStack: false });
  parser.onValue = ({ value, key, stack }) => {
    if (stack.length === 1 && key === 'schema_version') { schema = value; return; }
    const table = stack[2].key as 'calls' | 'issues'; hashes[table].update(JSON.stringify(value) + '\n'); counts[table]++;
  };
  const fd = openSync(root + '/durable/state.json', 'r'); const buffer = Buffer.allocUnsafe(256 * 1024);
  try { let size: number; while ((size = readSync(fd, buffer, 0, buffer.length, null)) > 0) parser.write(buffer.subarray(0, size)); if (!parser.isEnded) parser.end(); }
  finally { closeSync(fd); }
  return { schema, counts, calls: hashes.calls.digest('hex'), issues: hashes.issues.digest('hex') };
}
const before = ledger();
// SQLite 已是主状态：不再做 431MB 的完整 state.json 重写；只核对 state 与库的行数/账本一致。
const store = new Store(root, false, true, { sqlitePrimary: true, lightCheckpoint: true });
try {
  const config = trial(root);
  assert.equal(config.production_enabled, false);
  assert.ok(policy().daily_budget_cny <= 2);
  assert.equal(new Set(store.missing).size, 0, 'missing evidence');
  store.checkpoint();
  const calls = Number(store.one('SELECT count(*) AS n FROM calls')?.n ?? 0);
  const issues = Number(store.one('SELECT count(*) AS n FROM issues')?.n ?? 0);
  assert.equal(calls, before.counts.calls, 'state calls count differs from sqlite');
  assert.equal(issues, before.counts.issues, 'state issues count differs from sqlite');
  console.log(JSON.stringify({ verified: true, calls, issues,
    delivery_files: readdirSync(root + '/deliveries').length, schema: before.schema }));
} finally { store.db.close(); }
