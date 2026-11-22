#!/usr/bin/env node
/** 看板运行记录器（TS）：只观察既有调度命令，自身不触发业务。与 deploy/dashboard/record-run.py 对齐。 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const OFFSET_MS = 8 * 3600 * 1000;

function stamp(): string {
  return new Date(Date.now() + OFFSET_MS).toISOString().replace('Z', '+08:00');
}

function atomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.' + crypto.randomBytes(16).toString('hex') + '.tmp';
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}

interface RunRecord {
  run_id: string; component: string; started_at: string; finished_at: string | null;
  state: string; exit_code: number | null; timeout_s: number;
  duration_ms: number | null; timed_out: boolean;
  [key: string]: unknown;
}

export function record(root: string, component: 'ordinary' | 'premium', command: string[], deployment?: string, timeout = 600): number {
  const directory = path.join(root, 'runtime', component);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lockFile = path.join(directory, 'observer.lock');
  let lockFd: number;
  try { lockFd = fs.openSync(lockFile, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 0;
    throw error;
  }
  try {
    if (deployment) {
      let active: Record<string, unknown> | null = null;
      try {
        const parsed = JSON.parse(fs.readFileSync(deployment, 'utf8')) as { active?: Record<string, unknown> };
        active = parsed.active || null;
      } catch { active = null; }
      atomic(path.join(root, 'deployment', component, 'deployment.json'),
        { active: active ? { tag: active.tag, sha: active.sha, deployed_at: active.deployed_at } : null });
    }
    const started = stamp();
    const startedMs = Date.now();
    const value: RunRecord = {
      run_id: started + '-' + crypto.randomBytes(8).toString('hex').slice(0, 8), component,
      started_at: started, finished_at: null, state: 'running', exit_code: null,
      timeout_s: timeout, duration_ms: null, timed_out: false,
    };
    const file = path.join(directory, value.run_id.replace(/:/g, '-') + '.json');
    atomic(file, value);
    atomic(path.join(directory, 'latest.json'), value);
    let code = 127;
    try {
      const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit' });
      if (result.error) throw result.error;
      code = result.status === null ? 137 : result.status;
    } finally {
      value.finished_at = stamp(); value.state = 'completed'; value.exit_code = code;
      value.duration_ms = Date.now() - startedMs; value.timed_out = value.duration_ms > timeout * 1000;
      atomic(file, value);
      atomic(path.join(directory, 'latest.json'), value);
    }
    return code >= 0 ? code : 128 - code;
  } finally {
    fs.closeSync(lockFd);
    try { fs.unlinkSync(lockFile); } catch { /* 已被清理 */ }
  }
}

function main(): number {
  process.umask(0o077);
  const argv = process.argv.slice(2);
  const take = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    if (index < 0) return undefined;
    const value = argv[index + 1];
    argv.splice(index, 2);
    return value;
  };
  const root = take('--root');
  const component = take('--component');
  const deployment = take('--deployment');
  const timeout = Number(take('--timeout') ?? 600);
  if (!root) throw new Error('root_required');
  if (component !== 'ordinary' && component !== 'premium') throw new Error('component_invalid');
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('timeout_invalid');
  if (argv[0] === '--') argv.shift();
  if (!argv.length) throw new Error('existing scheduler command required');
  return record(root, component, argv, deployment, timeout);
}

if (process.argv[1] && process.argv[1].endsWith('record-run.ts')) {
  try { process.exitCode = main(); }
  catch (error) { console.error(String((error as Error).message || error)); process.exitCode = 1; }
}
