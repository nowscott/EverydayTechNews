#!/usr/bin/env node
/** 高级版 NAS 本地健康检查（TS）：替代 health-check.py，只读部署状态并在业务容器内跑 health.ts。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { withLock, readJson, atomicWrite, shanghai } from './base-manage.ts';

interface Config { data: string; env_file: string; [key: string]: unknown }
interface State { active: { tag: string; sha: string; image: string; source: string } }

function root(args: string[]): string {
  const index = args.indexOf('--root');
  if (index < 0 || !args[index + 1]) throw new Error('root_required');
  return path.resolve(args[index + 1]);
}

function command(args: string[], cwd?: string, env?: Record<string, string>): string {
  const result = spawnSync(args[0], args.slice(1), { cwd, env: { ...process.env, ...(env ?? {}) }, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('command_failed:' + args[0] + ':' + String(result.stderr ?? '').slice(-160));
  return String(result.stdout ?? '').trim();
}

// 代理失效是高级版历史上最常见的静默故障：先探活代理，再判服务。
export function parseProxyEnv(text: string): { proxy: string | null } {
  const match = text.match(/^\s*(?:export\s+)?(?:HTTP_PROXY|HTTPS_PROXY|http_proxy|https_proxy)\s*=\s*([^\s#]+)/m);
  return { proxy: match ? match[1].replace(/^['"]|['"]$/g, '') : null };
}

function proxyProbe(envFile: string): Record<string, unknown> {
  try {
    const { proxy } = parseProxyEnv(fs.readFileSync(envFile, 'utf8'));
    if (!proxy) return { status: 'no_proxy_configured' };
    const result = spawnSync('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '8', '--proxy', proxy, 'https://www.ithome.com/'], { encoding: 'utf8' });
    const code = Number(result.stdout ?? 0);
    return { status: code >= 200 && code < 400 ? 'ok' : 'proxy_unreachable', http_code: code || null, proxy };
  } catch (error) { return { status: 'probe_error', error: String((error as Error).message ?? error).slice(0, 120) }; }
}

export function check(directory: string): Record<string, unknown> {
  const config = readJson<Config | null>(path.join(directory, 'config.json'), null)!;
  const state = readJson<State | null>(path.join(directory, 'deployment.json'), null)!;
  const current = state.active;
  if (!current) throw new Error('no_active_release');
  return withLock(path.join(directory, 'health.lock'), false, (acquired) => {
    if (!acquired) return { status: 'health_busy' };
    const source = current.source;
    if (command(['git', 'rev-parse', 'HEAD'], source) !== current.sha
      || command(['git', 'status', '--porcelain', '--untracked-files=all'], source)) throw new Error('health_release_source_modified');
    const env = { NAS_IMAGE: current.image, NAS_DATA_DIR: config.data, NAS_ENV_FILE: config.env_file,
      NAS_UID: String(os.userInfo().uid), NAS_GID: String(os.userInfo().gid) };
    const proxy = proxyProbe(config.env_file);
    const output = command(['docker', 'compose', '--env-file', config.env_file,
      '-f', path.join(source, 'deploy/nas/compose.managed.yaml'), '-f', path.join(source, 'deploy/nas/compose.proxy.yaml'),
      'run', '--rm', '-e', 'NEWS_HEALTH_AUTHORITY=nas', '--entrypoint', 'node', 'premium',
      'packages/news-engine/src/health.ts', '/data'], undefined, env);
    const health = JSON.parse(output) as Record<string, unknown>;
    return { ...health, proxy, status: proxy.status === 'proxy_unreachable' ? 'degraded_proxy_unreachable' : health.status };
  }) as Record<string, unknown>;
}

function install(directory: string): Record<string, unknown> {
  const target = path.join(directory, 'health-check.ts');
  const temp = target + '.tmp';
  fs.copyFileSync(path.resolve(process.argv[1]), temp);
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, target);
  const existing = command(['crontab', '-l']);
  const backup = path.join(directory, 'crontab-before-health-' + shanghai().replace(/[-:]/g, '').slice(0, 15) + '.txt');
  fs.writeFileSync(backup, existing);
  const lines = existing.split('\n').filter((line) => !line.includes(target) && !line.includes('health-check.py'));
  lines.push('10 9-23 * * * /vol3/1000/Docker/everydaytechnews-runtime/bin/node --disable-warning=ExperimentalWarning '
    + target + ' --root ' + directory + ' check >> ' + path.join(directory, 'health.log') + ' 2>&1');
  const written = spawnSync('crontab', ['-'], { input: lines.join('\n') + '\n', encoding: 'utf8' });
  if (written.status !== 0) throw new Error('crontab_write_failed:' + String(written.stderr ?? '').slice(-120));
  atomicWrite(path.join(directory, 'health-controller.json'), {
    source_sha: (readJson<State | null>(path.join(directory, 'deployment.json'), null)!).active?.sha ?? null,
    schedule: 'hourly 09:10-23:10 Asia/Shanghai', normal_notifications: false });
  return { status: 'health_installed_on_nas', normal_notifications: false };
}

if (process.argv[1] && process.argv[1].endsWith('health-check.ts')) {
  try {
    const directory = root(process.argv.slice(2));
    const operation = process.argv.slice(2).filter((value, index, all) => !value.startsWith('--') && all[index - 1] !== '--root').pop();
    if (!operation || !['install', 'check'].includes(operation)) throw new Error('operation_invalid');
    process.stdout.write(JSON.stringify(operation === 'install' ? install(directory) : check(directory)) + '\n');
  } catch (error) { console.error(String((error as Error).message || error)); process.exitCode = 1; }
}
