#!/usr/bin/env node
// 版本一致性校验：版本源 / 包版本 / CHANGELOG 标题必须完全一致。
// 用法：node scripts/check-version.mjs [--component ordinary-news|news-engine|nas-dashboard]
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const COMPONENTS = {
  'ordinary-news': {
    manifest: 'deploy/ordinary/release.json',
    package: 'packages/ordinary-news/package.json',
    lock: 'packages/ordinary-news/package-lock.json',
    prefix: 'ordinary-news-v',
  },
  'news-engine': {
    manifest: 'deploy/nas/release.json',
    package: 'packages/news-engine/package.json',
    lock: 'packages/news-engine/package-lock.json',
    prefix: 'news-engine-v',
  },
  'nas-dashboard': {
    manifest: 'apps/nas-dashboard/package.json',
    package: 'apps/nas-dashboard/package.json',
    lock: 'apps/nas-dashboard/package-lock.json',
    prefix: 'nas-dashboard-v',
  },
  'subscription-web': {
    manifest: 'apps/subscription-web/package.json',
    package: 'apps/subscription-web/package.json',
    lock: 'apps/subscription-web/package-lock.json',
    prefix: 'subscription-web-v',
  },
};

const args = process.argv.slice(2);
const index = args.indexOf('--component');
const selected = index >= 0 && args[index + 1] ? [args[index + 1]] : Object.keys(COMPONENTS);

const json = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const failures = [];
const found = new Map();

for (const name of selected) {
  const spec = COMPONENTS[name];
  if (!spec) {
    failures.push(`未知组件：${name}（可选：${Object.keys(COMPONENTS).join(', ')}）`);
    continue;
  }
  for (const path of [spec.manifest, spec.package, spec.lock]) {
    if (!existsSync(resolve(root, path))) failures.push(`${name}: 缺少 ${path}`);
  }
  if (failures.length) continue;

  const versions = {
    manifest: json(spec.manifest).version,
    package: json(spec.package).version,
    lock: json(spec.lock).version,
  };
  const distinct = new Set(Object.values(versions));
  if (distinct.size !== 1 || ![...distinct][0]) {
    failures.push(`${name}: 版本不一致 ${JSON.stringify(versions)}`);
    continue;
  }

  const version = [...distinct][0];
  if (!/^\d+\.\d+\.\d+(-rc\.\d+)?$/.test(version)) {
    failures.push(`${name}: 版本格式非法 ${version}`);
    continue;
  }

  const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');
  const heading = `## ${spec.prefix}${version}`;
  if (!changelog.includes(heading)) failures.push(`${name}: CHANGELOG 缺少标题 "${heading}"`);

  if (failures.length === 0) console.log(`OK ${heading}`);
  found.set(name, version);
}

if (found.size > 1) {
  const versions = new Set(found.values());
  if (versions.size !== 1) failures.push(`各组件版本未统一 ${JSON.stringify(Object.fromEntries(found))}`);
}

if (failures.length) {
  for (const message of failures) console.error(`FAIL ${message}`);
  process.exit(1);
}
