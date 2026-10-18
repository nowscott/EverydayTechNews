import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, openSync, closeSync, fsyncSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Persistence records retain legacy optional fields; external values are checked at boundaries.
export type Row = Record<string, any>;
export const RECIPIENT = 'nowscott@qq.com';
export const EXPIRY = '2026-10-26T00:00:00+08:00';
export const digest = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export function pyjson(value: any, sorted = false): string {
  if (Array.isArray(value)) return '[' + value.map(v => pyjson(v, sorted)).join(', ') + ']';
  if (value && typeof value === 'object') return '{' + (sorted ? Object.keys(value).sort() : Object.keys(value))
    .filter(k => value[k] !== undefined).map(k => JSON.stringify(k) + ': ' + pyjson(value[k], sorted)).join(', ') + '}';
  return JSON.stringify(value ?? null);
}
export const read = (p: string): any => JSON.parse(readFileSync(p, 'utf8'));
export function atomic(p: string, value: any) {
  mkdirSync(dirname(p), { recursive: true }); const temp = p + '.tmp';
  const fd = openSync(temp, 'w', 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, p);
  const dir = openSync(dirname(p), 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
}
export function contained(root: string, relative: string) {
  const path = resolve(root, relative);
  if (!path.startsWith(resolve(root) + sep)) throw new Error('unsafe_path');
  return path;
}
export function command(argv: string[], cwd?: string): string {
  const result = spawnSync(argv[0], argv.slice(1), { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`external_command_failed:${argv[0]}:${argv[1] ?? ''}`);
  return result.stdout;
}
export function stamp(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600000).toISOString().replace(/\.000Z$/, '+08:00').replace('Z', '000+08:00');
}
export const day = (d = new Date()) => stamp(d).slice(0, 10);
export const localParts = (d = new Date()) => ({ hour: Number(stamp(d).slice(11, 13)), minute: Number(stamp(d).slice(14, 16)) });
export const at = (date: string, time: string) => new Date(`${date}T${time}+08:00`);
export function policy(): Row { return read(fileURLToPath(new URL('../../../experiments/premium/policy.json', import.meta.url))); }
export function trial(root: string): Row {
  const t = read(root + '/trial.json');
  if (t.schema_version !== 1 || t.mode !== 'internal_test' || t.production_enabled !== false || t.allowed_recipient !== RECIPIENT
    || t.start !== '2026-10-19' || t.days !== 7 || Date.parse(t.expires_at) !== Date.parse(EXPIRY)
    || !(t.daily_budget_cny > 0 && t.daily_budget_cny <= 2)) throw new Error('invalid_trial_boundary');
  return t;
}
export const active = (t: Row, now = new Date()) => t.enabled === true && day(now) >= t.start && now.getTime() < Date.parse(t.expires_at);
export const exists = existsSync;
