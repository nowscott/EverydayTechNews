/** 普通版账本哈希：与 deploy/ordinary/manage.py 的 ledger() 逐字节一致。 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/** 复刻 Python json.dumps(..., separators=(',', ':'), ensure_ascii=True) 的行序列化。 */
export function pythonJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number not JSON serializable');
    if (Number.isInteger(value)) return String(value);
    return value.toString();
  }
  if (typeof value === 'string') return pythonString(value);
  if (Array.isArray(value)) return '[' + value.map(pythonJson).join(',') + ']';
  throw new TypeError('unsupported ledger value: ' + typeof value);
}

function pythonString(text: string): string {
  let out = '"';
  for (const ch of text) {
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

export function ledger(file: string): string {
  if (!fs.existsSync(file)) return crypto.createHash('sha256').update(Buffer.from('empty')).digest('hex');
  const digest = crypto.createHash('sha256');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    for (const table of ['issues', 'deliveries']) {
      digest.update(Buffer.from(table + '\0'));
      const rows = db.prepare('SELECT * FROM ' + table + ' ORDER BY id').all();
      for (const row of rows) {
        const values = Object.values(row as Record<string, unknown>);
        digest.update(Buffer.from(pythonJson(values) + '\n'));
      }
    }
    return digest.digest('hex');
  } finally { db.close(); }
}
