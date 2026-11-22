#!/usr/bin/env node
/** 看板安装器（TS）：从固定镜像 digest 安装，并校验镜像版本与源码版本一致。与 install.py 对齐。 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;
const NODE_BIN = '/vol3/1000/Docker/everydaytechnews-runtime/bin/node';
const DIGEST = /^sha256:[0-9a-f]{64}$/;

interface Args {
  root: string; image: string; bind: string; port: number; ordinaryManaged: string; premiumManaged: string;
  sourceCommit: string; check: boolean;
}

function fail(reason: string): never { throw new Error(reason); }

function run(args: string[], input?: string): string {
  const result = spawnSync(args[0], args.slice(1), { input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) fail('command_failed:' + args.slice(0, 3).join(' '));
  return (result.stdout || '').trim();
}

function readJson<T>(file: string): T { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; }

function atomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.' + crypto.randomBytes(16).toString('hex') + '.tmp';
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}

/** 镜像内 /app/package.json 的版本必须等于源码里的 apps/nas-dashboard 版本。 */
function verifyImage(image: string, sourceVersion: string): string {
  if (!DIGEST.test(image)) fail('image_digest_required');
  const inspected = JSON.parse(run(['docker', 'image', 'inspect', image]) as string)[0];
  if (inspected.Id !== image) fail('image_digest_mismatch');
  const inside = run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true', '--user', String(os.userInfo().uid) + ':' + String(os.userInfo().gid),
    '--entrypoint', 'node', image, '-e', "console.log(require('/app/package.json').version)"]);
  if (inside !== sourceVersion) fail('image_version_mismatch:' + inside + '!=' + sourceVersion);
  return inside;
}

function parse(argv: string[]): Args {
  const take = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    if (index < 0) return undefined;
    const value = argv[index + 1];
    if (value === undefined) fail('value_required:' + name);
    argv.splice(index, 2);
    return value;
  };
  const flags = (name: string): boolean => {
    const index = argv.indexOf(name);
    if (index < 0) return false;
    argv.splice(index, 1);
    return true;
  };
  const root = take('--root') ?? fail('root_required');
  const image = take('--image') ?? fail('image_required');
  const bind = take('--bind') ?? fail('bind_required');
  const port = Number(take('--port') ?? '3080');
  return {
    root, image, bind, port,
    ordinaryManaged: take('--ordinary-managed') ?? '/vol3/1000/Docker/everydaytechnews-ordinary/managed',
    premiumManaged: take('--premium-managed') ?? '/vol3/1000/Docker/everydaytechnews-managed',
    sourceCommit: take('--source-commit') ?? fail('source_commit_required'),
    check: flags('--check'),
  };
}

