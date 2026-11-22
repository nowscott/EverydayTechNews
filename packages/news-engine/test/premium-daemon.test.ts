import test from 'node:test';
import assert from 'node:assert/strict';
import { dueAtPremium, nextRun, policy, quietNow } from '../src/daemon.ts';

const at = (h: number, m: number, s = 0) => new Date(2026, 10, 22, h, m, s);
const hm = (d: Date) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

test('清晨 04:00-06:14 用 15 分钟节奏', () => {
  assert.equal(dueAtPremium(at(4, 0)), true);
  assert.equal(dueAtPremium(at(5, 45)), true);
  assert.equal(dueAtPremium(at(6, 14)), false);
  assert.equal(dueAtPremium(at(6, 15)), false);
});

test('白天 07-22 点每 30 分钟', () => {
  assert.equal(dueAtPremium(at(7, 0)), true);
  assert.equal(dueAtPremium(at(16, 30)), true);
  assert.equal(dueAtPremium(at(22, 0)), true);
  assert.equal(dueAtPremium(at(16, 15)), false);
});

test('夜间只在 23:00 与 03:00 跑', () => {
  assert.equal(dueAtPremium(at(23, 0)), true);
  assert.equal(dueAtPremium(at(3, 0)), true);
  for (const h of [23, 0, 1, 2, 3]) {
    assert.equal(dueAtPremium(at(h, 30)), false, `${h}:30 不应触发`);
  }
  assert.equal(dueAtPremium(at(0, 0)), false);
});

test('quietNow 覆盖 23:00-03:59', () => {
  for (const h of [23, 0, 3]) assert.equal(quietNow(at(h, 10)), true);
  for (const h of [4, 12, 22]) assert.equal(quietNow(at(h, 10)), false);
});

test('nextRun 对齐到下一个节奏边界', () => {
  assert.equal(hm(nextRun(at(16, 48))), '17:00');
  assert.equal(hm(nextRun(at(4, 1))), '04:15');
  assert.equal(hm(nextRun(at(6, 14, 30))), '06:30');
  assert.equal(hm(nextRun(at(22, 31))), '23:00');
  assert.equal(hm(nextRun(at(23, 1))), '03:00');
  assert.equal(hm(nextRun(at(2, 59))), '03:00');
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
  assert.equal(policy(), '04-06:14:15m,07-23:30m,night:23:00/03:00');
});
