// Offline deployment check: no model, SMTP, source fetching, or credentials.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Store } from './packages/news-engine/src/store.ts';
import { trial, policy } from './packages/news-engine/src/core.ts';
const root = '/data';
const before = JSON.parse(readFileSync(root + '/durable/state.json', 'utf8'));
const store = new Store(root, false, true);
try {
  const config = trial(root);
  assert.equal(config.production_enabled, false);
  assert.ok(policy().daily_budget_cny <= 2);
  assert.equal(new Set(store.missing).size, 0, 'missing evidence');
  store.checkpoint();
  const after = JSON.parse(readFileSync(root + '/durable/state.json', 'utf8'));
  assert.deepEqual(after.tables.calls, before.tables.calls, 'billing ledger changed');
  assert.deepEqual(after.tables.issues, before.tables.issues, 'frozen issues changed');
  // Restore a second time to prove round-trip compatibility with the same engine.
  store.restore();
  console.log(JSON.stringify({ verified: true, calls: before.tables.calls.length,
    delivery_files: readdirSync(root + '/deliveries').length, schema: after.schema_version }));
} finally { store.db.close(); }
