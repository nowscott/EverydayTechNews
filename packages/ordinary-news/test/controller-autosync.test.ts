import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Controller, withLock, lockHolder, pidAlive, CONTROLLER_FILES } from '../../../deploy/nas/base-manage.ts';

test('死进程留下的锁会立即回收，不用等满 staleMs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'etn-lock-'));
  const file = join(dir, 'update.lock');
  writeFileSync(file, JSON.stringify({ pid: 999999, at: new Date().toISOString() }));
  try {
    const started = Date.now();
    const value = withLock(file, false, (acquired) => acquired);
    assert.equal(value, true);
    assert.ok(Date.now() - started < 1000, '不应等待 1 小时 staleMs');
    assert.equal(existsSync(file), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('活着的持有者仍然阻塞非阻塞调用并返回 holder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'etn-lock-live-'));
  const file = join(dir, 'update.lock');
  writeFileSync(file, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  try {
    assert.equal(pidAlive(process.pid), true);
    assert.equal(lockHolder(file)?.pid, process.pid);
    const value = withLock(file, false, (acquired) => acquired);
    assert.equal(value, false);
    assert.equal(existsSync(file), true, '别人持有期间不能删锁');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('控制器文件与 release 不一致时自动同步并可重复执行', () => {
  const root = mkdtempSync(join(tmpdir(), 'etn-controller-'));
  try {
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(join(root, 'config.json'), JSON.stringify({ data: join(root, 'data') }));
    writeFileSync(join(root, 'manage.ts'), 'old manage');
    const controller = new Controller(root);
    const source = join(root, 'release');
    mkdirSync(join(source, 'deploy/nas'), { recursive: true });
    for (const name of CONTROLLER_FILES) writeFileSync(join(source, 'deploy/nas', name), 'new ' + name);

    const first = controller.syncController(source, 'news-engine-v9.9.9', 'abc123');
    assert.ok(first, '应报告同步');
    assert.ok((first!.files as string[]).includes('manage.ts'));
    assert.equal(readFileSync(join(root, 'manage.ts'), 'utf8'), 'new manage.ts');
    assert.equal(JSON.parse(readFileSync(join(root, 'controller.json'), 'utf8')).version, 'news-engine-v9.9.9');

    const second = controller.syncController(source, 'news-engine-v9.9.9', 'abc123');
    assert.equal(second, null, '一致时不应重复同步');

    // 普通版专用：manage.ts 的跨目录 import 必须改写成同目录后再落盘。
    writeFileSync(join(source, 'deploy/nas/manage.ts'), 'import base from ../nas/base-manage.ts');
    writeFileSync(join(root, 'manage.ts'), 'import base from ../nas/base-manage.ts');
    controller.controllerRewrite = (name, text) => name === 'manage.ts' ? text.replace('../nas/base-manage.ts', './base-manage.ts') : text;
    const third = controller.syncController(source, 'news-engine-v9.9.9', 'abc123');
    assert.ok(third, '改写后的内容与源不同，应再次同步');
    assert.equal(readFileSync(join(root, 'manage.ts'), 'utf8'), 'import base from ./base-manage.ts');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
