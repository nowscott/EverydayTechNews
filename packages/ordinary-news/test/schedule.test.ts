import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueAt, nextTick, quietNow } from '../src/schedule.ts';

test('morning window runs every even minute', () => {
  for (const minute of [0, 2, 10, 58]) assert.equal(dueAt(5, minute), true);
  assert.equal(dueAt(9, 58), true);
  assert.equal(dueAt(5, 1), false);
  assert.equal(dueAt(9, 57), false);
});

test('daytime outside the morning window runs at :07 and :37 only', () => {
  for (const hour of [10, 15, 22]) {
    assert.equal(dueAt(hour, 7), true);
    assert.equal(dueAt(hour, 37), true);
    assert.equal(dueAt(hour, 0), false);
    assert.equal(dueAt(hour, 30), false);
  }
});

test('夜间只保留 23:07 / 02:07 / 04:07 三轮', () => {
  assert.equal(dueAt(23, 7), true);
  assert.equal(dueAt(2, 7), true);
  assert.equal(dueAt(4, 7), true);
  for (const hour of [23, 0, 1, 2, 3, 4]) assert.equal(dueAt(hour, 37), false, `hour ${hour} :37 不应触发`);
  assert.equal(dueAt(0, 7), false);
  assert.equal(dueAt(1, 7), false);
  assert.equal(dueAt(3, 7), false);
});

test('quietNow 覆盖 23:00-04:59', () => {
  const at = (h: number) => new Date(2026, 10, 22, h, 30);
  for (const hour of [23, 0, 4]) assert.equal(quietNow(at(hour)), true);
  for (const hour of [5, 12, 22]) assert.equal(quietNow(at(hour)), false);
});

test('nextTick always lands on the next policy minute', () => {
  const cases: [number, number, number, number][] = [
    [4, 36, 5, 0], [4, 37, 5, 0], [4, 38, 5, 0], [9, 58, 10, 7], [10, 6, 10, 7], [10, 7, 10, 37],
    [23, 6, 23, 7], [23, 8, 2, 7], [0, 30, 2, 7], [2, 8, 4, 7],
  ];
  for (const [hour, minute, nextHour, nextMinute] of cases) {
    const from = new Date(2026, 10, 22, hour, minute, 30);
    const next = nextTick(from);
    assert.equal(next.getHours(), nextHour, `from ${hour}:${minute}`);
    assert.equal(next.getMinutes(), nextMinute, `from ${hour}:${minute}`);
    assert.equal(next.getSeconds(), 0);
    assert.ok(next.getTime() > from.getTime());
  }
});

test('nextTick from an exact due minute never repeats itself', () => {
  assert.ok(nextTick(new Date(2026, 10, 22, 5, 0, 0)).getMinutes() >= 2);
});
