// 高级版常驻调度（TS）：替代 */15 crontab，进程内按 15/30 分钟节奏跑一轮 run。
// 与普通版 scheduler 同构：状态写 data/scheduler/status.json，每轮写 runs/ 与 logs/。
import { mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function intervalMinutes(at: Date): number {
  const hour = at.getHours(), minute = at.getMinutes();
  return hour >= 4 && (hour < 6 || (hour === 6 && minute < 15)) ? 15 : 30;
}

export function nextRun(from: Date): Date {
  const next = new Date(from.getTime());
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1, 0, 0);
  // 逐分钟推进，直到落在「该时刻自己的节奏」的整分边界（跨 06:15 时自动换成 30 分钟档）。
  for (let i = 0; i < 60; i++) {
    if (next.getMinutes() % intervalMinutes(next) === 0) return next;
    next.setMinutes(next.getMinutes() + 1, 0, 0);
  }
  throw new Error('premium_schedule_unreachable');
}

export function policy(): string {
  return '04-06:14:15m,else:30m';
}

interface Options { data: string; once: boolean; timeoutMs: number }

function parseArgs(args: string[]): Options {
  const index = args.indexOf('--data');
  const timeout = args.indexOf('--timeout');
  return {
    data: resolve(index >= 0 && args[index + 1] ? args[index + 1] : '/data'),
    once: args.includes('--once'),
    timeoutMs: (timeout >= 0 ? Number(args[timeout + 1]) : 240) * 1000,
  };
}

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;
const CLI = new URL('./main.ts', import.meta.url).pathname;

function runRound(options: Options): Promise<{ exit: number; seconds: number; tail: string }> {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, 'run', '--data', options.data, '--local-authority'], {
      env: { ...process.env, TZ: 'Asia/Shanghai' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let tail = '';
    const collect = (chunk: Buffer) => { tail = (tail + chunk.toString()).slice(-4000); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const killer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs);
    child.on('close', (code) => { clearTimeout(killer); done({ exit: code ?? 1, seconds: (Date.now() - started) / 1000, tail }); });
  });
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const scheduler = options.data + '/scheduler';
  for (const dir of [scheduler, scheduler + '/runs', scheduler + '/logs']) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const statusPath = scheduler + '/status.json';
  const started = new Date().toISOString();
  let timer: NodeJS.Timeout | undefined, busy = false, stopping = false, ticks = 0, failures = 0;
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
    try { process.kill(pid, 0); console.log(JSON.stringify({ status: 'already_running', pid })); process.exit(0); } catch { /* 旧进程已退出，接管 */ }
  }
  writeFileSync(lock, String(process.pid));
  process.on('exit', () => { try { rmSync(lock, { force: true }); } catch { /* ignore */ } });

  publish();
  console.log(JSON.stringify({ at: new Date().toISOString(), status: 'scheduler_started', policy: policy(), version: VERSION }));
  if (options.once) { void cycle().then(() => { if (timer) clearTimeout(timer); }); return; }
  // 部署完先跑一轮：不等下一个整点，立即执行一轮真实 run。
  void cycle();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
