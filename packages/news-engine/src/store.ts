import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, unlinkSync, lstatSync, existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import * as tar from 'tar';
import { atomic, command, contained, digest, pyjson, read, stamp, day, type Row } from './core.ts';

const TABLES = ['articles', 'observations', 'jobs', 'issues', 'calls', 'meta'];
export function files(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error('symlink_in_state');
    return entry.isDirectory() ? files(root + '/' + entry.name) : [root + '/' + entry.name];
  });
}
export class Store {
  root: string; syncGit: boolean; db: DatabaseSync; objects: Row; missing: string[] = [];
  constructor(root: string, syncGit = false) {
    this.root = resolve(root); this.syncGit = syncGit; mkdirSync(this.root, { recursive: true });
    if (syncGit) {
      const repo = JSON.parse(command(['gh', 'repo', 'view', '--json', 'nameWithOwner,visibility'], this.root));
      if (repo.nameWithOwner !== 'nowscott/EverydayTechNews-data' || repo.visibility !== 'PRIVATE') throw new Error('only_designated_private_state_repository_allowed');
    }
    this.db = new DatabaseSync(this.root + '/state.sqlite3', { timeout: 30000 });
    this.db.exec(`CREATE TABLE IF NOT EXISTS articles (id TEXT, fingerprint TEXT, data TEXT, PRIMARY KEY(id,fingerprint));
      CREATE TABLE IF NOT EXISTS issues (id TEXT PRIMARY KEY, data TEXT);
      CREATE TABLE IF NOT EXISTS jobs (key TEXT PRIMARY KEY, article TEXT, status TEXT, result TEXT, attempts INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS calls (id INTEGER PRIMARY KEY, day TEXT, job TEXT, reserved REAL, cost REAL, usage TEXT, status TEXT, seconds REAL);
      CREATE TABLE IF NOT EXISTS responses (call_id INTEGER PRIMARY KEY, data TEXT, validation_error TEXT);
      CREATE TABLE IF NOT EXISTS observations (id TEXT, fingerprint TEXT, observed_at TEXT, feed_hash TEXT);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, data TEXT);`);
    const columns = new Set(this.all('PRAGMA table_info(calls)').map(r => r.name));
    for (const [name, definition] of [['tariff_multiplier', 'REAL DEFAULT 1'], ['execution_mode', "TEXT DEFAULT 'scheduled_window'"], ['http_status', 'INTEGER']]) {
      if (!columns.has(name)) this.db.exec(`ALTER TABLE calls ADD COLUMN ${name} ${definition}`);
    }
    this.objects = existsSync(this.root + '/archive-manifests/objects.json') ? read(this.root + '/archive-manifests/objects.json') : {};
    try { if (existsSync(this.root + '/durable/state.json')) this.restore(); } catch (error) { this.db.close(); throw error; }
  }
  all(sql: string, ...args: any[]): Row[] { return this.db.prepare(sql).all(...args) as Row[]; }
  one(sql: string, ...args: any[]): Row | undefined { return this.db.prepare(sql).get(...args) as Row | undefined; }
  run(sql: string, ...args: any[]) { return this.db.prepare(sql).run(...args); }
  tx(fn: () => void) { this.db.exec('BEGIN'); try { fn(); this.db.exec('COMMIT'); } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  putBulk(ref: string, payload: Buffer, captured = stamp()) {
    const entry = this.objects[ref];
    if (entry && Date.now() >= Date.parse(entry.expires_at)) return;
    if (!entry) this.objects[ref] = { sha256: digest(payload), bytes: payload.length, captured_at: captured, expires_at: stamp(new Date(Date.parse(captured) + 90 * 86400000)) };
    if (digest(payload) !== this.objects[ref].sha256) throw new Error('evidence_hash_conflict');
    const path = contained(this.root + '/transient', ref);
    if (existsSync(path) && digest(readFileSync(path)) !== this.objects[ref].sha256) throw new Error('evidence_integrity_failed');
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, payload, { mode: 0o600 });
  }
  shrink(value: any): any {
    if (Array.isArray(value)) return value.map(v => this.shrink(v));
    if (!value || typeof value !== 'object') return value;
    const obj = { ...value };
    if ('text' in obj) {
      const body = Buffer.from(pyjson({ text: obj.text, description_clean: obj.description_clean ?? '' }));
      delete obj.text; delete obj.description_clean;
      const ref = 'bodies/' + digest(body) + '.json';
      if (!obj.evidence_expired_or_missing) { this.putBulk(ref, body, obj.fetched_at); obj._body_ref = ref; }
      delete obj.offline_excerpt;
    }
    delete obj.failed_model_responses;
    for (const field of ['feed_snapshot', 'body_snapshot']) if (field in obj) obj[field] = String(obj[field]).split('/feeds/').at(-1);
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, this.shrink(v)]));
  }
  expand(value: any): any {
    if (Array.isArray(value)) return value.map(v => this.expand(v));
    if (!value || typeof value !== 'object') return value;
    const obj: Row = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.expand(v)]));
    if (obj._body_ref) {
      const ref = obj._body_ref; const path = contained(this.root + '/transient', ref); const entry = this.objects[ref];
      if (entry && existsSync(path) && Date.now() < Date.parse(entry.expires_at)) {
        const raw = readFileSync(path); if (digest(raw) !== entry.sha256) throw new Error('evidence_integrity_failed');
        Object.assign(obj, JSON.parse(raw.toString('utf8'))); delete obj.evidence_expired_or_missing;
      } else { obj.text = ''; obj.description_clean = ''; obj.evidence_expired_or_missing = true; this.missing.push(ref); }
    }
    return obj;
  }
  restore() {
    const doc = read(this.root + '/durable/state.json'); if (doc.schema_version !== 1) throw new Error('unsupported_state_version');
    if (TABLES.some(t => !Array.isArray(doc.tables[t]))) throw new Error('missing_state_table');
    this.tx(() => {
      for (const table of [...TABLES, 'responses']) this.db.exec('DELETE FROM ' + table);
      for (const [table, rows] of Object.entries(doc.tables)) {
        if (!TABLES.includes(table)) throw new Error('unknown_state_table');
        const columns = new Set(this.all('PRAGMA table_info(' + table + ')').map(r => r.name));
        for (const original of rows as Row[]) {
          const row = { ...original }; if (Object.keys(row).some(k => !columns.has(k))) throw new Error('unknown_state_column');
          for (const field of ['data', 'article', 'result']) if (row[field]) row[field] = pyjson(this.expand(JSON.parse(row[field])));
          const keys = Object.keys(row); this.run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map(k => row[k]));
        }
      }
      for (const path of files(this.root + '/transient/responses')) {
        const ref = relative(this.root + '/transient', path); const entry = this.objects[ref];
        if (!entry || Date.now() >= Date.parse(entry.expires_at)) continue;
        const raw = readFileSync(path); if (digest(raw) !== entry.sha256) throw new Error('response_integrity_failed');
        const row = JSON.parse(raw.toString()); this.run('INSERT OR REPLACE INTO responses VALUES (?,?,?)', row.call_id, row.data, row.validation_error ?? null);
      }
    });
    const health = this.one("SELECT data FROM meta WHERE key='health'"); if (health) atomic(this.root + '/source-health.json', JSON.parse(health.data));
  }
  checkpoint() {
    const tables: Row = {};
    for (const table of TABLES) {
      tables[table] = this.all('SELECT * FROM ' + table + ' ORDER BY rowid').map(raw => {
        const row = { ...raw }; for (const field of ['data', 'article', 'result']) if (row[field]) row[field] = pyjson(this.shrink(JSON.parse(row[field])), true);
        return row;
      });
    }
    for (const row of this.all('SELECT * FROM responses')) this.putBulk('responses/' + row.call_id + '.json', Buffer.from(pyjson(row)));
    for (const path of files(this.root + '/feeds')) { this.putBulk('raw/feeds/' + relative(this.root + '/feeds', path), readFileSync(path)); unlinkSync(path); }
    atomic(this.root + '/archive-manifests/objects.json', this.objects); atomic(this.root + '/durable/state.json', { schema_version: 1, tables });
    if (this.syncGit) this.push();
  }
  push() {
    const paths = ['durable', 'archive-manifests', 'issues', 'deliveries', 'trial.json', 'test-delivery-config.json', 'status.json', 'trial-report.json'].filter(p => existsSync(this.root + '/' + p));
    command(['git', 'add', '--', ...paths], this.root);
    const changed = command(['git', 'diff', '--cached', '--name-only'], this.root);
    if (changed.trim()) command(['git', 'commit', '-m', 'Persist internal TS newsletter state'], this.root);
    command(['git', 'push', 'origin', 'HEAD:main'], this.root);
  }
  expire() {
    for (const [ref, entry] of Object.entries(this.objects) as [string, Row][]) if (Date.now() >= Date.parse(entry.expires_at)) {
      rmSync(contained(this.root + '/transient', ref), { force: true }); entry.status = 'expired';
    }
    atomic(this.root + '/archive-manifests/objects.json', this.objects);
  }
  archive(captureDay?: string): string {
    for (const directory of ['reviews', 'drafts']) for (const path of files(this.root + '/transient/' + directory)) this.putBulk(relative(this.root + '/transient', path), readFileSync(path));
    this.checkpoint(); this.expire();
    const path = this.root + '/.cache/evidence.tar.gz'; mkdirSync(dirname(path), { recursive: true });
    const paths = Object.entries(this.objects).filter(([ref, entry]: [string, any]) => entry.status !== 'expired' && existsSync(contained(this.root + '/transient', ref))
      && (!captureDay || day(new Date(entry.captured_at)) === captureDay)).map(([ref]) => 'transient/' + ref);
    mkdirSync(this.root + '/transient', { recursive: true });
    if (paths.length) tar.c({ file: path, cwd: this.root, sync: true, gzip: true, portable: true }, paths);
    else { const empty = this.root + '/.cache/empty'; mkdirSync(empty + '/transient', { recursive: true }); tar.c({ file: path, cwd: empty, sync: true, gzip: true, portable: true }, ['transient']); }
    return path;
  }
}

