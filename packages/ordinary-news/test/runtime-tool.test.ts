import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activate, artifact, checksumsUrl, current, rollback, shaFor, urls } from '../../../deploy/nas/runtime.ts';

function fakeRuntime(parent: string, name: string, version: string): string {
  const dir = join(parent, name, 'bin');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'node'), '#!/bin/sh\necho ' + version + '\n');
  chmodSync(join(dir, 'node'), 0o755);
  return join(parent, name);
}

test('产物名与镜像地址', () => {
  assert.equal(artifact('24.22.3'), 'node-v24.22.3-linux-x64.tar.xz');
  const list = urls('24.22.3');
  assert.equal(list.length, 2);
  assert.ok(list[0].startsWith('https://npmmirror.com/mirrors/node/v24.22.3/'));
  assert.ok(list[1].startsWith('https://nodejs.org/dist/v24.22.3/'));
  assert.equal(checksumsUrl('24.22.3'), 'https://nodejs.org/dist/v24.22.3/SHASUMS256.txt');
});

test('从 SHASUMS256.txt 取目标产物校验值', () => {
  const text = ['a'.repeat(64) + '  node-v24.22.3-darwin-arm64.tar.gz', 'b'.repeat(64) + '  node-v24.22.3-linux-x64.tar.xz', ''].join('\n');
  assert.equal(shaFor('24.22.3', text), 'b'.repeat(64));
  assert.throws(() => shaFor('24.22.4', text), /checksum_not_found/);
});

test('切换后版本一致，并保留旧目录用于回退', () => {
  const root = mkdtempSync(join(tmpdir(), 'etn-runtime-'));
  fakeRuntime(root, 'everydaytechnews-runtime', 'v1.0.0');
  const staging = fakeRuntime(root, 'stage', 'v2.0.0');
  const result = activate(root, staging, '2.0.0', 'v1.0.0');
  assert.equal(result.status, 'installed');
  assert.equal(result.version, 'v2.0.0');
  assert.ok(existsSync(join(root, 'everydaytechnews-runtime-1.0.0', 'bin/node')), '旧运行时保留');
  assert.equal(current(root).version, 'v2.0.0');
});

test('切换后版本不符时报错', () => {
  const root = mkdtempSync(join(tmpdir(), 'etn-runtime-'));
  const staging = fakeRuntime(root, 'stage', 'v9.9.9');
  assert.throws(() => activate(root, staging, '2.0.0', undefined), /runtime_version_mismatch/);
});

test('回退到上一版本目录', () => {
  const root = mkdtempSync(join(tmpdir(), 'etn-runtime-'));
  fakeRuntime(root, 'everydaytechnews-runtime-1.0.0', 'v1.0.0');
  fakeRuntime(root, 'everydaytechnews-runtime', 'v2.0.0');
  const result = rollback(root);
  assert.equal(result.status, 'rolled_back');
  assert.equal(result.version, 'v1.0.0');
  assert.equal(current(root).version, 'v1.0.0');
  assert.ok(existsSync(result.kept as string), '坏版本目录保留待查');
});
