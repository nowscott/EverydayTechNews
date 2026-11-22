import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startupTickEnabled } from '../src/schedule.ts';
import { parseProxyEnv } from '../../../deploy/nas/health-check.ts';
import { schedulerHealth } from '../../../deploy/nas/base-manage.ts';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const compose = readFileSync(new URL('../../../deploy/nas/compose.managed.yaml', import.meta.url), 'utf8');

test('普通版默认启动即跑一轮，可显式关闭', () => {
  assert.equal(startupTickEnabled([]), true);
  assert.equal(startupTickEnabled(['--data', '/data']), true);
  assert.equal(startupTickEnabled(['--no-startup-tick']), false);
});

test('高级版 compose 给足临时空间与堆，避免 SQLITE_FULL / OOM', () => {
  assert.match(compose, /\/tmp:size=1g,mode=1777/);
  assert.match(compose, /NODE_OPTIONS: --max-old-space-size=2560/);
  assert.doesNotMatch(compose, /\/tmp:size=128m/);
});

test('高级版常驻调度进 compose，替代 crontab', () => {
  assert.match(compose, /container_name: etn-premium-scheduler/);
  assert.match(compose, /packages\/news-engine\/src\/daemon\.ts/);
  assert.match(compose, /restart: unless-stopped/);
});

test('代理探活能从 env 文件里取到出口', () => {
  assert.deepEqual(parseProxyEnv('HTTP_PROXY=http://Clash:secret@192.168.31.10:7890\n'), { proxy: 'http://Clash:secret@192.168.31.10:7890' });
  assert.deepEqual(parseProxyEnv('export HTTPS_PROXY="http://127.0.0.1:7890"\nOTHER=1'), { proxy: 'http://127.0.0.1:7890' });
  assert.deepEqual(parseProxyEnv('TZ=Asia/Shanghai\n'), { proxy: null });
});

test('看门狗按心跳判活：缺心跳 / 心跳过期都算不健康', () => {
  const now = new Date('2026-11-22T18:30:00+08:00');
  const fresh = schedulerHealth({ scheduler: { heartbeat_at: '2026-11-22T18:29:20+08:00' } }, now);
  assert.equal(fresh.healthy, true);
  assert.ok(fresh.heartbeat_age_ms !== null && fresh.heartbeat_age_ms < 60000);
  const stale = schedulerHealth({ scheduler: { heartbeat_at: '2026-11-22T18:10:00+08:00' } }, now);
  assert.equal(stale.healthy, false);
  assert.equal(stale.reason, 'heartbeat_stale');
  assert.deepEqual(schedulerHealth(null, now), { healthy: false, heartbeat_age_ms: null, reason: 'heartbeat_missing' });
});