export function extractEvidence(root: string, archive: string) {
  let bytes = 0;
  tar.x({ file: archive, cwd: root, sync: true, strict: true, preservePaths: false,
    filter: (path, entry) => {
      if (path.startsWith('/') || path.includes('\\') || path.split('/').includes('..') || !path.startsWith('transient/')
        || !('type' in entry) || !['File', 'Directory'].includes(entry.type)) throw new Error('unsafe_archive_entry');
      bytes += entry.size; if (bytes > 1024 * 1024 * 1024) throw new Error('oversized_archive');
      const target = contained(root, path); let current = root;
      for (const piece of relative(root, target).split('/')) { current += '/' + piece; if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error('archive_symlink'); }
      return true;
    } });
}
export function restoreArtifacts(root: string) {
  const pointer = root + '/archive-manifests/latest.json'; if (!existsSync(pointer)) return;
  const latest = read(pointer); const buckets = latest.kind === 'daily_buckets' ? Object.entries(read(root + '/archive-manifests/days.json')) : [[null, latest]];
  for (const [capture, data] of buckets as [string | null, Row][]) {
    if (capture && Date.now() >= Date.parse(capture + 'T00:00:00+08:00') + 91 * 86400000) continue;
    if (data.kind !== 'migration_release' && Date.now() >= Date.parse(data.at) + 90 * 86400000) continue;
    const cache = root + '/.cache/download'; rmSync(cache, { recursive: true, force: true }); mkdirSync(cache, { recursive: true });
    if (data.kind === 'migration_release') {
      if (!data.release_tag.startsWith('premium-migration-')) throw new Error('invalid_migration_tag');
      command(['gh', 'release', 'download', data.release_tag, '--repo', process.env.GITHUB_REPOSITORY!, '--pattern', 'evidence.tar.gz', '--dir', cache]);
    } else command(['gh', 'run', 'download', String(data.run_id), '--repo', process.env.GITHUB_REPOSITORY!, '--name', data.artifact_name, '--dir', cache]);
    extractEvidence(root, cache + '/evidence.tar.gz'); rmSync(cache, { recursive: true, force: true });
  }
}
export function acknowledgeArtifact(store: Store) {
  const root = store.root; const today = day(); const days = existsSync(root + '/archive-manifests/days.json') ? read(root + '/archive-manifests/days.json') : {};
  const pointer = root + '/archive-manifests/latest.json'; const previous = existsSync(pointer) ? read(pointer) : {};
  const name = `pool-evidence-${today}-${process.env.GITHUB_RUN_ID}`;
  days[today] = { run_id: process.env.GITHUB_RUN_ID, artifact_name: name, at: stamp() };
  atomic(root + '/archive-manifests/days.json', days); atomic(pointer, { kind: 'daily_buckets', retention_days: 90, at: stamp() }); store.checkpoint();
  const repo = process.env.GITHUB_REPOSITORY!;
  if (previous.kind === 'migration_release') {
    if (!previous.release_tag.startsWith('premium-migration-')) throw new Error('invalid_migration_tag');
    command(['gh', 'release', 'delete', previous.release_tag, '--repo', repo, '--yes', '--cleanup-tag']);
  }
  const retained = new Set(Object.entries(days).filter(([date]) => Date.now() < Date.parse(date + 'T00:00:00+08:00') + 91 * 86400000).map(([, entry]: [string, any]) => entry.artifact_name));
  const lines = command(['gh', 'api', '--paginate', `repos/${repo}/actions/artifacts`, '--jq', '.artifacts[] | [.id,.name,.size_in_bytes] | @tsv']);
  let bytes = 0; let count = 0;
  for (const line of lines.trim().split('\n').filter(Boolean)) {
    const [id, artifact, size] = line.split('\t'); if (!artifact.startsWith('pool-evidence-')) continue;
    if (!retained.has(artifact)) command(['gh', 'api', '--method', 'DELETE', `repos/${repo}/actions/artifacts/${id}`]); else { bytes += Number(size); count++; }
  }
  store.run('INSERT OR REPLACE INTO meta VALUES (?,?)', 'artifact_storage', pyjson({ at: stamp(), bytes, count, quota_or_bill: 'not_verified' })); store.checkpoint();
}
