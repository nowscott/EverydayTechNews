// 宿主 Node 运行时升级工具：校验 sha256、暂存解压、原子切换、失败回退。
// 用法：
//   runtime.ts --root /vol3/1000/Docker status
//   runtime.ts --root /vol3/1000/Docker install 24.22.3 [--check]
//   runtime.ts --root /vol3/1000/Docker rollback
// 设计约束：不使用符号链接；切换靠两次 rename，任何一步失败都保持旧运行时可用。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const NAME = 'everydaytechnews-runtime';
export const MIRRORS = [
  'https://npmmirror.com/mirrors/node/v{V}/node-v{V}-linux-x64.tar.xz',
  'https://nodejs.org/dist/v{V}/node-v{V}-linux-x64.tar.xz',
];

export function artifact(version: string): string { return 'node-v' + version + '-linux-x64.tar.xz'; }

export function urls(version: string): string[] {
  return MIRRORS.map((mirror) => mirror.replaceAll('{V}', version));
}

export function checksumsUrl(version: string): string { return 'https://nodejs.org/dist/v' + version + '/SHASUMS256.txt'; }

// SHASUMS256.txt 行格式：<64 hex><两个空格><文件名>。只取目标产物那一行。
export function shaFor(version: string, text: string): string {
  const target = artifact(version);
  for (const line of text.split('\n')) {
    const match = /^([0-9a-f]{64})\s+(.+)$/.exec(line.trim());
    if (match && match[2].trim() === target) return match[1];
  }
  throw new Error('checksum_not_found:' + target);
}

export function sha256(file: string): string {
  const out = execFileSync('sha256sum', [file], { encoding: 'utf8' });
  return out.trim().split(/\s+/)[0];
}

export function verify(file: string, expected: string): void {
  const actual = sha256(file);
  if (actual !== expected) throw new Error('checksum_mismatch:' + actual + '!=' + expected);
}

function run(command: string, args: string[], options: Record<string, unknown> = {}): string {
  return execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe', ...options }) as unknown as string;
}

export function current(root: string): Record<string, unknown> {
  const dir = path.join(root, NAME);
  const binary = path.join(dir, 'bin/node');
  if (!fs.existsSync(binary)) return { status: 'absent', path: dir };
  const version = run(binary, ['--version']).trim();
  const others = fs.readdirSync(root).filter((name) => name.startsWith(NAME + '-') && fs.existsSync(path.join(root, name, 'bin/node')));
  return { status: 'ok', path: dir, version, previous: others.sort().reverse().slice(0, 5) };
}

// 原子切换：先备份旧目录再改名新目录；第二步失败立即把旧目录挪回来。
export function activate(root: string, staging: string, version: string, oldVersion: string | undefined): Record<string, unknown> {
  const dir = path.join(root, NAME);
  const backup = path.join(root, NAME + '-' + (oldVersion ? oldVersion.replace(/^v/, '') : 'previous'));
  if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
  const hadOld = fs.existsSync(dir);
  if (hadOld) fs.renameSync(dir, backup);
  try {
    fs.renameSync(staging, dir);
  } catch (error) {
    if (hadOld && !fs.existsSync(dir)) fs.renameSync(backup, dir);
    throw error;
  }
  const version2 = run(path.join(dir, 'bin/node'), ['--version']).trim();
  if (version2 !== 'v' + version) throw new Error('runtime_version_mismatch:' + version2);
  return { status: 'installed', version: version2, path: dir, backup: hadOld ? backup : null };
}

export function rollback(root: string): Record<string, unknown> {
  const dir = path.join(root, NAME);
  const candidates = fs.readdirSync(root)
    .filter((name) => name.startsWith(NAME + '-') && fs.existsSync(path.join(root, name, 'bin/node')))
    .sort();
  if (!candidates.length) throw new Error('no_previous_runtime');
  const previous = candidates[candidates.length - 1];
  const broken = path.join(root, NAME + '-broken-' + Date.now());
  if (fs.existsSync(dir)) fs.renameSync(dir, broken);
  fs.renameSync(path.join(root, previous), dir);
  const version = run(path.join(dir, 'bin/node'), ['--version']).trim();
  return { status: 'rolled_back', version, from: previous, kept: broken };
}

function download(url: string, target: string): void {
  run('curl', ['-fL', '--retry', '3', '--connect-timeout', '20', '-o', target, url], { stdio: 'inherit' });
}

export function install(root: string, version: string, check: boolean): Record<string, unknown> {
  const target = version.replace(/^v/, '');
  const work = path.join(root, '.runtime-stage-' + target + '-' + Date.now());
  fs.mkdirSync(work, { recursive: true });
  const tarball = path.join(work, artifact(target));
  const sums = path.join(work, 'SHASUMS256.txt');
  download(checksumsUrl(target), sums);
  const expected = shaFor(target, fs.readFileSync(sums, 'utf8'));
  let downloaded = false;
  const errors: string[] = [];
  for (const url of urls(target)) {
    try { download(url, tarball); downloaded = true; break; } catch (error) { errors.push(url + ':' + String((error as Error).message).slice(0, 40)); }
  }
  if (!downloaded) throw new Error('download_failed:' + errors.join(','));
  verify(tarball, expected);
  if (check) {
    fs.rmSync(work, { recursive: true, force: true });
    return { status: 'check_passed', version: target, sha256: expected, mirrors: urls(target).length };
  }
  const staging = path.join(work, 'x');
  fs.mkdirSync(staging);
  run('tar', ['-xJf', tarball, '-C', staging, '--strip-components=1']);
  const staged = path.join(staging, 'bin/node');
  if (!fs.existsSync(staged)) throw new Error('tarball_layout_unexpected');
  const stagedVersion = run(staged, ['--version']).trim();
  if (stagedVersion !== 'v' + target) throw new Error('staged_version_mismatch:' + stagedVersion);
  const before = current(root);
  const result = activate(root, staging, target, typeof before.version === 'string' ? before.version : undefined);
  fs.rmSync(work, { recursive: true, force: true });
  return { ...result, sha256: expected, previous: before.version ?? null };
}

function main(argv: string[]): void {
  const args = argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const root = rootIndex >= 0 ? path.resolve(args[rootIndex + 1]) : '/vol3/1000/Docker';
  const check = args.includes('--check');
  const positional = args.filter((value, index) => !value.startsWith('--') && args[index - 1] !== '--root');
  const operation = positional[0] ?? 'status';
  let result: Record<string, unknown>;
  if (operation === 'status') result = current(root);
  else if (operation === 'install') {
    if (!positional[1]) throw new Error('version_required');
    result = install(root, positional[1], check);
  } else if (operation === 'rollback') result = rollback(root);
  else throw new Error('unknown_operation:' + operation);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (process.argv[1] && process.argv[1].endsWith('runtime.ts')) {
  try { main(process.argv); } catch (error) { process.stdout.write(JSON.stringify({ status: 'failed', error: String((error as Error).message) }) + '\n'); process.exit(1); }
}