function install(args: Args): Record<string, unknown> {
  process.umask(0o077);
  const source = path.dirname(path.resolve(process.argv[1]));
  const sourceVersion = readJson<{ version: string }>(path.join(source, '..', '..', 'apps/nas-dashboard/package.json')).version;
  const version = verifyImage(args.image, sourceVersion);

  const root = path.resolve(args.root);
  if (fs.existsSync(root)) fail('dashboard_root_exists');
  // compose.yaml 项目名固定：若已有实例占着，直接拒绝，避免把生产容器挪走。
  const owners = run(['docker', 'ps', '-a', '--filter', 'label=com.docker.compose.project=everyday-tech-news-dashboard',
    '--format', '{{.Label "com.docker.compose.project.working_dir"}}']).split('\n').filter(Boolean);
  if (owners.some((dir) => path.resolve(dir) !== root)) fail('dashboard_project_in_use:' + owners[0]);
  const data = [args.ordinaryManaged, args.premiumManaged].map((managed) => {
    const config = readJson<{ data: string }>(path.join(managed, 'config.json'));
    const resolved = path.resolve(config.data);
    if (!fs.existsSync(path.join(resolved, 'state.sqlite3'))) fail('business_data_unavailable');
    return resolved;
  });
  const cron = run(['crontab', '-l']);
  const managers: Array<[string, 'ordinary' | 'premium']> = [[args.ordinaryManaged, 'ordinary'], [args.premiumManaged, 'premium']];
  for (const [managed, component] of managers) {
    const found = cron.split('\n').some((line) => {
      if (!(line.includes(managed + '/manage.py') || line.includes(managed + '/manage.ts'))) return false;
      // 普通版自 2.7.2 起由镜像内常驻调度出刊，cron 只留看门狗；高级版仍是 cron 驱动。
      return component === 'ordinary' ? (line.includes(' run ') || line.includes(' scheduler-up ')) : line.includes(' run ');
    });
    if (!found) fail('expected_scheduler_command_not_found:' + component);
  }
  if (args.check) return { status: 'check_passed', version, image: args.image, source_commit: args.sourceCommit };

  fs.mkdirSync(root, { mode: 0o700 });
  for (const name of ['auth', 'runtime/ordinary', 'runtime/premium', 'deployment/ordinary', 'deployment/premium', 'bodies', 'snapshots']) {
    fs.mkdirSync(path.join(root, name), { recursive: true, mode: 0o700 });
  }
  for (const name of ['compose.yaml', 'record-run.ts', 'record-run.py']) {
    const from = path.join(source, name);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(root, name));
  }
  const password = crypto.randomBytes(18).toString('base64url');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = 'scrypt:' + salt + ':' + crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  fs.writeFileSync(path.join(root, 'dashboard.env'), 'DASHBOARD_PASSWORD_HASH=' + hash + '\n', { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'proxy.env'), '', { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'initial-password.txt'), password + '\n', { mode: 0o600 });
  const values: Record<string, string> = {
    DASHBOARD_IMAGE: args.image, DASHBOARD_ROOT: root, DASHBOARD_BIND_IP: args.bind, DASHBOARD_PORT: String(args.port),
    DASHBOARD_ORDINARY_DATA: data[0], DASHBOARD_PREMIUM_DATA: data[1],
    DASHBOARD_UID: String(os.userInfo().uid), DASHBOARD_GID: String(os.userInfo().gid),
  };
  fs.writeFileSync(path.join(root, 'compose.env'), Object.entries(values).map(([key, value]) => key + '=' + value + '\n').join(''), { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'crontab-before.txt'), cron + '\n', { mode: 0o600 });
  for (const [component, managed] of [['ordinary', args.ordinaryManaged], ['premium', args.premiumManaged]] as const) {
    const active = readJson<{ active: Record<string, unknown> }>(path.join(managed, 'deployment.json')).active;
    atomic(path.join(root, 'deployment', component, 'deployment.json'), { active: { tag: active.tag, sha: active.sha, deployed_at: active.deployed_at } });
  }
  const compose = ['docker', 'compose', '--env-file', path.join(root, 'compose.env'), '-f', path.join(root, 'compose.yaml')];
  run([...compose, 'config', '--quiet']);
  run([...compose, 'up', '-d', '--wait', '--wait-timeout', '90']);

  const useTs = fs.existsSync(path.join(root, 'record-run.ts')) && fs.existsSync(NODE_BIN);
  const binary = useTs ? NODE_BIN + ' --disable-warning=ExperimentalWarning' : '/usr/bin/python3';
  const tool = useTs ? 'record-run.ts' : 'record-run.py';
  let patched = cron.split('\n').map((line) => {
    for (const [component, managed] of [['ordinary', args.ordinaryManaged], ['premium', args.premiumManaged]] as const) {
      if (!(line.includes(managed + '/manage.py') || line.includes(managed + '/manage.ts')) || !line.includes(' run ') || line.includes('record-run.')) continue;
      const match = /^(\S+ \S+ \S+ \S+ \S+) (.+)$/.exec(line);
      if (!match) continue;
      const observer = binary + ' ' + path.join(root, tool) + ' --root ' + root + ' --component ' + component +
        ' --deployment ' + path.join(managed, 'deployment.json') + ' --';
      return match[1] + ' ' + observer + ' ' + match[2];
    }
    return line;
  }).join('\n') + '\n';
  const latest = run(['crontab', '-l']);
  if (latest !== cron) fail('crontab_changed_during_installation');
  run(['crontab', '-'], patched);
  atomic(path.join(root, 'installation.json'), {
    version, installed_at: new Date(Date.now() + SHANGHAI_OFFSET_MS).toISOString().replace('Z', '+08:00'),
    image: args.image, url: 'http://' + args.bind + ':' + args.port, source_commit: args.sourceCommit,
  });
  return { url: 'http://' + args.bind + ':' + args.port, password_file: path.join(root, 'initial-password.txt'), cron_backup: path.join(root, 'crontab-before.txt') };
}

if (process.argv[1] && process.argv[1].endsWith('install.ts')) {
  try { console.log(JSON.stringify(install(parse(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(String((error as Error).message || error)); process.exitCode = 1; }
}
