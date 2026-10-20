import { createHash } from 'node:crypto';
import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, readFileSync, existsSync, lstatSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
export type Row = Record<string, any>;
export const OWNER = 'nowscott@qq.com';
export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;
export const day = (now = new Date()) => new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
export const yesterday = (now = new Date()) => day(new Date(now.getTime() - 86400000));
export const at = (date: string, time: string) => new Date(date + 'T' + time + '+08:00');
export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const read = (path: string, fallback?: any): any => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
export function atomicText(path: string, value: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = path + '.tmp'; const fd = openSync(temp, 'w', 0o600);
  try { writeFileSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path); const dir = openSync(dirname(path), 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
}
export const atomic = (path: string, value: any) => atomicText(path, JSON.stringify(value, null, 2) + '\n');
export const validEmail = (s: string) => /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(s);
export function config(root: string): Row {
  const c = read(root + '/config.json');
  if (!c || c.schema_version !== 1 || !['shadow', 'production', 'paused'].includes(c.mode) || c.test_recipient !== OWNER
    || c.delivery_cutoff !== '09:00' || c.delivery_start !== '06:30') throw new Error('ordinary_configuration_invalid');
  if (c.mode === 'production') {
    const proof = read(root + '/cutover.json');
    if (!proof || proof.legacy_workflows_disabled !== true || proof.legacy_guard_enabled !== true || proof.shadow_gate_passed !== true
      || proof.first_production_date !== c.first_production_date || !/^\d{4}-\d{2}-\d{2}$/.test(c.first_production_date ?? '')) throw new Error('ordinary_cutover_proof_required');
  }
  return c;
}
export function privateRoot(root: string) {
  const path = resolve(root); if (lstatSync(path).isSymbolicLink() || (lstatSync(path).mode & 0o077)) throw new Error('ordinary_private_state_required');
  return path;
}
export function initialConfig() { return { schema_version: 1, mode: 'shadow', test_recipient: OWNER,
  delivery_start: '06:30', delivery_cutoff: '09:00', first_production_date: null, archive_sync_enabled: false, shadow_started_on: day(new Date(Date.now()+86400000)) }; }
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export function safeError(error: unknown): string { return error instanceof Error && /^(ordinary_|notion_|archive_|source_|grade_|all_collection_sources_failed$|yesterday_archive_missing$)[a-z0-9_:-]*$/i.test(error.message) ? error.message : 'external_operation_failed'; }
