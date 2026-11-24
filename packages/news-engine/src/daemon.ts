// 高级版常驻调度（TS）：替代 */15 crontab，进程内按 15/30 分钟节奏跑一轮 run。
// 与普通版 scheduler 同构：状态写 data/scheduler/status.json，每轮写 runs/ 与 logs/。
import { mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 夜间（23:00–03:59）降到每 3 小时一轮，白天保持 30 分钟，早高峰 15 分钟。 */
export function quietNow(at: Date = new Date()): boolean { const hour = at.getHours(); return hour >= 23 || hour < 4; }

export function dueAtPremium(at: Date): boolean {
  const hour = at.getHours(), minute = at.getMinutes();
  if (hour >= 4 && hour < 6) return minute % 15 === 0;
  if (hour === 6) return minute < 15 ? minute % 15 === 0 : minute === 30;
  if (hour >= 7 && hour < 23) return minute % 30 === 0;
  // 23、0、1、2、3 点：只在整点跑，即 23:00、03:00（跨 0 点由整点自然覆盖）。
  return minute === 0 && (hour === 23 || hour === 3);
}

/** 锁里的 pid 必须真的是调度进程；容器重启后旧 pid 常被别的进程复用。 */
export function pidIsScheduler(pid: number, read: (path: string) => string = (path) => readFileSync(path, 'utf8')): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { return /daemon\.ts|scheduler\.ts/.test(read(`/proc/${pid}/cmdline`)); }
  catch { try { process.kill(pid, 0); return true; } catch { return false; } }
}

export function nextRun(from: Date): Date {
  const next = new Date(from.getTime());
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1, 0, 0);
  for (let i = 0; i < 24 * 60; i++) {
    if (dueAtPremium(next)) return next;
    next.setMinutes(next.getMinutes() + 1, 0, 0);
  }
  throw new Error('premium_schedule_unreachable');
}

export function policy(): string {
  return '04-06:14:15m,07-23:30m,night:23:00/03:00';
}

interface Options { data: string; once: boolean; timeoutMs: number }

function parseArgs(args: string[]): Options {
  const index = args.indexOf('--data');
  const timeout = args.indexOf('--timeout');
  return {
    data: resolve(index >= 0 && args[index + 1] ? args[index + 1] : '/data'),
    once: args.includes('--once'),
    timeoutMs: (timeout >= 0 ? Number(args[timeout + 1]) : 600) * 1000,
  };
}

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;
const CLI = new URL('./main.ts', import.meta.url).pathname;

