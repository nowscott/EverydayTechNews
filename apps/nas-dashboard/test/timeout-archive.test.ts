import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveState, lastDelivery, operation, runTiming } from '../server/data.ts';

test('作业耗时按记录器字段计算超时', () => {
  const base = { started_at: '2026-11-22T16:00:00+08:00', finished_at: '2026-11-22T16:12:00+08:00', timeout_s: 600 };
  assert.deepEqual(runTiming(base), { duration_ms: 720000, timeout_s: 600, timed_out: true });
  assert.equal(runTiming({ ...base, finished_at: '2026-11-22T16:05:00+08:00' }).timed_out, false);
});

test('运行中的作业按当前时间累计，不信任缺失的 duration', () => {
  const now = Date.parse('2026-11-22T16:20:00+08:00');
  const timing = runTiming({ started_at: '2026-11-22T16:05:00+08:00', finished_at: null, timeout_s: 600 }, now);
  assert.equal(timing.duration_ms, 900000);
  assert.equal(timing.timed_out, true);
});

test('记录器已写入 timed_out 时保持为真', () => {
  const timing = runTiming({ started_at: '2026-11-22T16:00:00+08:00', finished_at: '2026-11-22T16:01:00+08:00', duration_ms: 60000, timed_out: true });
  assert.equal(timing.timed_out, true);
});

test('operation 透出耗时与超时', () => {
  const now = new Date('2026-11-22T16:20:00+08:00');
  const row = operation({ started_at: '2026-11-22T16:05:00+08:00', finished_at: '2026-11-22T16:16:00+08:00', state: 'completed', exit_code: 0, timeout_s: 600 }, now, 'premium');
  assert.equal(row.timed_out, true);
  assert.equal(row.duration_ms, 660000);
});

test('归档未同步立即告警，同步过期 36 小时后告警', () => {
  const now = new Date('2026-11-22T16:00:00+08:00');
  const failed = archiveState({ archive_sync: { status: 'archive_sync_failed', at: '2026-11-22T15:40:00+08:00' } }, now);
  assert.equal(failed.status, 'archive_sync_failed');
  assert.deepEqual(failed.alerts, ['归档同步未完成（archive_sync_failed），远端可能落后']);
  const stale = archiveState({ archive_sync: { status: 'synced', at: '2026-11-20T10:00:00+08:00' } }, now);
  assert.equal(stale.stale, true);
  assert.equal(stale.alerts.length, 1);
  assert.deepEqual(archiveState({ archive_sync: { status: 'synced', at: '2026-11-22T15:40:00+08:00' } }, now).alerts, []);
  assert.deepEqual(archiveState(null, now).alerts, []);
});

test('最近出刊成功时间只认已完成的投递', () => {
  assert.deepEqual(lastDelivery({ delivery: { completed: true, finished_at: '2026-11-22T06:30:29+08:00', outcome: 'smtp_accepted', counts: { smtp_accepted: 97 } } }),
    { at: '2026-11-22T06:30:29+08:00', outcome: 'smtp_accepted', count: 97 });
  assert.equal(lastDelivery({ delivery: { completed: false, finished_at: '2026-11-22T06:30:29+08:00', outcome: 'failed' } })!.at, null);
  assert.equal(lastDelivery(null), null);
});
