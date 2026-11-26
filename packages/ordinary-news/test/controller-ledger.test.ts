import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ledger } from '../src/controller/ledger.ts';

test('ledger hash stays byte-identical to the frozen controller contract', () => {
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

  // 冻结自旧控制器（Python 版）的逐字节输出：账本口径一变就会失配，用于拦截兼容性回归。
  assert.equal(ledger(file), 'c877daf12713a285d558367a2d681819e20dbf7341054e465a83f1d47bb4632b');
  assert.equal(ledger(path.join(dir, 'missing.sqlite3')), '2e1cfa82b035c26cbbbdae632cea070514eb8b773f616aaeaf668e2f0be8f10d');
});
