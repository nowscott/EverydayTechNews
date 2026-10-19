import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.ts';
import { atomic, EXPIRY, RECIPIENT, stamp } from '../src/core.ts';
import { collect, collectionIntervalMinutes, due } from '../src/pool.ts';

test('NAS collection uses wall-clock buckets without weakening the freeze or delivery windows', () => {
  const root = mkdtempSync(tmpdir() + '/collection-schedule-'); const store = new Store(root);
  const previous = process.env.NEWS_COLLECTION_PROFILE;
  try {
    process.env.NEWS_COLLECTION_PROFILE = 'nas_balanced';
    atomic(root + '/trial.json', { schema_version: 1, mode: 'internal_test', enabled: true, start: '2026-10-19', days: 7,
      expires_at: EXPIRY, allowed_recipient: RECIPIENT, daily_budget_cny: 2, model_enabled: true, delivery_enabled: true, production_enabled: false });
    atomic(root + '/source-health.json', { at: '2026-10-19T10:07:05+08:00' });
    assert.equal(due(store, new Date('2026-10-19T10:22:00+08:00')).collect, false);
    assert.equal(due(store, new Date('2026-10-19T10:37:00+08:00')).collect, true);
    atomic(root + '/source-health.json', { at: '2026-10-19T04:07:05+08:00' });
    assert.equal(due(store, new Date('2026-10-19T04:22:00+08:00')).collect, true);
    assert.equal(collectionIntervalMinutes(new Date('2026-10-19T06:14:00+08:00')), 15);
    const frozen = due(store, new Date('2026-10-19T06:15:00+08:00'));
    assert.equal(frozen.collect, false); assert.equal(frozen.enrich, false); assert.equal(frozen.deliver, false);
  } finally {
    if (previous === undefined) delete process.env.NEWS_COLLECTION_PROFILE; else process.env.NEWS_COLLECTION_PROFILE = previous;
    store.db.close(); rmSync(root, { recursive: true, force: true });
  }
});

test('rate-limited sources cool down without extending the deadline on skipped collections', async () => {
  const root = mkdtempSync(tmpdir() + '/collection-cooldown-'); const store = new Store(root);
  try {
    const attempted = stamp();
    store.run('INSERT INTO meta VALUES (?,?)', 'health', JSON.stringify({ sources: [{ source: 'ithome', ok: false, http_status: 429, last_attempt_at: attempted }] }));
    let ithomeRequests = 0;
    const fetcher = (async (input: any) => {
      if (String(input).includes('ithome.com')) ithomeRequests++;
      return new Response('', { status: 429 });
    }) as typeof fetch;
    for (let i = 0; i < 2; i++) {
      const health = await collect(store, 4, fetcher);
      const source = health.sources.find((r: any) => r.source === 'ithome');
      assert.ok(source);
      assert.equal(source.skipped, true); assert.equal(source.last_attempt_at, attempted);
    }
    assert.equal(ithomeRequests, 0);
  } finally { store.db.close(); rmSync(root, { recursive: true, force: true }); }
});
