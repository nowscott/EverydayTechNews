/** 文件原语：读取 JSON、原子写、进程互斥。 */
import fs from 'node:fs';
import path from 'node:path';

export function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return fallback; }
}

/** 写临时文件（0600）→ fsync → 原子替换 → fsync 目录。 */
export function atomicWrite(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.tmp';
  const fd = fs.openSync(temp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  const dir = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}

/**
 * 互斥锁：独占创建锁文件（含 pid 与时间），进程崩溃留下的锁按 mtime 判定过期。
 * Python 控制器用 flock；这里换成可移植的实现，语义（是否拿到锁）保持一致。
 */
export interface LockOptions { blocking?: boolean; timeoutMs?: number; staleMs?: number; pollMs?: number }

export async function withLock<T>(
  file: string,
  options: LockOptions,
  fn: (acquired: boolean) => Promise<T> | T,
): Promise<T> {
  const { blocking = true, timeoutMs = 30_000, staleMs = 3_600_000, pollMs = 200 } = options;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); } finally { fs.closeSync(fd); }
      try { return await fn(true); } finally {
        try { fs.unlinkSync(file); } catch { /* 已被外部清理 */ }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const stat = fs.statSync(file);
        if (Date.now() - stat.mtimeMs > staleMs) { fs.unlinkSync(file); continue; }
      } catch { continue; }
      if (!blocking) return fn(false);
      if (Date.now() > deadline) return fn(false);
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}
