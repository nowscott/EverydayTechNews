import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ledger } from '../src/controller/ledger.ts';

const PYTHON_LEDGER = `
import hashlib, json, sqlite3, sys
path = sys.argv[1]
if not __import__('os').path.exists(path):
    print(hashlib.sha256(b'empty').hexdigest()); raise SystemExit
digest = hashlib.sha256()
with sqlite3.connect('file:' + path + '?mode=ro', uri=True) as db:
    for table in ['issues', 'deliveries']:
        digest.update((table + chr(0)).encode())
        for row in db.execute('SELECT * FROM ' + table + ' ORDER BY id'):
            digest.update((json.dumps(row, separators=(',', ':')) + chr(10)).encode())
print(digest.hexdigest())
`;

test('ledger hash matches the Python controller byte for byte', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etn-ledger-'));
  const file = path.join(dir, 'state.sqlite3');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE issues (id INTEGER PRIMARY KEY, url TEXT, title TEXT, score REAL, delivered INTEGER)');
  db.exec('CREATE TABLE deliveries (id INTEGER PRIMARY KEY, issue_id INTEGER, to_addr TEXT, note TEXT)');
  const insertIssue = db.prepare('INSERT INTO issues (id, url, title, score, delivered) VALUES (?, ?, ?, ?, ?)');
  insertIssue.run(1, 'https://example.com/a', '中文标题 "引号" \\\\ 路径', 7.5, 1);
  insertIssue.run(2, 'https://example.com/b', 'tab\tnew\nline', 0.1, 0);
  const insertDelivery = db.prepare('INSERT INTO deliveries (id, issue_id, to_addr, note) VALUES (?, ?, ?, ?)');
  insertDelivery.run(1, 1, 'a@example.com', null);
  db.close();

  const ts = ledger(file);
  const py = execFileSync('python3', ['-c', PYTHON_LEDGER, file], { encoding: 'utf8' }).trim();
  assert.equal(ts, py);
  assert.equal(ledger(path.join(dir, 'missing.sqlite3')), '2e1cfa82b035c26cbbbdae632cea070514eb8b773f616aaeaf668e2f0be8f10d');
});
