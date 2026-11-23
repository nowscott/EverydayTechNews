#!/usr/bin/env node
/** NAS 高级版发布控制器（TS 版），与 deploy/nas/manage.py 行为对齐。 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const REPO = 'nowscott/EverydayTechNews';
const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;
let PREFIX = 'news-engine-v';

export function setPrefix(value: string): void { PREFIX = value; }

export type Triple = [number, number, number];

export function version(tag: string | undefined): Triple | null {
  if (!tag) return null;
  const escaped = PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp('^' + escaped + '(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$').exec(tag);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function protectedWindow(now: Date = new Date()): boolean {
  const hour = new Date(now.getTime() + SHANGHAI_OFFSET_MS).getUTCHours();
  return hour >= 4 && hour < 9;
}

/** 夜间安静时段（23:00–08:00）：默认不跑部署/校验这类重负载；ETN_FORCE=1 可强制。 */
export function quietWindow(now: Date = new Date()): boolean {
  const hour = new Date(now.getTime() + SHANGHAI_OFFSET_MS).getUTCHours();
  return hour >= 23 || hour < 8;
}

export function choose(releases: Release[], floor: Triple): Release | null {
  let best: { release: Release; version: Triple } | null = null;
  for (const release of releases) {
    const v = version(release.tag_name);
    if (!v || release.draft || release.prerelease || !release.published_at) continue;
    if (compare(v, floor) <= 0) continue;
    if (!best || compare(v, best.version) > 0) best = { release, version: v };
  }
  return best ? best.release : null;
}

export interface Release { tag_name?: string; draft?: boolean; prerelease?: boolean; published_at?: string }

/** 控制器自身文件；update 发现与 release 不一致时自动同步，避免「改了 base-manage 却没生效」。 */
export const CONTROLLER_FILES = ['manage.ts', 'base-manage.ts', 'verify-state.ts', 'compose.managed.yaml', 'compose.proxy.yaml'];

export function compare(a: Triple, b: Triple): number {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export function maxTriple(a: Triple, b: Triple): Triple {
  return compare(a, b) >= 0 ? a : b;
}

export function shanghai(now: Date = new Date()): string {
  return new Date(now.getTime() + SHANGHAI_OFFSET_MS).toISOString().replace('Z', '+08:00');
}

export function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return fallback; }
}

export function atomicWrite(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.tmp';
  const fd = fs.openSync(temp, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  const dir = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}

/** 与 Python 版 flock 语义对齐：非阻塞拿不到锁时返回 acquired=false。 */
/** 读取锁文件里的持有者信息；内容不是 JSON 或没有 pid 时返回 null。 */
export function lockHolder(file: string): { pid?: number; at?: string } | null {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch { return null; }
}

/** 判断 pid 是否还活着；没有权限探测（EPERM）也按存活处理。 */
export function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

export function withLock<T>(file: string, blocking: boolean, fn: (acquired: boolean) => T, options: { timeoutMs?: number; staleMs?: number } = {}): T {
  const { timeoutMs = 30_000, staleMs = 3_600_000 } = options;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); } finally { fs.closeSync(fd); }
      try { return fn(true); } finally { try { fs.unlinkSync(file); } catch { /* 已清理 */ } }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const holder = lockHolder(file);
        // 进程已经不在了就立即回收，不必等满 staleMs；mtime 只作为兜底。
        if (holder?.pid && !pidAlive(holder.pid)) { fs.unlinkSync(file); continue; }
        if (Date.now() - fs.statSync(file).mtimeMs > staleMs) { fs.unlinkSync(file); continue; }
      } catch { continue; }
      if (!blocking) return fn(false);
      if (Date.now() > deadline) return fn(false);
      spawnSync('sleep', ['0.2']);
    }
  }
}

/** Python json 默认分隔符（', ' / ': '）与 ensure_ascii，用于账本哈希对齐。 */
export function pythonJson(value: unknown, sortKeys = false): string {
  if (value === null || value === undefined) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value);
  if (typeof value === 'string') return pythonString(value);
  if (Array.isArray(value)) return '[' + value.map((item) => pythonJson(item, sortKeys)).join(', ') + ']';
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    if (sortKeys) keys.sort();
    return '{' + keys.map((key) => pythonString(key) + ': ' + pythonJson((value as Record<string, unknown>)[key], sortKeys)).join(', ') + '}';
  }
  throw new TypeError('unsupported ledger value: ' + typeof value);
}

