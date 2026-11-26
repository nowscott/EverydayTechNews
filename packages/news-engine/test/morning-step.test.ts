import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.ts';
import { morningStep } from '../src/morning.ts';
import { atomic, RECIPIENT } from '../src/core.ts';

function setup() {
  const root = mkdtempSync(tmpdir() + '/morning-step-');
  atomic(root + '/trial.json', { schema_version: 1, mode: 'internal_test', testing_period: 'continuous', enabled: true, model_enabled: true, delivery_enabled: true, production_enabled: false, start: '2026-10-19', days: null, expires_at: null, allowed_recipient: RECIPIENT, daily_budget_cny: 2 });
  return { root, store: new Store(root), close() { this.store.db.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('早报按单步续跑：collect → assess → enrich → compose → deliver', async () => {
  const s = setup(); const calls: string[] = [];
  const deps = {
    collect: async () => { calls.push('collect'); return { status: 'collected' }; },
    assess: () => { calls.push('assess'); return { status: 'assessed' }; },
    enrich: async () => { calls.push('enrich'); return { status: 'ready_pool_sufficient' }; },
    compose: (_store: Store, now: Date) => { calls.push('compose'); const id = 'test-2026-11-25'; atomic(s.root + '/issues/' + id + '/edition.json', { id, articles: [] }); return { id }; },
    deliver: async () => { calls.push('deliver'); return { status: 'smtp_accepted' }; },
  } as any;
  const r1 = await morningStep(s.store, new Date('2026-11-25T04:05:00+08:00'), deps); assert.equal(r1.status, 'collected');
  const r2 = await morningStep(s.store, new Date('2026-11-25T04:10:00+08:00'), deps); assert.equal(r2.status, 'assessed');
  const r3 = await morningStep(s.store, new Date('2026-11-25T04:15:00+08:00'), deps); assert.equal(r3.status, 'ready_pool_sufficient');
  const r4 = await morningStep(s.store, new Date('2026-11-25T04:20:00+08:00'), deps); assert.equal(r4.status, 'pool_ready_waiting_compose');
  const r5 = await morningStep(s.store, new Date('2026-11-25T06:20:00+08:00'), deps); assert.equal(r5.status, 'edition_frozen');
  assert.equal(existsSync(s.root + '/durable/mornings/2026-11-25-stage.json'), true);
  const r6 = await morningStep(s.store, new Date('2026-11-25T06:35:00+08:00'), deps); assert.equal(r6.status, 'smtp_accepted');
  assert.deepEqual(calls, ['collect', 'assess', 'enrich', 'compose', 'deliver']);
  s.close();
});

test('干净 checkpoint 写入 sqlite 主状态标记', () => {
  const s = setup();
  s.store.checkpoint();
  assert.equal(existsSync(s.root + '/durable/sqlite-primary.json'), true);
  s.close();
});

test('写稿阶段落盘状态、调用数与跳过原因，零调用也能看出原因', async () => {
  const s = setup();
  const deps = {
    collect: async () => ({ status: 'collected' }), assess: () => ({ status: 'assessed' }),
    enrich: async () => ({ status: 'budget_exhausted', calls: 0, jobs: [{ job: 'a', status: 'budget_exhausted' }, { job: 'b', status: 'insufficient_content' }] }),
    compose: () => ({ id: 'test-2026-11-25' }), deliver: async () => ({ status: 'smtp_accepted' }),
  } as any;
  await morningStep(s.store, new Date('2026-11-25T04:05:00+08:00'), deps);
  await morningStep(s.store, new Date('2026-11-25T04:10:00+08:00'), deps);
  const r = await morningStep(s.store, new Date('2026-11-25T04:15:00+08:00'), deps);
  assert.equal(r.status, 'budget_exhausted');
  const record = JSON.parse(readFileSync(s.root + '/durable/mornings/2026-11-25-enrichment.json', 'utf8'));
  assert.equal(record.status, 'budget_exhausted'); assert.equal(record.calls, 0);
  assert.equal(record.skipped.budget_exhausted, 1); assert.equal(record.skipped.insufficient_content, 1);
  assert.equal(record.jobs, 2);
  const history = JSON.parse(readFileSync(s.root + '/durable/mornings/2026-11-25-enrichment-history.json', 'utf8'));
  assert.equal(history.length, 1);
  // 写稿失败只留阶段记录，不能写入 pool_ready 完成标记。
  const progress = JSON.parse(readFileSync(s.root + '/durable/mornings/2026-11-25.json', 'utf8'));
  assert.equal(typeof progress.writing_progress, 'string'); assert.equal(progress.pool_ready, undefined);
  s.close();
});

test('写稿抛异常也留下受控错误码，再把错误交给上层', async () => {
  const s = setup();
  const deps = {
    collect: async () => ({ status: 'collected' }), assess: () => ({ status: 'assessed' }),
    enrich: async () => { throw new Error('paid_transport_requires_authoritative_checkpoint'); },
    compose: () => ({ id: 'test-2026-11-25' }), deliver: async () => ({ status: 'smtp_accepted' }),
  } as any;
  await morningStep(s.store, new Date('2026-11-25T04:05:00+08:00'), deps);
  await morningStep(s.store, new Date('2026-11-25T04:10:00+08:00'), deps);
  await assert.rejects(() => morningStep(s.store, new Date('2026-11-25T04:15:00+08:00'), deps), /paid_transport_requires_authoritative_checkpoint/);
  const record = JSON.parse(readFileSync(s.root + '/durable/mornings/2026-11-25-enrichment.json', 'utf8'));
  assert.equal(record.status, 'enrich_error'); assert.equal(record.error_code, 'paid_transport_requires_authoritative_checkpoint');
  s.close();
});
