import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { atomic, read, initialConfig, privateRoot, type Row } from './core.ts';
export class Store {
  root: string; db: DatabaseSync;
  constructor(root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 }); this.root = privateRoot(root);
    this.db = new DatabaseSync(this.root + '/state.sqlite3', { timeout: 30000 });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS grades(day TEXT,url TEXT,score REAL,status TEXT,data TEXT, PRIMARY KEY(day,url));
      CREATE TABLE IF NOT EXISTS issues(id TEXT PRIMARY KEY,day TEXT,mode TEXT,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,issue TEXT,email TEXT,status TEXT,attempts INTEGER,data TEXT NOT NULL,UNIQUE(issue,email));
      CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,data TEXT NOT NULL);`);
    const version = this.one("SELECT data FROM meta WHERE key='schema_version'");
    if (version && version.data !== '1') throw new Error('ordinary_state_schema_unsupported');
    this.run("INSERT OR IGNORE INTO meta VALUES ('schema_version','1')");
    if (!read(this.root + '/config.json')) atomic(this.root + '/config.json', initialConfig());
  }
  one(sql: string, ...args: any[]): Row | undefined { return this.db.prepare(sql).get(...args) as Row | undefined; }
  all(sql: string, ...args: any[]): Row[] { return this.db.prepare(sql).all(...args) as Row[]; }
  run(sql: string, ...args: any[]) { return this.db.prepare(sql).run(...args); }
  tx<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const value = fn(); this.db.exec('COMMIT'); return value; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  meta(key: string, value?: any): any {
    if (value !== undefined) this.run('INSERT OR REPLACE INTO meta VALUES (?,?)', key, JSON.stringify(value));
    const row = this.one('SELECT data FROM meta WHERE key=?', key); return row ? JSON.parse(row.data) : null;
  }
  ledger() { return { issues: this.all('SELECT * FROM issues ORDER BY id'), deliveries: this.all('SELECT * FROM deliveries ORDER BY id') }; }
  close() { this.db.close(); }
}