function runRound(options: Options): Promise<{ exit: number; seconds: number; tail: string }> {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, 'run', '--data', options.data, '--local-authority', '--maintenance-only', 'false'], {
      env: { ...process.env, TZ: 'Asia/Shanghai' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    });
    const pid = child.pid ?? 0;
    let tail = '';
    const collect = (chunk: Buffer) => { tail = (tail + chunk.toString()).slice(-4000); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    // 超时必须杀整个进程组：flock 是独立进程，只杀子进程会留下仍持锁的 node 孤儿。
    const killer = setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch { /* 已退出 */ } }, options.timeoutMs);
    child.on('close', (code) => { clearTimeout(killer); done({ exit: code ?? 1, seconds: (Date.now() - started) / 1000, tail }); });
  });
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const scheduler = options.data + '/scheduler';
  for (const dir of [scheduler, scheduler + '/runs', scheduler + '/logs']) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const statusPath = scheduler + '/status.json';
  const started = new Date().toISOString();
  let timer: NodeJS.Timeout | undefined, beat: NodeJS.Timeout | undefined, busy = false, stopping = false, ticks = 0, failures = 0;
  let last: Record<string, unknown> | null = null;
  let next: Date | null = null;

  const publish = (extra: Record<string, unknown> = {}) => {
    writeFileSync(statusPath, JSON.stringify({ schema_version: 1, component: 'premium', scheduler: { version: VERSION, pid: process.pid,
      mode: 'resident', policy: policy(), started_at: started, heartbeat_at: new Date().toISOString(), stopping, ticks, failures,
      last_tick: last, next_tick: next ? next.toISOString() : null, ...extra } }));
  };
  const trim = (dir: string) => {
    const names = readdirSync(dir).filter((n) => /^\d/.test(n)).sort();
    for (const name of names.slice(0, Math.max(0, names.length - 200))) rmSync(dir + '/' + name, { force: true });
  };

  const cycle = async () => {
    if (stopping) return;
    busy = true;
    const at = new Date().toISOString();
    const runId = at + '-' + randomUUID().slice(0, 8);
    const record: Record<string, unknown> = { run_id: runId, component: 'premium', started_at: at, finished_at: null, state: 'running', exit_code: null };
    const recordPath = scheduler + '/runs/' + at.replace(/:/g, '-') + '-' + runId.slice(-8) + '.json';
    writeFileSync(recordPath, JSON.stringify(record));
    writeFileSync(scheduler + '/runs/latest.json', JSON.stringify(record));
    try {
      const result = await runRound(options);
      if (result.exit === 0) ticks++; else failures++;
      last = { at, status: result.exit === 0 ? 'completed' : 'failed', exit_code: result.exit, seconds: result.seconds };
      Object.assign(record, { finished_at: new Date().toISOString(), state: 'completed', exit_code: result.exit });
      writeFileSync(scheduler + '/logs/' + at.replace(/:/g, '-') + '-' + runId.slice(-8) + '.json', JSON.stringify({ ...last, tail: result.tail }));
    } catch (error) {
      failures++;
      last = { at, status: 'failed', error: String((error as Error).message ?? error) };
      Object.assign(record, { finished_at: new Date().toISOString(), state: 'completed', exit_code: 1 });
      console.error(JSON.stringify({ at, error: last.error }));
    } finally {
      busy = false;
      writeFileSync(recordPath, JSON.stringify(record));
      writeFileSync(scheduler + '/runs/latest.json', JSON.stringify(record));
      trim(scheduler + '/runs'); trim(scheduler + '/logs');
    }
    next = nextRun(new Date());
    publish();
    console.log(JSON.stringify({ at: new Date().toISOString(), ticks, failures, last, next: next!.toISOString() }));
    timer = setTimeout(cycle, Math.max(1000, next!.getTime() - Date.now()));
  };

  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    if (timer) clearTimeout(timer);
    if (beat) clearInterval(beat);
    publish({ stopped_at: new Date().toISOString(), signal });
    const finish = () => process.exit(0);
    if (busy) { const wait = setInterval(() => { if (!busy) { clearInterval(wait); finish(); } }, 200); } else finish();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // 单实例保护：容器内固定一个 daemon，重复启动直接退出，避免双调度。
  const lock = scheduler + '/daemon.lock';
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, 'utf8').trim());
    if (pidIsScheduler(pid)) { console.log(JSON.stringify({ status: 'already_running', pid })); process.exit(0); }
    // pid 在容器里可能被别的进程复用，或来自上一个容器；确认不是调度进程就接管。
  }
  writeFileSync(lock, String(process.pid));
  process.on('exit', () => { try { rmSync(lock, { force: true }); } catch { /* ignore */ } });

  publish();
  // 心跳独立于轮次：一轮可能跑 5 分钟，看板要靠心跳判断进程是否存活。
  beat = setInterval(() => publish(), 60000);
  console.log(JSON.stringify({ at: new Date().toISOString(), status: 'scheduler_started', policy: policy(), version: VERSION }));
  if (options.once) { void cycle().then(() => { if (timer) clearTimeout(timer); }); return; }
  // 部署完先跑一轮：但夜间安静时段不跑，避免半夜复制/归档把 NAS 风扇拉满。
  if (quietNow()) { next = nextRun(new Date()); publish(); timer = setTimeout(cycle, Math.max(1000, next.getTime() - Date.now())); }
  else void cycle();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
