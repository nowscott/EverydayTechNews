#!/usr/bin/env node
/** NAS 高级版安装器（TS）：替代 install-managed.py，首次接管或显式升级控制器。 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Controller, atomicWrite, readJson, withLock, protectedWindow, version, setPrefix, shanghai, schedulerLines } from './base-manage.ts';

interface Options { legacy: string; root: string; upgrade: boolean }

function parse(args: string[]): Options {
  const legacy = args.indexOf('--legacy'), root = args.indexOf('--root');
  if (legacy < 0 || root < 0) throw new Error('usage: install-managed.ts --legacy <dir> --root <dir> [--upgrade-controller]');
  return { legacy: path.resolve(args[legacy + 1]), root: path.resolve(args[root + 1]), upgrade: args.includes('--upgrade-controller') };
}

function command(args: string[]): string {
  const result = spawnSync(args[0], args.slice(1), { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('command_failed:' + args[0] + ':' + String(result.stderr ?? '').slice(-160));
  return String(result.stdout ?? '').trim();
}

function copyFile(source: string, destination: string): void {
  const temp = destination + '.install';
  fs.copyFileSync(source, temp); fs.chmodSync(temp, 0o600); fs.renameSync(temp, destination);
}

const CONTROLLER_FILES = ['manage.ts', 'verify-state.ts', 'compose.managed.yaml', 'compose.proxy.yaml'];

function upgrade(options: Options): Record<string, unknown> {
  const source = path.dirname(path.resolve(process.argv[1]));
  const release = readJson<{ version: string }>(path.join(source, 'release.json'), { version: '' });
  setPrefix('news-engine-v');
  const controller = new Controller(options.root);
  if (protectedWindow()) throw new Error('controller_upgrade_deferred_morning_window');
  const tag = 'news-engine-v' + release.version;
  if (!version(tag)) throw new Error('controller_release_invalid');
  return withLock(path.join(options.root, 'update.lock'), false, (acquired) => {
    if (!acquired) throw new Error('update_already_running');
    const info = controller.apiSync('releases/tags/' + tag) as Record<string, any>;
    if (info.draft || info.prerelease || !info.published_at) throw new Error('controller_release_not_published');
    const { sha, directory } = controller.source(tag);
    return withLock(controller.config.scheduler_lock, false, (locked) => {
      if (!locked) throw new Error('scheduler_busy');
      if (protectedWindow()) throw new Error('controller_upgrade_deferred_morning_window');
      const backup = path.join(options.root, 'controller-backups', tag);
      fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
      for (const name of CONTROLLER_FILES) {
        if (fs.existsSync(path.join(options.root, name))) fs.copyFileSync(path.join(options.root, name), path.join(backup, name));
        copyFile(path.join(directory, 'deploy/nas', name), path.join(options.root, name));
      }
      atomicWrite(path.join(options.root, 'controller.json'), { version: tag, sha,
        manage_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(options.root, 'manage.ts'))).digest('hex') });
      return { status: 'controller_upgraded', tag, sha, backup };
    });
  }) as Record<string, unknown>;
}

async function install(options: Options): Promise<Record<string, unknown>> {
  const source = path.dirname(path.resolve(process.argv[1]));
  const privateRoot = path.join(options.legacy, 'deploy/nas');
  const exists = fs.existsSync(options.root);
  if (exists && !options.upgrade) throw new Error('managed_root_exists; use --upgrade-controller');
  if (!fs.existsSync(path.join(privateRoot, 'data/durable/state.json')) || !fs.existsSync(path.join(privateRoot, '.env'))) throw new Error('existing_private_state_and_env_required');
  fs.mkdirSync(options.root, { recursive: true, mode: 0o700 });
  if (!exists) for (const name of CONTROLLER_FILES) copyFile(path.join(source, name), path.join(options.root, name));

  if (exists) {
    upgrade(options);
  } else {
    const image = command(['docker', 'image', 'inspect', 'everyday-tech-news-test:local', '--format', '{{.Id}}']);
    command(['docker', 'tag', image, 'everyday-tech-news-test:legacy-20261019']);
    atomicWrite(path.join(options.root, 'config.json'), { data: path.join(privateRoot, 'data'), env_file: path.join(privateRoot, '.env'),
      scheduler_lock: path.join(privateRoot, '.scheduler.lock') });
    const legacy = { tag: 'legacy-20261019', image, image_tag: 'everyday-tech-news-test:legacy-20261019', source: options.legacy,
      legacy: true, sha: null, schema: 1 };
    atomicWrite(path.join(options.root, 'deployment.json'), { active: legacy, history: [legacy], blocked: {}, high_water: [0, 0, 0] });
    fs.writeFileSync(path.join(options.root, 'crontab-before.txt'), spawnSync('crontab', ['-l'], { encoding: 'utf8' }).stdout ?? '');
  }

  const controller = new Controller(options.root);
  const result = await controller.update();
  if (!['deployed', 'up_to_date'].includes(String(result.status))) throw new Error('deployment_incomplete:' + JSON.stringify(result));

  const runner = process.execPath + ' --disable-warning=ExperimentalWarning ' + path.join(options.root, 'manage.ts') + ' --root ' + options.root;
  const present = spawnSync('crontab', ['-l'], { encoding: 'utf8' }).stdout ?? '';
  const lines = schedulerLines(present, privateRoot, options.root, runner);
  const written = spawnSync('crontab', ['-'], { input: lines.join('\n').replace(/\n+$/, '') + '\n', encoding: 'utf8' });
  if (written.status !== 0) throw new Error('crontab_write_failed:' + String(written.stderr ?? '').slice(-120));
  try { controller.schedulerService('up'); } catch (error) { controller.event('scheduler_service_failed', { error: String((error as Error).message ?? error).slice(0, 200) }); }
  return { status: 'installed', active: controller.state().active, scheduler: controller.schedulerStatus(), automatic_updates: true, at: shanghai() };
}

if (process.argv[1] && process.argv[1].endsWith('install-managed.ts')) {
  await (async () => { try {
    const options = parse(process.argv.slice(2));
    const result = options.upgrade ? upgrade(options) : await install(options);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) { console.error(String((error as Error).message || error)); process.exitCode = 1; }
})();
}
