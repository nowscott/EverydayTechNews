#!/usr/bin/env node
/**
 * 看板升级器（TS）：从 GitHub tag 拉源码 → 构建镜像 → 记录部署 → 切换 compose → 健康校验，失败自动回滚。
 *
 * 用法：
 *   upgrade.ts --root <dashboard root> --tag nas-dashboard-v2.7.17 [--dry-run]
 *   upgrade.ts --root <dashboard root> --rollback [--dry-run]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const OFFSET_MS = 8 * 3600 * 1000;
const REPO = 'nowscott/EverydayTechNews';
const IMAGE_REPO = 'everyday-tech-news-dashboard';
const HISTORY_KEEP = 3;

interface Deployment { version: string; tag: string; image: string; image_tag: string; deployed_at: string; url?: string }

interface Installation { version?: string; image?: string; url?: string; history?: Deployment[] }

function fail(message: string): never { throw new Error(message); }
function shanghai(): string { return new Date(Date.now() + OFFSET_MS).toISOString().replace('Z', '+08:00'); }
function stamp(): string { return new Date(Date.now() + OFFSET_MS).toISOString().replace(/[-:]/g, '').replace('+08:00', '').replace('T', 'T'); }

function run(args: string[], options: { cwd?: string; capture?: boolean } = {}): string {
  const result = spawnSync(args[0], args.slice(1), {
    cwd: options.cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    stdio: options.capture === false ? ['ignore', 'inherit', 'inherit'] : ['pipe', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) fail('command_failed:' + args.slice(0, 3).join(' '));
  return (result.stdout || '').trim();
}

function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return fallback; }
}

function atomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}

function sha256(file: string): string { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function parse(argv: string[]) {
  const take = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    if (index < 0) return undefined;
    const value = argv[index + 1];
    if (value === undefined) fail('value_required:' + name);
    argv.splice(index, 2);
    return value;
  };
  const flag = (name: string): boolean => { const index = argv.indexOf(name); if (index < 0) return false; argv.splice(index, 1); return true; };
  return {
    root: path.resolve(take('--root') ?? fail('root_required')),
    tag: take('--tag'),
    rollback: flag('--rollback'),
    dryRun: flag('--dry-run'),
    tokenFile: take('--token-file') ?? '/vol3/1000/Docker/everydaytechnews-ordinary/archive.env',
    healthTimeout: Number(take('--health-timeout') ?? '90'),
  };
}

function githubToken(file: string): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (!fs.existsSync(file)) fail('github_token_required');
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = /^(?:ARCHIVE_)?GITHUB_TOKEN=(.+)$/.exec(line.trim());
    if (match) return match[1];
  }
  return fail('github_token_required');
}

/** 看板 root 的 proxy.env 里通常有 NAS 本机代理；下载 GitHub 源码必须走它。 */
function proxyFor(root: string): string | null {
  const file = path.join(root, 'proxy.env');
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = /^(?:HTTPS_PROXY|https_proxy|HTTP_PROXY|http_proxy)=(.+)$/.exec(line.trim());
    if (match) return match[1];
  }
  return null;
}

/** 下载 tag 源码并解包，返回解出来的根目录与临时目录。 */
function fetchSource(tag: string, token: string, proxy: string | null): { dir: string; temp: string } {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'etn-dashboard-'));
  const archive = path.join(temp, 'src.tar.gz');
  const curl = ['curl', '-sSL', '--fail', ...(proxy ? ['-x', proxy] : ['--noproxy', '*']), '-H', 'Authorization: Bearer ' + token, '-o', archive,
    'https://api.github.com/repos/' + REPO + '/tarball/' + tag];
  run(curl);
  run(['tar', '-xzf', archive, '-C', temp]);
  const entries = fs.readdirSync(temp, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  if (entries.length !== 1) fail('archive_layout_invalid');
  return { dir: path.join(temp, entries[0].name), temp };
}

/** tag 后缀必须等于看板 package.json 的版本，避免发错版本。 */
function sourceVersion(dir: string, tag: string): string {
  const version = readJson<{ version?: string }>(path.join(dir, 'apps/nas-dashboard/package.json'), {}).version;
  if (!version) fail('dashboard_version_missing');
  if (tag !== 'nas-dashboard-v' + version) fail('tag_version_mismatch:' + tag + '!=' + version);
  return version;
}

function composeEnv(root: string): { file: string; values: Record<string, string>; raw: string } {
  const file = path.join(root, 'compose.env');
  const raw = fs.readFileSync(file, 'utf8');
  const values: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index > 0) values[line.slice(0, index)] = line.slice(index + 1);
  }
  return { file, values, raw };
}

function writeComposeEnv(file: string, raw: string, updates: Record<string, string>): void {
  const next = raw.split('\n').map((line) => {
    const index = line.indexOf('=');
    const key = index > 0 ? line.slice(0, index) : '';
    return updates[key] !== undefined ? key + '=' + updates[key] : line;
  }).join('\n');
  fs.writeFileSync(file, next, { mode: 0o600 });
}

function compose(root: string, args: string[], dryRun: boolean): void {
  const base = ['docker', 'compose', '--env-file', path.join(root, 'compose.env'), '-f', path.join(root, 'compose.yaml'), ...args];
  if (args[0] === 'config') { run(base); return; }
  if (dryRun) return;
  run(base, { capture: false });
}

