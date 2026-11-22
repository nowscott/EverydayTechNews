#!/usr/bin/env node
/** 普通版 NAS 控制器（TS），与 deploy/ordinary/manage.py 对齐；安装到 managed 时导入同目录 base-manage.ts。 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as base from '../nas/base-manage.ts';

base.setPrefix('ordinary-news-v');
function pyJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value);
  if (typeof value === 'string') {
    let out = '"';
    for (const ch of value) {
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
  if (Array.isArray(value)) return '[' + value.map(pyJson).join(',') + ']';
  throw new TypeError('unsupported ledger value');
}

class Controller extends base.Controller {
  override schema(): number { return 1; }

  override ledger(): string {
    const file = path.join(this.data, 'state.sqlite3');
    if (!fs.existsSync(file)) return crypto.createHash('sha256').update(Buffer.from('empty')).digest('hex');
    const digest = crypto.createHash('sha256');
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      for (const table of ['issues', 'deliveries']) {
        digest.update(Buffer.from(table + '\0'));
        for (const row of db.prepare('SELECT * FROM ' + table + ' ORDER BY id').all()) {
          digest.update(Buffer.from(pyJson(Object.values(row as Record<string, unknown>)) + '\n'));
        }
      }
      return digest.digest('hex');
    } finally { db.close(); }
  }

  override snapshot(destination: string): void {
    base.copyTree(this.data, destination, (name) => name === 'runtime.lock' || name.startsWith('state.sqlite3'));
    const source = new DatabaseSync(path.join(this.data, 'state.sqlite3'), { readOnly: true });
    try {
      const target = path.join(destination, 'state.sqlite3');
      const escaped = target.replace(/'/g, "''");
      source.exec("VACUUM INTO '" + escaped + "'");
    } finally { source.close(); }
  }

  override startup(candidate: base.Candidate, snapshot: string): void {
    const temp = fs.mkdtempSync(path.join(this.root, 'startup-'));
    try {
      const empty = path.join(temp, 'empty.env');
      fs.writeFileSync(empty, '');
      fs.writeFileSync(path.join(temp, 'ordinary.env'), '');
      fs.writeFileSync(path.join(temp, 'archive.env'), '');
      fs.mkdirSync(path.join(temp, 'data'));
      const overlay = path.join(temp, 'network.yaml');
      fs.writeFileSync(overlay, 'services:\n  ordinary:\n    network_mode: none\n');
      const env = { ORDINARY_IMAGE: candidate.image, ORDINARY_ROOT: temp, ORDINARY_UID: String(os.userInfo().uid), ORDINARY_GID: String(os.userInfo().gid) };
      this.command(['docker', 'compose', '--env-file', path.join(temp, 'ordinary.env'),
        '-f', path.join(candidate.source, 'deploy/ordinary/compose.yaml'), '-f', overlay,
        'run', '--rm', '--entrypoint', 'node', 'ordinary', '--version'], { env });
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  }

  override validate(candidate: base.Candidate, snapshot: string): void {
    this.startup(candidate, snapshot);
    const verifier = path.join(candidate.source, 'deploy/ordinary/verify-state.ts');
    this.command(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges:true', '--user', String(os.userInfo().uid) + ':' + String(os.userInfo().gid),
      '--tmpfs', '/tmp:rw,size=128m,mode=1777', '-v', snapshot + ':/data',
      '-v', verifier + ':/app/verify-state.ts:ro',
      '--entrypoint', 'node', candidate.image, '/app/verify-state.ts'], { capture: false });
  }

  // 清扫 2.7.10 之前的旧命名项目容器：迁移窗口内被 cron 看门狗按旧 active 重建的调度容器
  // 会和新版本调度同时 tick，造成重复出刊，必须在激活后立即移除。
  sweepLegacy(): string[] {
    const removed: string[] = [];
    const names = this.command(['docker', 'ps', '-a', '--filter', 'name=everyday-tech-news-ordinary', '--format', '{{.Names}}']);
    for (const name of names.split('\n').map((line) => line.trim()).filter(Boolean)) {
      try { this.command(['docker', 'rm', '-f', name], { capture: false }); removed.push(name); } catch { /* 单个容器清理失败不阻断部署 */ }
    }
    if (removed.length) fs.appendFileSync(path.join(this.logs, 'deployments.jsonl'), JSON.stringify({ at: base.shanghai(),
      status: 'legacy_scheduler_removed', containers: removed }) + '\n');
    return removed;
  }

  override afterChange(state: base.State): void {
    if (!this.resident()) return;
    this.sweepLegacy();
    const current = state.active;
    if (!current || !this.hasScheduler(current.source)) return;
    try { this.schedulerControl(current, 'up'); }
    catch (error) {
      fs.appendFileSync(path.join(this.logs, 'deployments.jsonl'), JSON.stringify({ at: base.shanghai(), status: 'scheduler_start_failed',
        error: (error as Error).message.startsWith('command_failed') ? (error as Error).message : (error as Error).name }) + '\n');
    }
  }

  resident(): boolean { return this.config.resident_scheduler ? this.config.resident_scheduler === 'true' || this.config.resident_scheduler === '1' : true; }

  compose(source: string, current: base.Candidate): { env: Record<string, string>; prefix: string[] } {
    const env = { ORDINARY_IMAGE: current.image, ORDINARY_ROOT: path.dirname(this.root),
      ORDINARY_UID: String(os.userInfo().uid), ORDINARY_GID: String(os.userInfo().gid) };
    return { env, prefix: ['docker', 'compose', '--env-file', this.config.env_file, '-f', path.join(source, 'deploy/ordinary/compose.yaml')] };
  }

  hasScheduler(source: string): boolean {
    try { return fs.readFileSync(path.join(source, 'deploy/ordinary/compose.yaml'), 'utf8').includes('scheduler:'); } catch { return false; }
  }

  schedulerRunning(current: base.Candidate): boolean {
    if (!this.resident() || !this.hasScheduler(current.source)) return false;
    const { env, prefix } = this.compose(current.source, current);
    try { return Boolean(this.command([...prefix, 'ps', '-q', 'scheduler'], { env })); } catch { return false; }
  }

  schedulerControl(current: base.Candidate, action: 'up' | 'down'): string {
    const { env, prefix } = this.compose(current.source, current);
    const tail = action === 'up' ? ['up', '-d', '--no-deps', 'scheduler'] : ['stop', 'scheduler'];
    return this.command([...prefix, ...tail], { env, capture: false, timeout: 0 });
  }

  schedulerStatus(): Record<string, unknown> {
    const current = this.state().active;
    if (!current) return { status: 'no_active_release' };
    return { status: this.schedulerRunning(current) ? 'running' : 'stopped', active: current.tag,
      last: base.readJson(path.join(this.data, 'scheduler/status.json'), null) };
  }

  override run(): string {
    return base.withLock(path.resolve(this.config.scheduler_lock), false, (acquired) => {
      if (!acquired) return JSON.stringify({ status: 'scheduler_busy' });
      const current = this.state().active;
      if (!current) throw new Error('no_active_ordinary_release');
      const source = current.source;
      if (this.command(['git', 'rev-parse', 'HEAD'], { cwd: source }) !== current.sha
        || this.command(['git', 'status', '--porcelain', '--untracked-files=all'], { cwd: source })) throw new Error('ordinary_release_worktree_modified');
      const { env, prefix } = this.compose(source, current);
      const resident = this.schedulerRunning(current);
      if (resident) this.schedulerControl(current, 'down');
      try {
        return this.command([...prefix, 'run', '--rm', 'ordinary', 'run', '--data', '/data'], { env, capture: false, timeout: 0 });
      } finally {
        if (resident) {
          try { this.schedulerControl(current, 'up'); }
          catch (error) {
            fs.appendFileSync(path.join(this.logs, 'deployments.jsonl'), JSON.stringify({ at: base.shanghai(), status: 'scheduler_restart_failed',
              error: (error as Error).message.startsWith('command_failed') ? (error as Error).message : (error as Error).name }) + '\n');
          }
        }
      }
    });
  }

  sync(): string {
    return base.withLock(path.join(this.root, 'sync.lock'), false, (acquired) => {
      if (!acquired) return JSON.stringify({ status: 'archive_sync_busy' });
      const current = this.state().active;
      if (!current) throw new Error('no_active_ordinary_release');
      const temp = fs.mkdtempSync(path.join(this.root, 'archive-'));
      try {
        const snapshot = temp;
        return base.withLock(path.join(this.data, 'runtime.lock'), true, () => {
          if (fs.existsSync(path.join(this.data, 'archive-journal.json'))) return JSON.stringify({ status: 'archive_recovery_pending' });
          base.copyTree(path.join(this.data, 'news_archive'), path.join(snapshot, 'archive'));
          fs.copyFileSync(path.join(this.data, 'config.json'), path.join(snapshot, 'config.json'));
          const uid = String(os.userInfo().uid) + ':' + String(os.userInfo().gid);
          return this.command(['docker', 'run', '--rm', '--read-only', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges:true', '--memory', '256m', '--cpus', '0.5', '--user', uid,
            '--env-file', path.join(path.dirname(this.root), 'archive.env'), '-e', 'NODE_USE_ENV_PROXY=1',
            '-v', path.join(snapshot, 'archive') + ':/archive:ro', '-v', path.join(snapshot, 'config.json') + ':/control/config.json:ro',
            '-v', path.join(this.data, 'archive-sync') + ':/sync', '--entrypoint', 'node', current.image,
            'packages/ordinary-news/src/sync.ts', '/archive', '/sync', '/control/config.json'], { capture: false, timeout: 0 });
        });
      } finally { fs.rmSync(temp, { recursive: true, force: true }); }
    });
  }
}

