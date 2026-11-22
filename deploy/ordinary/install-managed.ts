#!/usr/bin/env node
/** 普通版安装器（TS）：替代 install-managed.py，建立隔离的 shadow-only 运行时。 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Controller } from './manage.ts';
import * as base from '../nas/base-manage.ts';

const NODE_CANDIDATES = ['/vol3/1000/Docker/everydaytechnews-runtime/bin/node'];

function findNode(): string {
  const override = process.env.ETN_NODE;
  if (override && fs.existsSync(override)) return override;
  for (const candidate of NODE_CANDIDATES) if (fs.existsSync(candidate)) return candidate;
  return process.execPath;
}

function writeTsController(managed: string, source: string): void {
  if (!fs.existsSync(path.join(source, 'manage.ts')) || !fs.existsSync(path.join(source, '../nas/base-manage.ts'))) return;
  const ordinary = fs.readFileSync(path.join(source, 'manage.ts'), 'utf8').replace("from '../nas/base-manage.ts'", "from './base-manage.ts'");
  for (const [name, content] of [['base-manage.ts', fs.readFileSync(path.join(source, '../nas/base-manage.ts'), 'utf8')], ['manage.ts', ordinary]] as const) {
    const temp = path.join(managed, name + '.install');
    fs.writeFileSync(temp, content); fs.chmodSync(temp, 0o700); fs.renameSync(temp, path.join(managed, name));
  }
}

function runner(managed: string): string {
  return findNode() + ' --disable-warning=ExperimentalWarning ' + path.join(managed, 'manage.ts') + ' --root ' + managed;
}

function upgradeController(rootInput: string, tag: string): Record<string, unknown> {
  process.umask(0o077);
  const root = path.resolve(rootInput);
  const managed = path.join(root, 'managed');
  const source = path.dirname(path.resolve(process.argv[1]));
  const controller = new Controller(managed);
  if (base.protectedWindow()) throw new Error('controller_upgrade_deferred_morning_window');
  return base.withLock(path.join(managed, 'update.lock'), false, (acquired) => {
    if (!acquired) throw new Error('update_already_running');
    if (!base.version(tag)) throw new Error('controller_release_invalid');
    const info = controller.apiSync('releases/tags/' + tag) as Record<string, any>;
    if (info.draft || info.prerelease || !info.published_at) throw new Error('controller_release_invalid');
    const { sha, directory } = controller.source(tag);
    return base.withLock(controller.config.scheduler_lock, false, (locked) => {
      if (!locked) throw new Error('scheduler_busy');
      if (base.protectedWindow()) throw new Error('controller_upgrade_deferred_morning_window');
      const saved = path.join(managed, 'controller-backups', tag);
      fs.mkdirSync(saved, { recursive: false, mode: 0o700 });
      const legacy = [['manage.py', path.join(directory, 'deploy/ordinary/manage.py')], ['base-manage.py', path.join(directory, 'deploy/nas/manage.py')]];
      for (const [name] of legacy) fs.copyFileSync(path.join(managed, name), path.join(saved, name));
      for (const name of ['manage.ts', 'base-manage.ts', 'controller.json', 'verify-state.ts']) {
        if (fs.existsSync(path.join(managed, name))) fs.copyFileSync(path.join(managed, name), path.join(saved, name));
      }
      try {
        for (const [name, candidate] of legacy) {
          const temp = path.join(managed, name + '.install');
          fs.copyFileSync(candidate, temp); fs.renameSync(temp, path.join(managed, name));
        }
        fs.copyFileSync(path.join(directory, 'deploy/ordinary/verify-state.ts'), path.join(managed, 'verify-state.ts.install'));
        fs.renameSync(path.join(managed, 'verify-state.ts.install'), path.join(managed, 'verify-state.ts'));
        writeTsController(managed, path.join(directory, 'deploy/ordinary'));
        base.atomicWrite(path.join(managed, 'controller.json'), { source_sha: sha,
          manage_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(managed, 'manage.py'))).digest('hex'),
          base_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(managed, 'base-manage.py'))).digest('hex') });
      } catch (error) {
        for (const [name] of legacy) fs.copyFileSync(path.join(saved, name), path.join(managed, name));
        for (const name of ['manage.ts', 'base-manage.ts', 'controller.json']) if (fs.existsSync(path.join(saved, name))) fs.copyFileSync(path.join(saved, name), path.join(managed, name));
        throw error;
      }
      return { status: 'controller_upgraded', tag, sha };
    });
  }) as Record<string, unknown>;
}

function install(rootInput: string, tag: string): Record<string, unknown> {
  process.umask(0o077);
  const root = path.resolve(rootInput);
  const source = path.dirname(path.resolve(process.argv[1]));
  const managed = path.join(root, 'managed');
  if (fs.existsSync(path.join(managed, 'deployment.json'))) throw new Error('ordinary_already_managed');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const name of ['ordinary.env', 'archive.env']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, '', { mode: 0o600 });
    fs.chmodSync(file, 0o600);
  }
  const data = path.join(root, 'data');
  fs.mkdirSync(data, { recursive: true, mode: 0o700 });
  for (const name of ['news_archive', 'archive-sync']) fs.mkdirSync(path.join(data, name), { recursive: true, mode: 0o700 });
  fs.mkdirSync(managed, { recursive: true, mode: 0o700 });
  fs.copyFileSync(path.join(source, 'manage.py'), path.join(managed, 'manage.py'));
  fs.copyFileSync(path.join(source, '../nas/manage.py'), path.join(managed, 'base-manage.py'));
  fs.copyFileSync(path.join(source, 'verify-state.ts'), path.join(managed, 'verify-state.ts'));
  writeTsController(managed, source);
  base.atomicWrite(path.join(managed, 'config.json'), { component: 'ordinary-news', manifest: 'deploy/ordinary/release.json',
    dockerfile: 'deploy/ordinary/Dockerfile', workflow: 'ordinary-news.yml', image_repository: 'everyday-tech-news-ordinary',
    data, env_file: path.join(root, 'ordinary.env'), scheduler_lock: path.join(root, 'scheduler.lock'), state_lock: 'runtime.lock',
    resident_scheduler: true, node: findNode() });
  const controller = new Controller(managed);
  const { sha, directory } = controller.source(tag);
  const candidate = controller.build(tag, sha, directory);
  // 无网络、无凭据的初始化；既有状态不会被重新初始化。
  controller.command(['docker', 'run', '--rm', '--network', 'none', '--user', os.userInfo().uid + ':' + os.userInfo().gid,
    '-v', data + ':/data', candidate.image, 'init', '--data', '/data']);
  const activated = controller.activate(candidate);
  if (activated.status !== 'deployed') throw new Error('ordinary_install_activation_incomplete');
  base.atomicWrite(path.join(data, '.ordinary-authority.json'), { kind: 'ordinary_nas', schema_version: 1, installed_sha: sha });
  const config = base.readJson<Record<string, unknown>>(path.join(data, 'config.json'), {});
  if (config.mode !== 'shadow') throw new Error('ordinary_install_requires_shadow');
  const publicSource = path.join(managed, 'initial-archive-source');
  controller.command(['git', 'clone', '--depth', '1', 'https://github.com/' + base.REPO + '.git', publicSource]);
  base.copyTree(path.join(publicSource, 'news_archive'), path.join(data, 'news_archive'));
  fs.copyFileSync(path.join(publicSource, 'notifications.ini'), path.join(data, 'notifications.ini'));
  const tree = controller.command(['git', 'ls-tree', '-r', 'HEAD', '--', 'news_archive'], { cwd: publicSource });
  const files: Record<string, string> = {};
  for (const line of tree.split('\n')) if (line.trim()) { const [meta, name] = line.split('\t'); files[name] = meta.split(' ')[2]; }
  base.atomicWrite(path.join(data, 'archive-sync/baseline.json'), { files });
  const existing = spawnSync('crontab', ['-l'], { encoding: 'utf8' }).stdout ?? '';
  fs.writeFileSync(path.join(root, 'crontab-before.txt'), existing);
  // 出刊调度在镜像内常驻；crontab 只保留看门狗、更新、归档与日志轮转。
  const kept = existing.split('\n').filter((line) => !((line.includes(path.join(managed, 'manage.py')) || line.includes(path.join(managed, 'manage.ts'))) && line.includes(' run ')));
  let lines = kept.join('\n').replace(/\n+$/, '') + '\n# EverydayTechNews ordinary shadow; separate from premium\n';
  lines += '*/10 * * * * ' + runner(managed) + ' scheduler-up >/dev/null 2>&1\n';
  lines += '17 * * * * ' + runner(managed) + ' update >> ' + path.join(managed, 'updater.log') + ' 2>&1\n';
  lines += '40 6,8,12,20 * * * ' + runner(managed) + ' sync 1>/dev/null 2>> ' + path.join(managed, 'logs', 'sync.err') + '\n';
  lines += '30 4 * * 0 ' + path.join(os.homedir(), 'bin', 'etn-logrotate.sh') + ' ' + path.join(managed, 'logs') + ' >/dev/null 2>&1\n';
  const binDir = path.join(os.homedir(), 'bin');
  fs.mkdirSync(binDir, { recursive: true, mode: 0o700 });
  fs.copyFileSync(path.join(source, 'rotate-logs.sh'), path.join(binDir, 'etn-logrotate.sh'));
  fs.chmodSync(path.join(binDir, 'etn-logrotate.sh'), 0o755);
  const written = spawnSync('crontab', ['-'], { input: lines, encoding: 'utf8' });
  if (written.status !== 0) throw new Error('crontab_write_failed:' + String(written.stderr ?? '').slice(-120));
  base.atomicWrite(path.join(managed, 'controller.json'), { source_sha: sha,
    manage_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(managed, 'manage.py'))).digest('hex'),
    base_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(managed, 'base-manage.py'))).digest('hex') });
  return { status: 'installed_shadow', tag, sha, ordinary_legacy_actions_unchanged: true };
}

if (process.argv[1] && process.argv[1].endsWith('install-managed.ts')) {
  try {
    const args = process.argv.slice(2);
    const root = args.indexOf('--root'), tag = args.indexOf('--tag');
    if (root < 0 || tag < 0) throw new Error('usage: install.ts --root <dir> --tag <tag> [--upgrade-controller]');
    const result = args.includes('--upgrade-controller') ? upgradeController(args[root + 1], args[tag + 1]) : install(args[root + 1], args[tag + 1]);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) { console.error(String((error as Error).message || error)); process.exitCode = 1; }
}