/** 轮询 /api/health，版本对得上才算部署成功。 */
function verifyHealth(url: string, version: string, timeoutSeconds: number): void {
  const target = url.replace(/\/+$/, '') + '/api/health';
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const result = spawnSync('curl', ['-sS', '--noproxy', '*', target], { encoding: 'utf8', timeout: 10_000 });
    try {
      const body = JSON.parse(result.stdout || '{}');
      if (body.version === version) return;
    } catch { /* 还没起来，继续等 */ }
    spawnSync('sleep', ['2']);
  }
  fail('health_version_mismatch:' + version);
}

function deploy(root: string, record: Deployment, installation: Installation, backupDir: string, dryRun: boolean, healthTimeout: number): void {
  const envFile = path.join(root, 'compose.env');
  const installationFile = path.join(root, 'installation.json');
  const beforeEnv = fs.readFileSync(envFile, 'utf8');
  const beforeInstallation = fs.readFileSync(installationFile, 'utf8');
  try {
    writeComposeEnv(envFile, beforeEnv, { DASHBOARD_IMAGE: 'sha256:' + record.image.replace(/^sha256:/, '') });
    compose(root, ['config', '--quiet'], false);
    compose(root, ['up', '-d', '--remove-orphans'], dryRun);
    if (!dryRun) verifyHealth(record.url ?? installation.url ?? fail('dashboard_url_missing'), record.version, healthTimeout);
    if (!dryRun) {
      const previous = { ...installation } as Deployment & Record<string, unknown>;
      delete (previous as { history?: Deployment[] }).history;
      atomic(installationFile, {
        ...installation,
        version: record.version, tag: record.tag, image: record.image, image_tag: record.image_tag,
        deployed_at: record.deployed_at, url: record.url ?? installation.url,
        source_commit: record.tag,
        history: [previous, ...(installation.history ?? [])].slice(0, HISTORY_KEEP + 1),
      });
    }
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(backupDir, 'compose.env'), beforeEnv, { mode: 0o600 });
    fs.writeFileSync(path.join(backupDir, 'installation.json'), beforeInstallation, { mode: 0o600 });
  } catch (error) {
    fs.writeFileSync(envFile, beforeEnv, { mode: 0o600 });
    fs.writeFileSync(installationFile, beforeInstallation, { mode: 0o600 });
    try { compose(root, ['up', '-d', '--remove-orphans'], false); } catch { /* 回滚失败也要把原始错误抛出 */ }
    throw error;
  }
}

function upgrade(args: ReturnType<typeof parse>): Record<string, unknown> {
  process.umask(0o077);
  const root = args.root;
  const installationFile = path.join(root, 'installation.json');
  const installation = readJson<Installation>(installationFile, {});
  if (!installation.image) fail('installation_missing');
  const backups = path.join(root, 'installations');

  if (args.rollback) {
    const previous = installation.history?.[0];
    if (!previous) fail('rollback_target_missing');
    if (args.dryRun) return { status: 'dry_run_rollback', target: previous };
    deploy(root, previous, installation, path.join(backups, stamp()), false, args.healthTimeout);
    return { status: 'rolled_back', target: previous };
  }

  if (!args.tag) fail('tag_required');
  const source = fetchSource(args.tag, githubToken(args.tokenFile), proxyFor(root));
  const backupDir = path.join(backups, stamp());
  try {
    const version = sourceVersion(source.dir, args.tag);
    const sourceCompose = path.join(source.dir, 'deploy/dashboard/compose.yaml');
    const rootCompose = path.join(root, 'compose.yaml');
    const composeChanged = !fs.existsSync(rootCompose) || sha256(sourceCompose) !== sha256(rootCompose);
    const imageTag = IMAGE_REPO + ':' + args.tag;

    if (args.dryRun) return { status: 'dry_run', tag: args.tag, version, image_tag: imageTag, compose_changed: composeChanged, root };

    if (composeChanged) {
      fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      if (fs.existsSync(rootCompose)) fs.copyFileSync(rootCompose, path.join(backupDir, 'compose.yaml'));
      fs.copyFileSync(sourceCompose, rootCompose);
    }
    run(['docker', 'build', '--build-arg', 'NODE_IMAGE=node:24-bookworm-slim',
      '--label', 'org.opencontainers.image.version=' + version,
      '--label', 'org.opencontainers.image.revision=' + args.tag,
      '-f', 'deploy/dashboard/Dockerfile', '-t', imageTag, '.'], { cwd: source.dir, capture: false });
    const image = run(['docker', 'image', 'inspect', imageTag, '--format', '{{.Id}}']);
    const record: Deployment = {
      version, tag: args.tag, image, image_tag: imageTag,
      deployed_at: shanghai(), url: installation.url,
    };
    deploy(root, record, installation, backupDir, false, args.healthTimeout);
    return { status: 'deployed', ...record };
  } finally { fs.rmSync(source.temp, { recursive: true, force: true }); }
}

if (process.argv[1] && process.argv[1].endsWith('upgrade.ts')) {
  try { console.log(JSON.stringify(upgrade(parse(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(String((error as Error).message || error)); process.exitCode = 1; }
}