function pythonString(text: string): string {
  let out = '"';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (code < 0x20 || code > 0x7e) out += '\\u' + code.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

export function copyTree(source: string, destination: string, ignore: (name: string) => boolean = () => false): void {
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (ignore(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTree(from, to, ignore);
    else if (entry.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
    else { fs.copyFileSync(from, to); fs.chmodSync(to, fs.statSync(from).mode & 0o777); }
  }
}

export function compatible(manifest: Record<string, unknown>, schema: unknown, component = 'news-engine'): boolean {
  return manifest.component === component && manifest.state_schema === schema
    && manifest.controller_protocol === 1 && manifest.automatic_deployment === true;
}

export function schedulerLines(present: string, privateRoot: string, root: string, runCommand: string): string[] {
  const manager = runCommand.split(' ').slice(1, -3).join(' ');
  const mark = '# EverydayTechNews managed releases; local time Asia/Shanghai';
  // 采集/出刊已由常驻 scheduler 容器（etn-premium-scheduler）驱动，crontab 只保留自我更新。
  const lines = present.split('\n').filter((line) => !line.includes(path.join(privateRoot, 'run-scheduled.sh'))
    && !(line.includes(manager) && line.includes(' run ')) && line !== mark);
  lines.push(mark);
  lines.push('*/15 * * * * ' + runCommand + ' update >> ' + path.join(root, 'logs/updater.log') + ' 2>&1');
  return lines;
}

// 看门狗判定：容器在跑不等于调度活着，还要看心跳；心跳超过 5 分钟没更新视为卡死。
export function schedulerHealth(status: unknown, now: Date = new Date(), staleMs = 5 * 60000): { healthy: boolean; heartbeat_age_ms: number | null; reason: string | null } {
  const beat = Date.parse(((status as Record<string, any>)?.scheduler?.heartbeat_at) ?? '');
  if (!Number.isFinite(beat)) return { healthy: false, heartbeat_age_ms: null, reason: 'heartbeat_missing' };
  const age = now.getTime() - beat;
  if (age > staleMs) return { healthy: false, heartbeat_age_ms: age, reason: 'heartbeat_stale' };
  return { healthy: true, heartbeat_age_ms: age, reason: null };
}

export interface CommandOptions { cwd?: string; capture?: boolean; env?: Record<string, string>; timeout?: number }

export class Controller {
  /** 目标文件名 → release 内相对路径；普通版 manage/verify 在 deploy/ordinary，base 共用 deploy/nas。 */
  controllerSources: Record<string, string> = Object.fromEntries(CONTROLLER_FILES.map((name) => [name, 'deploy/nas/' + name]));
  /** 复制前的文本改写钩子；普通版要把 manage.ts 的跨目录 import 改成同目录。 */
  controllerRewrite: ((name: string, text: string) => string) | null = null;
  root: string;
  data: string;
  statePath: string;
  logs: string;
  config: Record<string, string>;
  proxyConfigured: boolean;
  versionPrefix: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.versionPrefix = PREFIX;
    const proxyFile = path.join(this.root, 'proxy.env');
    this.proxyConfigured = fs.existsSync(proxyFile);
    if (this.proxyConfigured) {
      if (fs.statSync(proxyFile).mode & 0o077) throw new Error('proxy_config_permissions_invalid');
      for (const line of fs.readFileSync(proxyFile, 'utf8').split('\n')) {
        if (!line || line.startsWith('#')) continue;
        const index = line.indexOf('=');
        const key = index < 0 ? '' : line.slice(0, index);
        const value = line.slice(index + 1);
        if (index < 0 || !['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'].includes(key)) throw new Error('proxy_config_invalid');
        process.env[key] = value;
        process.env[key.toLowerCase()] = value;
      }
    }
    this.config = readJson(path.join(this.root, 'config.json'), {} as Record<string, string>);
    if (!Object.keys(this.config).length) throw new Error('controller_not_configured');
    this.data = path.resolve(this.config.data);
    this.statePath = path.join(this.root, 'deployment.json');
    this.logs = path.join(this.root, 'logs');
    fs.mkdirSync(this.logs, { recursive: true, mode: 0o700 });
    process.umask(0o077);
  }

  command(args: string[], options: CommandOptions = {}): string {
    const { cwd, capture = true, env, timeout = 1800 } = options;
    const logFd = fs.openSync(path.join(this.logs, 'commands.log'), 'a');
    const privateOutput = this.proxyConfigured && (args[0] === 'git' || args.slice(0, 2).join(' ') === 'docker build');
    const errFd = privateOutput ? fs.openSync('/dev/null', 'w') : logFd;
    try {
      const result = spawnSync(args[0], args.slice(1), {
        cwd, env: { ...process.env, ...(env || {}) }, timeout: timeout * 1000,
        stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', logFd, errFd], maxBuffer: 64 * 1024 * 1024,
      });
      if (result.error || result.status !== 0) throw new Error('command_failed:' + args[0]);
      return capture ? (result.stdout || '').toString().trim() : '';
    } finally {
      fs.closeSync(logFd);
      if (privateOutput) fs.closeSync(errFd);
    }
  }

  async api(endpoint: string): Promise<Record<string, unknown>> {
    const response = await fetch('https://api.github.com/repos/' + REPO + '/' + endpoint, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'EverydayTechNews-NAS/1' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error('github_api_' + response.status);
    return (await response.json()) as Record<string, unknown>;
  }

  state(): State {
    return readJson(this.statePath, { active: null, history: [], blocked: {}, high_water: [0, 0, 0] });
  }

  event(status: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
    const value = { at: shanghai(), status, ...fields };
    atomicWrite(path.join(this.root, 'status.json'), value);
    fs.appendFileSync(path.join(this.logs, 'deployments.jsonl'), JSON.stringify(value) + '\n');
    return value;
  }

  /** 记录当前阶段，供人工排查“到底在等什么”；同时写文件与一行 stdout。 */
  progress(phase: string, detail: Record<string, unknown> = {}): void {
    const value = { phase, at: shanghai(), pid: process.pid, ...detail };
    atomicWrite(path.join(this.root, 'update-progress.json'), value);
    fs.appendFileSync(path.join(this.logs, 'updater.log'), JSON.stringify(value) + '\n');
    console.log('progress ' + JSON.stringify(value));
  }

  /** 比较 release 内控制器文件与 managed 现文件；把变化的文件备份后覆盖。 */
  syncController(source: string, tag: string, sha: string): Record<string, unknown> | null {
    const hash = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const changed: string[] = [];
    const desired = new Map<string, string>();
    for (const [name, relative] of Object.entries(this.controllerSources)) {
      const from = path.join(source, relative), to = path.join(this.root, name);
      if (!fs.existsSync(from)) continue;
      const text = fs.readFileSync(from, 'utf8');
      const wanted = this.controllerRewrite ? this.controllerRewrite(name, text) : text;
      const current = fs.existsSync(to) ? fs.readFileSync(to, 'utf8') : null;
      if (current !== wanted) changed.push(name);
      desired.set(name, wanted);
    }
    if (!changed.length) return null;
    const backup = path.join(this.root, 'controller-backups', tag);
    fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
    for (const name of changed) {
      const from = path.join(source, this.controllerSources[name]), to = path.join(this.root, name);
      if (fs.existsSync(to)) fs.copyFileSync(to, path.join(backup, name));
      fs.writeFileSync(to, desired.get(name)!, { mode: 0o600 });
    }
    const manage = path.join(this.root, 'manage.ts'), base = path.join(this.root, 'base-manage.ts');
    atomicWrite(path.join(this.root, 'controller.json'), { version: tag, sha,
      manage_sha256: hash(manage), base_sha256: hash(base) });
    return { tag, files: changed, backup };
  }

  schema(): unknown {
    return readJson<Record<string, unknown>>(path.join(this.data, 'durable/state.json'), {}).schema_version;
  }

  ledger(): string {
    const state = readJson<{ tables: { calls: unknown; issues: unknown } }>(path.join(this.data, 'durable/state.json'), { tables: { calls: [], issues: [] } });
    const deliveries: Record<string, string> = {};
    const base = path.join(this.data, 'deliveries');
    const walk = (dir: string): void => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.isFile()) deliveries[path.relative(this.data, file)] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      }
    };
    walk(base);
    const payload = { calls: state.tables.calls, issues: state.tables.issues, deliveries };
    return crypto.createHash('sha256').update(pythonJson(payload, true)).digest('hex');
  }

  snapshot(destination: string): void {
    copyTree(this.data, destination, (name) => name === 'pool.lock' || name.startsWith('state.sqlite3'));
  }

  source(tag: string): { sha: string; directory: string } {
    const repo = path.join(this.root, 'repository.git');
    if (!fs.existsSync(repo)) this.command(['git', 'clone', '--bare', 'https://github.com/' + REPO + '.git', repo]);
    this.command(['git', '--git-dir', repo, 'fetch', 'origin', '+refs/heads/main:refs/heads/main', 'refs/tags/' + tag + ':refs/tags/' + tag]);
    const sha = this.command(['git', '--git-dir', repo, 'rev-parse', tag + '^{commit}']);
    this.command(['git', '--git-dir', repo, 'merge-base', '--is-ancestor', sha, 'refs/heads/main']);
    const runs = this.apiSync('actions/workflows/' + (this.config.workflow || 'news-engine.yml') + '/runs?head_sha=' + sha + '&event=push&per_page=100');
    const list = (runs as { workflow_runs?: Record<string, unknown>[] }).workflow_runs || [];
    if (!list.some((run) => run.head_sha === sha && run.head_branch === 'main' && run.event === 'push'
      && run.status === 'completed' && run.conclusion === 'success')) throw new Error('release_main_checks_not_passed');
    const directory = path.join(this.root, 'releases', tag + '-' + sha.slice(0, 12));
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(path.dirname(directory), { recursive: true, mode: 0o700 });
      this.command(['git', '--git-dir', repo, 'worktree', 'add', '--detach', directory, sha]);
    }
    if (this.command(['git', 'status', '--porcelain', '--untracked-files=all'], { cwd: directory })) throw new Error('release_worktree_modified');
    const manifest = readJson<Record<string, unknown>>(path.join(directory, this.config.manifest || 'deploy/nas/release.json'), {});
    if (!compatible(manifest, this.schema(), this.config.component || 'news-engine') || PREFIX + String(manifest.version || '') !== tag) {
      throw new Error('release_requires_manual_data_migration');
    }
    return { sha, directory };
  }

  apiSync(endpoint: string): unknown {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', GITHUB_API_SCRIPT, endpoint], { timeout: 40_000, env: process.env });
    if (result.status !== 0) throw new Error('github_api_unavailable');
    return JSON.parse((result.stdout || '').toString());
  }

  build(tag: string, sha: string, directory: string): Candidate {
    const image = (this.config.image_repository || 'etn-premium') + ':' + tag;
    this.command(['docker', 'build', '--build-arg', 'HTTP_PROXY', '--build-arg', 'HTTPS_PROXY', '--build-arg', 'NO_PROXY',
      '-f', this.config.dockerfile || 'deploy/nas/Dockerfile', '--build-arg', 'NEWS_VERSION=' + tag,
      '--build-arg', 'NEWS_REVISION=' + sha, '-t', image, '.'], { cwd: directory, capture: false });
    const info = (JSON.parse(this.command(['docker', 'image', 'inspect', image])) as Record<string, any>[])[0];
    const labels = info.Config?.Labels || {};
    if (labels['org.opencontainers.image.revision'] !== sha || labels['org.opencontainers.image.version'] !== tag) throw new Error('image_provenance_mismatch');
    return { tag, sha, source: directory, image: info.Id, image_tag: image, schema: 1, deployed_at: shanghai() };
  }

  startup(candidate: Candidate, snapshot: string): void {
    const source = candidate.legacy ? this.root : path.join(candidate.source, 'deploy/nas');
    const temp = fs.mkdtempSync(path.join(this.root, 'startup-'));
    try {
      const empty = path.join(temp, 'empty.env'); fs.writeFileSync(empty, '');
      const network = path.join(temp, 'network.yaml'); fs.writeFileSync(network, 'services:\n  premium:\n    network_mode: none\n');
      const env = { NAS_IMAGE: candidate.image, NAS_ENV_FILE: empty, NAS_DATA_DIR: snapshot, NAS_UID: String(os.userInfo().uid), NAS_GID: String(os.userInfo().gid) };
      this.command(['docker', 'compose', '--env-file', empty,
        '-f', path.join(source, 'compose.managed.yaml'), '-f', path.join(source, 'compose.proxy.yaml'),
        '-f', network, 'run', '--rm', '--entrypoint', 'node', 'premium', '--version'], { env });
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  }

  validate(candidate: Candidate, snapshot: string): void {
    this.startup(candidate, snapshot);
    const verifier = candidate.legacy ? path.join(this.root, 'verify-state.ts') : path.join(candidate.source, 'deploy/nas/verify-state.ts');
    const uid = String(os.userInfo().uid);
    this.command(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges:true', '--user', uid + ':' + String(os.userInfo().gid),
      '--tmpfs', '/tmp:rw,size=128m,mode=1777', '-v', snapshot + ':/data',
      '-v', verifier + ':/app/verify-state.ts:ro',
      '--entrypoint', 'node', candidate.image, '/app/verify-state.ts'], { capture: false });
  }

  activate(candidate: Candidate, rollback = false): Record<string, unknown> {
    return withLock(path.resolve(this.config.scheduler_lock), true, (acquired) => {
      if (!acquired) throw new Error('controller_lock_unavailable');
      if (protectedWindow()) return this.event('deferred_morning_window', { pending: candidate.tag });
      return withLock(path.join(this.data, this.config.state_lock || 'pool.lock'), true, () => {
        const state = this.state();
        const before = this.ledger();
        const identifier = shanghai().replace(/[-:]/g, '').replace('T', 'T').replace('+08:00', '');
        const backup = path.join(this.root, 'backups', identifier);
        fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
        const temp = fs.mkdtempSync(path.join(this.root, 'validate-'));
        try {
          this.progress('backup', { pending: candidate.tag });
          const snapshot = path.join(temp, 'data');
          this.snapshot(snapshot);
          fs.chmodSync(snapshot, 0o700);
          this.command(['tar', '-czf', path.join(backup, 'state.tar.gz'), '-C', temp, 'data'], { capture: false });
          this.progress('validate_candidate', { pending: candidate.tag });
          this.validate(candidate, snapshot);
          let previous = state.active as Candidate | null;
          if (previous && previous.runtime_failed) previous = state.history.find((item) => !item.runtime_failed) || null;
          if (previous) { this.progress('validate_previous', { tag: previous.tag }); this.validate(previous, snapshot); }
        } finally { fs.rmSync(temp, { recursive: true, force: true }); }
        if (before !== this.ledger()) throw new Error('live_ledger_changed_during_validation');
        if (protectedWindow()) return this.event('deferred_morning_window', { pending: candidate.tag });
        const deployed: Candidate = { ...candidate, checks: 'offline_state_and_ledger_passed', backup, deployed_at: shanghai() };
        const history = [deployed, ...state.history.filter((item) => item.image !== deployed.image && !item.runtime_failed)].slice(0, 3);
        state.active = deployed;
        state.history = history;
        state.high_water = maxTriple((state.high_water || [0, 0, 0]) as Triple, version(deployed.tag) || [0, 0, 0]);
        this.progress('switch', { pending: candidate.tag });
        atomicWrite(this.statePath, state);
        this.afterChange(state);
        try { this.prune(state); } catch { this.event('cleanup_deferred', { active: deployed }); }
        return this.event(rollback ? 'rolled_back' : 'deployed', { active: deployed });
      });
    });
  }

  schedulerService(action: 'up' | 'down' = 'up'): string {
    const active = this.state().active;
    if (!active?.source || !active?.image) throw new Error('no_active_release');
    const env = { NAS_IMAGE: active.image, NAS_DATA_DIR: this.config.data, NAS_ENV_FILE: this.config.env_file,
      NAS_UID: String(os.userInfo().uid), NAS_GID: String(os.userInfo().gid) };
    if (action === 'up') {
      // 旧部署项目名是 everyday-tech-news-test；固定 container_name 会与新的 etn-premium 冲突，先摘掉旧容器。
      try {
        const project = this.command(['docker', 'inspect', 'etn-premium-scheduler', '--format', '{{index .Config.Labels "com.docker.compose.project"}}']).trim();
        if (project && project !== 'etn-premium') this.command(['docker', 'rm', '-f', 'etn-premium-scheduler']);
      } catch { /* 容器不存在时 inspect 失败，按未占用处理。 */ }
    }
    return this.command(['docker', 'compose', '--env-file', this.config.env_file,
      '-f', path.join(active.source, 'deploy/nas/compose.managed.yaml'), '-f', path.join(active.source, 'deploy/nas/compose.proxy.yaml'),
      action === 'up' ? 'up' : 'stop', ...(action === 'up' ? ['-d', '--no-deps', 'scheduler'] : ['scheduler'])], { env });
  }

  schedulerStatus(): Record<string, unknown> {
    try {
      const running = this.command(['docker', 'ps', '--filter', 'name=etn-premium-scheduler', '--format', '{{.Status}}']);
      const status = readJson<Record<string, unknown> | null>(path.join(this.data, 'scheduler', 'status.json'), null);
      return { container: running || 'stopped', status };
    } catch (error) { return { container: 'unknown', error: String((error as Error).message ?? error).slice(0, 120) }; }
  }

  // 激活成功后确保常驻调度在跑：失败只记事件，不影响已完成的发布。
  afterChange(_state: State): void {
    try { this.schedulerService('up'); this.event('scheduler_service_up'); }
    catch (error) { this.event('scheduler_service_failed', { error: String((error as Error).message ?? error).slice(0, 200) }); }
  }

  prune(state: State): void {
    const keep = new Set(state.history.map((item) => item.source));
    const repo = path.join(this.root, 'repository.git');
    for (const entry of fs.readdirSync(path.join(this.root, 'releases'), { withFileTypes: true })) {
      const full = path.join(this.root, 'releases', entry.name);
      if (!keep.has(full) && entry.isDirectory()) this.command(['git', '--git-dir', repo, 'worktree', 'remove', full]);
    }
    const known = readJson<Candidate[]>(path.join(this.root, 'image-history.json'), []);
    const retained = new Set(state.history.map((item) => item.image));
    for (const item of known) {
      if (retained.has(item.image) || item.legacy) continue;
      for (const reference of [item.image_tag, (this.config.image_repository || 'etn-premium') + ':git-' + item.sha]) {
        try { this.command(['docker', 'image', 'rm', reference]); } catch { /* 已不存在 */ }
      }
    }
    atomicWrite(path.join(this.root, 'image-history.json'), state.history);
    const backups = fs.readdirSync(path.join(this.root, 'backups')).sort().reverse();
    for (const name of backups.slice(3)) fs.rmSync(path.join(this.root, 'backups', name), { recursive: true, force: true });
  }

  // 迁移标记：update 全程存在，cron 的 scheduler-up 看到它就跳过，
  // 避免「旧版本容器已被 down、新版本还没激活」的空窗被看门狗按旧 active 重建（会出现双份调度）。
  updateInProgress(): boolean { return fs.existsSync(path.join(this.root, 'update.inprogress')); }

  async update(): Promise<Record<string, unknown>> {
    const marker = path.join(this.root, 'update.inprogress');
    const lock = path.join(this.root, 'update.lock');
    return withLock(lock, false, (acquired) => {
      if (!acquired) return { status: 'update_already_running',
        holder: lockHolder(lock),
        progress: readJson<Record<string, unknown> | null>(path.join(this.root, 'update-progress.json'), null) };
      atomicWrite(marker, { at: shanghai(), pid: process.pid });
      try { return this.updateUnlocked(); }
      finally { try { fs.rmSync(marker, { force: true }); } catch { /* 标记清理失败不影响部署结果 */ } }
    });
  }

  updateUnlocked(): Record<string, unknown> {
    const state = this.state();
    if (quietWindow() && process.env.ETN_FORCE !== '1') return this.event('deferred_night_window', { active: state.active });
    this.progress('release_check');
    let release: Release | null = null;
    try { release = choose(this.apiSync('releases?per_page=100') as Release[], state.high_water as Triple); }
    catch { return this.event('release_check_failed', { reason: 'github_api_unavailable' }); }
    if (!release) return this.event('up_to_date', { active: state.active });
    const tag = release.tag_name!;
    if (state.blocked[tag]) return this.event('blocked_release', { pending: tag, reason: state.blocked[tag] });
    if (protectedWindow()) return this.event('deferred_morning_window', { pending: tag });
    try {
      this.progress('source', { tag });
      const { sha, directory } = this.source(tag);
      this.progress('build', { tag, sha });
      const candidate = this.build(tag, sha, directory);
      const synced = this.syncController(directory, tag, sha);
      if (synced) this.progress('controller_synced', synced);
      const result = this.activate(candidate);
      this.progress('done', { tag });
      return result;
    } catch (error) {
      const reason = (error as Error).message.startsWith('command_failed') || ['release_main_checks_not_passed', 'release_worktree_modified',
        'release_requires_manual_data_migration', 'image_provenance_mismatch'].includes((error as Error).message)
        ? (error as Error).message : ((error as Error).message || (error as Error).name);
      const current = this.state();
      // CI 尚未跑完、GitHub API 抖动属于可重试的瞬时状态，不能把版本永久拉黑。
      if (!['release_main_checks_not_passed', 'github_api_unavailable'].includes(reason)) {
        current.blocked[tag] = reason;
        atomicWrite(this.statePath, current);
      }
      return this.event('deployment_failed', { pending: tag, reason, retryable: ['release_main_checks_not_passed', 'github_api_unavailable'].includes(reason), active: current.active });
    }
  }

  run(): string {
    return withLock(path.resolve(this.config.scheduler_lock), false, (acquired) => {
      if (!acquired) return JSON.stringify({ status: 'scheduler_busy' });
      const current = this.state().active;
      if (!current) throw new Error('no_active_release');
      const source = current.legacy ? this.root : current.source;
      if (!current.legacy) {
        if (this.command(['git', 'rev-parse', 'HEAD'], { cwd: source }) !== current.sha
          || this.command(['git', 'status', '--porcelain', '--untracked-files=all'], { cwd: source })) throw new Error('active_release_worktree_modified');
      }
      const base = current.legacy ? '' : 'deploy/nas/';
      const env: Record<string, string> = { NAS_IMAGE: current.image, NAS_DATA_DIR: this.data, NAS_ENV_FILE: this.config.env_file,
        NAS_UID: String(os.userInfo().uid), NAS_GID: String(os.userInfo().gid) };
      return this.command(['docker', 'compose', '--env-file', this.config.env_file,
        '-f', path.join(source, base + 'compose.managed.yaml'), '-f', path.join(source, base + 'compose.proxy.yaml'),
        'run', '--rm', '--name', 'etn-premium-scheduled', 'premium', 'run'], { env, capture: false, timeout: 0 });
    });
  }

  rollback(tag: string | undefined): Record<string, unknown> {
    return withLock(path.join(this.root, 'update.lock'), true, () => {
      const state = this.state();
      if (tag && state.blocked[tag]) throw new Error('release_is_quarantined');
      const candidate = state.history.find((item) => item.tag === tag);
      if (!candidate) throw new Error('version_not_retained');
      return this.activate(candidate, true) as Record<string, unknown>;
    });
  }
}

const GITHUB_API_SCRIPT = `
const endpoint = process.argv[1];
const response = await fetch('https://api.github.com/repos/${REPO}/' + endpoint, {
  headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'EverydayTechNews-NAS/1' },
  signal: AbortSignal.timeout(30000),
});
if (!response.ok) { console.error('github_api_' + response.status); process.exit(1); }
console.log(JSON.stringify(await response.json()));
`;

export interface Candidate {
  tag: string; sha: string; source: string; image: string; image_tag: string; schema: number;
  deployed_at: string; legacy?: boolean; runtime_failed?: boolean; checks?: string; backup?: string;
}

export interface State {
  active: Candidate | null;
  history: Candidate[];
  blocked: Record<string, string>;
  high_water: Triple;
}
