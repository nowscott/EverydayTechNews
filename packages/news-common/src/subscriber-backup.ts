import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

type Snapshot<T> = { schema_version: 1; kind: string; saved_at: string; subscribers: T[] };
export type AudienceReport = { source: 'notion' | 'backup'; saved_at: string; count: number; reason?: string };
type Options<T> = {
  root: string; kind: string; get: () => Promise<T[]>; valid: (item: unknown) => item is T;
  deadline: Date; now?: () => Date; sleep?: (ms: number) => Promise<void>; fallback?: boolean;
};
export async function resolveAudience<T>(options: Options<T>): Promise<{ subscribers: T[]; report: AudienceReport }> {
  const { root, kind, get, valid, deadline } = options;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const path = `${root}/subscriber-backups/${kind}.json`;
  let failure: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (now() >= deadline) throw new Error('notion_delivery_deadline');
    try {
      const subscribers = await get();
      if (!Array.isArray(subscribers) || !subscribers.every(valid)) throw new Error('notion_invalid_subscribers');
      const snapshot: Snapshot<T> = { schema_version: 1, kind, saved_at: now().toISOString(), subscribers };
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const temp = path + '.tmp'; const fd = openSync(temp, 'w', 0o600);
      try { writeFileSync(fd, JSON.stringify(snapshot)); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp, path);
      const dir = openSync(dirname(path), 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
      return { subscribers, report: { source: 'notion', saved_at: snapshot.saved_at, count: subscribers.length } };
    } catch (error) {
      failure = error as Error;
      if (!/^notion_(network_failure|http_(429|5\d\d))$/.test(failure.message)) throw error;
      if (attempt < 2) {
        const delay = Math.max(attempt === 0 ? 5000 : 15000, (error as Error & { retryAfterMs?: number }).retryAfterMs ?? 0);
        if (now().getTime() + delay >= deadline.getTime()) break;
        await sleep(delay);
      }
    }
  }
  if (options.fallback === false) throw failure;
  let snapshot: Snapshot<T>;
  try { snapshot = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error('notion_backup_unavailable'); }
  const saved = Date.parse(snapshot?.saved_at);
  if (!snapshot || snapshot.schema_version !== 1 || snapshot.kind !== kind || !Number.isFinite(saved) || saved > now().getTime()
    || now().getTime() - saved > 7 * 86400000 || !Array.isArray(snapshot.subscribers) || !snapshot.subscribers.every(valid)) {
    throw new Error('notion_backup_invalid_or_expired');
  }
  return { subscribers: snapshot.subscribers, report: { source: 'backup', saved_at: snapshot.saved_at, count: snapshot.subscribers.length, reason: failure?.message } };
}
