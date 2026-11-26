import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { applyRetention, retentionDue, retentionPlan } from '../src/retention.ts';

const now = new Date('2026-11-26T03:00:00+08:00');
const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86400000).toISOString();

test('retention keeps recent editions and prunes old noise only', () => {
  const root = mkdtempSync(join(tmpdir(), 'etn-retention-'));
  const store = new Store(root, false, false);
  try {
    mkdirSync(join(root, 'durable', 'assessments'), { recursive: true });
    mkdirSync(join(root, 'transient', 'raw'), { recursive: true });
    const oldAssessment = join(root, 'durable', 'assessments', '20261001235959999999.json');
    const newAssessment = join(root, 'durable', 'assessments', '20261120235959999999.json');
    writeFileSync(oldAssessment, JSON.stringify({ huge: 'old' }));
    writeFileSync(newAssessment, JSON.stringify({ keep: true }));
    const oldRaw = join(root, 'transient', 'raw', 'old-feed.json');
    const newRaw = join(root, 'transient', 'raw', 'new-feed.json');
    const protectedRaw = join(root, 'transient', 'raw', 'evidence.json');
    writeFileSync(oldRaw, 'old'); writeFileSync(newRaw, 'new'); writeFileSync(protectedRaw, 'evidence');
    utimesSync(oldRaw, new Date(at(10)), new Date(at(10)));
    store.objects['raw/evidence.json'] = { sha256: 'a', bytes: 8, captured_at: at(10), expires_at: at(-80) };

    store.run('INSERT INTO observations (id,fingerprint,observed_at,feed_hash) VALUES (?,?,?,?)', 'old-obs', 'f1', at(40), 'h1');
    store.run('INSERT INTO observations (id,fingerprint,observed_at,feed_hash) VALUES (?,?,?,?)', 'new-obs', 'f2', at(2), 'h2');
    store.run('INSERT INTO articles (id,fingerprint,data) VALUES (?,?,?)', 'old-art', 'fp-old', JSON.stringify({ id: 'old-art', fetched_at: at(40) }));
    store.run('INSERT INTO articles (id,fingerprint,data) VALUES (?,?,?)', 'new-art', 'fp-new', JSON.stringify({ id: 'new-art', fetched_at: at(2) }));
    store.run('INSERT INTO jobs (key,article,status,result,attempts) VALUES (?,?,?,?,?)', 'old-job', JSON.stringify({ id: 'old-job', queued_at: at(40) }), 'queued', null, 0);
    store.run('INSERT INTO jobs (key,article,status,result,attempts) VALUES (?,?,?,?,?)', 'approved-job', JSON.stringify({ id: 'approved-job', queued_at: at(40) }), 'ai_approved', '{}', 1);
    store.run('INSERT INTO jobs (key,article,status,result,attempts) VALUES (?,?,?,?,?)', 'new-job', JSON.stringify({ id: 'new-job', queued_at: at(2) }), 'queued', null, 0);

    const plan = retentionPlan(store, {}, now);
    assert.equal(plan.files.assessments.count, 1);
    assert.equal(plan.files.transient.count, 1);
    assert.equal(plan.tables.observations, 1);
    assert.equal(plan.tables.articles, 1);
    assert.equal(plan.tables.jobs, 1);
    assert.ok(plan.estimated_bytes > 0);

    const result = applyRetention(store, plan, now);
    assert.equal(result.status, 'applied');
    assert.equal(store.one("SELECT 1 FROM observations WHERE id='old-obs'"), undefined);
    assert.ok(store.one("SELECT 1 FROM observations WHERE id='new-obs'"));
    assert.equal(store.one("SELECT 1 FROM articles WHERE id='old-art'"), undefined);
    assert.ok(store.one("SELECT 1 FROM articles WHERE id='new-art'"));
    assert.equal(store.one("SELECT 1 FROM jobs WHERE key='old-job'"), undefined);
    assert.ok(store.one("SELECT 1 FROM jobs WHERE key='approved-job'"));
    assert.ok(store.one("SELECT 1 FROM jobs WHERE key='new-job'"));
    assert.equal(existsSync(oldAssessment), false);
    assert.ok(existsSync(newAssessment));
    assert.equal(existsSync(oldRaw), false);
    assert.ok(existsSync(newRaw));
    assert.ok(existsSync(protectedRaw));
  } finally { store.db.close(); rmSync(root, { recursive: true, force: true }); }
});

test('retention is due only in the 03:00 Shanghai maintenance slot', () => {
  assert.equal(retentionDue(new Date('2026-11-26T03:00:00+08:00')), true);
  assert.equal(retentionDue(new Date('2026-11-26T03:59:00+08:00')), true);
  assert.equal(retentionDue(new Date('2026-11-26T10:30:00+08:00')), false);
});