export { Controller };

async function main(): Promise<number> {
  process.umask(0o077);
  const argv = process.argv.slice(2);
  const rootIndex = argv.indexOf('--root');
  if (rootIndex < 0 || !argv[rootIndex + 1]) throw new Error('root_required');
  const rest = argv.filter((_value, index) => index !== rootIndex && index !== rootIndex + 1);
  const [operation, tag] = rest;
  const controller = new Controller(argv[rootIndex + 1]);
  let result: unknown;
  if (operation === 'status') result = { deployment: controller.state(), last_check: base.readJson(path.join(controller.root, 'status.json'), null), scheduler: controller.schedulerStatus() };
  else if (operation === 'rollback') result = controller.rollback(tag);
  else if (operation === 'scheduler-up' || operation === 'scheduler-down') {
    // 迁移窗口内不重建调度：此时 active 还是旧版本，重建会和新版本调度同时出刊。
    if (operation === 'scheduler-up' && controller.updateInProgress()) result = { status: 'update_in_progress' };
    if (result) { /* 已跳过 */ }
    else {
    const current = controller.state().active;
    if (!current) throw new Error('no_active_ordinary_release');
    if (operation === 'scheduler-up' && controller.schedulerRunning(current)) {
      // 容器在跑但心跳停了（例如进程卡死），重启一次而不是放着不管。
      const health = base.schedulerHealth(base.readJson(path.join(controller.data, 'scheduler/status.json'), null));
      if (!health.healthy) {
        controller.schedulerControl(current, 'down');
        controller.schedulerControl(current, 'up');
        result = { status: 'scheduler_restarted_stale', active: current.tag, reason: health.reason, heartbeat_age_ms: health.heartbeat_age_ms };
      } else result = { status: 'scheduler_healthy', active: current.tag, heartbeat_age_ms: health.heartbeat_age_ms };
    } else {
      controller.schedulerControl(current, operation === 'scheduler-up' ? 'up' : 'down');
      result = { status: operation === 'scheduler-up' ? 'scheduler_up' : 'scheduler_down', active: current.tag };
    }
    }
  } else if (operation === 'update') result = await controller.update();
  else if (operation === 'run') result = controller.run();
  else if (operation === 'sync') result = controller.sync();
  else if (operation === 'ledger') result = controller.ledger();
  else throw new Error('unknown_operation');
  if (result) console.log(String(typeof result === 'string' ? result : JSON.stringify(result, null, 2)));
  if (result && typeof result === 'object') {
    const status = (result as Record<string, unknown>).status;
    if (['deployment_failed', 'release_check_failed', 'blocked_release'].includes(String(status))) return 1;
  }
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('manage.ts')) {
main().then((code) => { process.exitCode = code; }).catch((error) => { console.error(String((error as Error).message || error)); process.exitCode = 1; });
}
