/**
 * 冻结的跨语言对照快照（Python 参考实现已撤除）。
 *
 * 期望值以前由 Python oracle 现场计算；现在按输入内容的 sha256 从 fixtures 里取，
 * 保证同一批输入仍然被逐字段校验。ETN_RECORD_ORACLE=1 仅用于重新录制快照。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const cache = new Map<string, Record<string, unknown>>();

/** 键序无关的序列化：录制的 Python dict 与 TS 对象键序不同，直接 stringify 会误判。 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(record[key])).join(',') + '}';
  }
  return JSON.stringify(value ?? null);
}

export function digestOf(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function key(input: unknown): string {
  return digestOf(input);
}

function load(file: string): Record<string, unknown> {
  let store = cache.get(file);
  if (!store) {
    store = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> : {};
    cache.set(file, store);
  }
  return store;
}

function save(file: string, store: Record<string, unknown>, id: string, value: unknown): void {
  store[id] = value;
  writeFileSync(file, JSON.stringify(store, null, 1) + '\n');
}

/** 完整输出快照：体积可控时用，失败时能直接看到差异字段。 */
export function snapshot(file: string, input: unknown): any {
  const store = load(file);
  const id = key(input);
  if (!(id in store)) throw new Error(`missing_parity_snapshot:${id}`);
  return store[id];
}

export function record(file: string, input: unknown, value: unknown): any {
  save(file, load(file), key(input), value);
  return value;
}

/**
 * 逐例摘要快照：整份输出过大（含重复正文）时用，只比对每个用例的规范化哈希，
 * 失败信息仍带用例序号和 op。
 */
export function digests(file: string, input: unknown, outputs?: unknown[]): string[] {
  const store = load(file);
  const id = key(input);
  if (outputs) {
    const list = outputs.map(digestOf);
    save(file, store, id, list);
    return list;
  }
  const list = store[id];
  if (!Array.isArray(list)) throw new Error(`missing_parity_snapshot:${id}`);
  return list as string[];
}
