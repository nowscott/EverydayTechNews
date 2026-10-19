import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.ts';
import { atomic, digest } from '../src/core.ts';

test('NAS authority requires private storage and explicit exclusive handover; offline copies remain blocked', () => {
  const root = mkdtempSync(tmpdir() + '/nas-authority-');
  let store: Store | undefined;
  try {
    store = new Store(root); assert.equal(store.authoritative, false); store.checkpoint(); store.db.close(); store = undefined;
    assert.throws(() => new Store(root, false, true), /private_nas_handover_required/);
    const marker = { schema_version: 1, kind: 'nas_private_checkpoint', previous_runner_stopped: true,
      source_commit: 'a'.repeat(40), source_state_sha256: digest('synthetic snapshot') };
    atomic(root + '/.nas-authority.json', { ...marker, previous_runner_stopped: false });
    assert.throws(() => new Store(root, false, true), /private_nas_handover_required/);
    atomic(root + '/.nas-authority.json', marker);
    chmodSync(root, 0o755);
    assert.throws(() => new Store(root, false, true), /private_nas_handover_required/);
    chmodSync(root, 0o700);
    assert.throws(() => new Store(root, true, true), /choose_one_state_authority/);
    store = new Store(root, false, true); assert.equal(store.authoritative, true);
    // A reservation persisted before an external call must survive a fresh process/store.
    store.run('INSERT INTO calls (id,day,job,reserved,cost,status) VALUES (?,?,?,?,?,?)', 1, '2026-10-19', 'synthetic', 0.1, null, 'reserved');
    store.checkpoint(); store.db.close(); store = new Store(root, false, true);
    assert.equal(store.one('SELECT reserved FROM calls WHERE id=1')?.reserved, 0.1);
    assert.equal(store.one('SELECT cost FROM calls WHERE id=1')?.cost, null);
    assert.equal(store.syncGit, false);
  } finally { store?.db.close(); rmSync(root, { recursive: true, force: true }); }
});
