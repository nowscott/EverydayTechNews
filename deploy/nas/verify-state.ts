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
const store = new Store(root, false, true);
try {
  const config = trial(root);
  assert.equal(config.production_enabled, false);
  assert.ok(policy().daily_budget_cny <= 2);
  assert.equal(new Set(store.missing).size, 0, 'missing evidence');
  store.checkpoint();
  const after = ledger();
  assert.deepEqual(after, before, 'billing ledger or frozen issues changed');
  // Restore a second time to prove round-trip compatibility with the same engine.
  store.restore();
  console.log(JSON.stringify({ verified: true, calls: before.counts.calls,
    delivery_files: readdirSync(root + '/deliveries').length, schema: after.schema }));
} finally { store.db.close(); }
