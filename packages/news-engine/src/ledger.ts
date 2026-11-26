// 部署校验用的账本指纹：把同一份账本（state.json 与恢复后的 SQLite）折算成可比较的规范化哈希。
// 行数相等不代表内容相等（金额、冻结刊物正文都能在不改行数的情况下变化），所以逐行指纹必须落在内容上。
import { createHash } from 'node:crypto';
import { closeSync, openSync, readSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { JSONParser } from '@streamparser/json';

export const LEDGER_TABLES = ['calls', 'issues'] as const;
export type Row = Record<string, any>;

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** 与 Store.shrink 对齐：正文折成 bodies 引用（引用本身是正文的哈希），恢复后再折算结果必须一致。 */
export function condense(value: any): any {
  if (Array.isArray(value)) return value.map(condense);
  if (!value || typeof value !== 'object') return value;
  const out: Row = { ...value };
  if ('text' in out) {
    // 与 core.ts 的 pyjson 逐字节一致：`{"text": ..., "description_clean": ...}`。
    const body = '{"text": ' + JSON.stringify(out.text) + ', "description_clean": ' + JSON.stringify(out.description_clean ?? '') + '}';
    out._body_ref = 'bodies/' + sha(body) + '.json';
    delete out.text; delete out.description_clean;
  }
  delete out.offline_excerpt; delete out.failed_model_responses;
  for (const field of ['feed_snapshot', 'body_snapshot']) if (field in out) out[field] = String(out[field]).split('/feeds/').at(-1);
  return Object.fromEntries(Object.entries(out).map(([key, item]) => [key, condense(item)]));
}

/** 键序无关的序列化：state.json 存的是排好序的 pyjson，恢复后会多出正文等字段，顺序不可依赖。 */
function stable(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value ?? null);
}

/** 单行规范化文本：JSON 列先展开成结构化内容，再按 shrink 规则折算。 */
export function canonicalRow(row: Row): string {
  const copy: Row = { ...row };
  for (const field of ['data', 'article', 'result']) {
    const value = copy[field];
    if (typeof value !== 'string') continue;
    try { copy[field] = condense(JSON.parse(value)); } catch { /* 畸形 JSON 保留原值，让差异体现在哈希上 */ }
  }
  return stable(copy);
}

export function tableFingerprint(rows: Row[]): string {
  // 顺序无关：同一批行无论先写哪一条，指纹都必须相同。
  return sha(rows.map(canonicalRow).sort().join('\n'));
}

/** state.json 里声明的内容指纹（流式读取，不再整体 JSON.parse）。 */
export function declaredLedger(state: string, tables: string[] = [...LEDGER_TABLES]): { schema: unknown; tables: Record<string, string> } {
  const rows: Record<string, Row[]> = Object.fromEntries(tables.map(table => [table, []]));
  let schema: unknown;
  const parser = new JSONParser({ paths: ['$.schema_version', '$.tables.*', ...tables.map(table => '$.tables.' + table + '.*')], keepStack: false });
  parser.onValue = ({ value, key, stack }) => {
    if (stack.length === 1 && key === 'schema_version') { schema = value; return; }
    const table = String(stack.length === 2 ? key : stack[2]?.key);
    if (stack.length === 2) {
      // `$.tables.*` 也会匹配到别的表；这里只关心待比对的账本表。
      if (!(table in rows)) return;
      if (!Array.isArray(value)) throw new Error('missing_state_table');
      return;
    }
    if (!(table in rows)) throw new Error('unknown_state_table');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_state_row');
    rows[table].push(value as Row);
  };
  const fd = openSync(state, 'r'); const buffer = Buffer.allocUnsafe(256 * 1024);
  try { let size: number; while ((size = readSync(fd, buffer, 0, buffer.length, null)) > 0) parser.write(buffer.subarray(0, size)); if (!parser.isEnded) parser.end(); }
  finally { closeSync(fd); }
  return { schema, tables: Object.fromEntries(tables.map(table => [table, tableFingerprint(rows[table])])) };
}

/** SQLite 里的实际内容指纹；与 declaredLedger 用同一套规范化，可直接比较。 */
export function storedLedger(db: DatabaseSync, tables: string[] = [...LEDGER_TABLES]): Record<string, string> {
  return Object.fromEntries(tables.map(table => [table, tableFingerprint(db.prepare('SELECT * FROM ' + table + ' ORDER BY id').all() as Row[])]));
}

/**
 * 原始行指纹（不做规范化）：只用于比较「在线主库」与「备份里的主库副本」是不是同一份账本。
 * 数值、文本列来自同一个 SQLite 实现，可以直接比较序列化结果。必须与 deploy/nas/base-manage.ts 的同名逻辑一致。
 */
export function rawLedgerDigest(db: DatabaseSync, tables: string[] = [...LEDGER_TABLES]): string {
  const hash = createHash('sha256');
  for (const table of tables) {
    hash.update(table + '\0');
    for (const row of db.prepare('SELECT * FROM ' + table + ' ORDER BY id').iterate() as Iterable<Row>) hash.update(JSON.stringify(row) + '\n');
  }
  return hash.digest('hex');
}
