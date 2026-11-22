import test from 'node:test';
import assert from 'node:assert/strict';
import { intervalMinutes, nextRun, policy } from '../src/daemon.ts';

const at = (h: number, m: number, s = 0) => new Date(2026, 10, 22, h, m, s);

test('清晨 04:00-06:14 用 15 分钟节奏', () => {
  assert.equal(intervalMinutes(at(4, 0)), 15);
  assert.equal(intervalMinutes(at(5, 59)), 15);
  assert.equal(intervalMinutes(at(6, 14)), 15);
});

test('其余时段 30 分钟', () => {
  assert.equal(intervalMinutes(at(6, 15)), 30);
  assert.equal(intervalMinutes(at(3, 59)), 30);
  assert.equal(intervalMinutes(at(16, 48)), 30);
});

test('nextRun 对齐到下一个节奏边界', () => {
  const hm = (d: Date) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  assert.equal(hm(nextRun(at(16, 48))), '17:00');
  assert.equal(hm(nextRun(at(4, 1))), '04:15');
  assert.equal(hm(nextRun(at(6, 14, 30))), '06:30');
});

test('nextRun 永远晚于当前时刻且清零秒', () => {
  for (let m = 0; m < 60; m += 7) {
    const now = at(16, m, 30);
    const next = nextRun(now);
    assert.ok(next.getTime() > now.getTime());
    assert.equal(next.getSeconds(), 0);
    assert.equal(next.getMilliseconds(), 0);
  }
});

test('policy 文案与节奏一致', () => {
  assert.equal(policy(), '04-06:14:15m,else:30m');
});
