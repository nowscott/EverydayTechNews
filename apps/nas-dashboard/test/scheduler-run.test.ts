import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { schedulerRun, operation } from '../server/data.ts';

const schedulerStatus = JSON.parse(readFileSync(new URL('../test/fixtures/premium-scheduler-status.json', import.meta.url), 'utf8'));

test('高级版常驻调度投影成一条已完成运行，带耗时', () => {
  const run = schedulerRun('premium', schedulerStatus.scheduler)!;
  assert.equal(run.component, 'premium');
  assert.equal(run.exit_code, 0);
  assert.equal(run.duration_ms, 319827);
  assert.equal(run.timeout_s, 600);
  assert.equal(Date.parse(run.finished_at) - Date.parse(run.started_at), 319827);
  const view = operation(run, new Date('2026-11-22T18:20:00+08:00'), 'premium');
  assert.equal(view.state, 'waiting');
  assert.equal(view.timed_out, false);
});

test('高级版最近一轮失败时投影为 failed，超时标记生效', () => {
  const failed = { scheduler: { last_tick: { at: '2026-11-22T10:05:48.357Z', status: 'failed', exit_code: 1, seconds: 319.827 } } };
  const run = schedulerRun('premium', failed.scheduler)!;
  assert.equal(operation(run, new Date('2026-11-22T18:20:00+08:00'), 'premium').state, 'failed');
});

test('普通版 last_tick 没有耗时也能投影，超时字段为空', () => {
  const run = schedulerRun('ordinary', { last_tick: { at: '2026-11-22T10:07:00.003Z', status: 'completed', ticked: '2026-11-22', error_count: 0 } })!;
  assert.equal(run.exit_code, 0);
  assert.equal(run.duration_ms, null);
  assert.equal(run.timeout_s, null);
});

test('没有 last_tick 时不伪造运行记录', () => {
  assert.equal(schedulerRun('premium', { ticks: 0, last_tick: null }), null);
  assert.equal(schedulerRun('premium', null), null);
});
