import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.ts';
import { atomic, policy, digest, pyjson, RECIPIENT, EXPIRY, type Row } from '../src/core.ts';
import { displayFields, validateReview, reviewKey, isApproved } from '../src/quality.ts';
import { reviewDraft, prepareRevision } from '../src/review.ts';
import { cacheKey, paidRequest } from '../src/model.ts';
import { morningTick, morningTime } from '../src/morning.ts';
import { due, refreshDeliveryIssue, reportTrial } from '../src/pool.ts';
import { freezeIssue, sendOnce } from '../src/mail.ts';
import { premiumSubscribers, authorizedTestRecipient } from '../src/subscribers.ts';

const text = '公司表示新模型计划在中国测试，预计速度提升20%，尚未独立验证。'.repeat(10);
const a: Row = { id: 'quality', title: '模型计划测试', text, url: 'https://example.org/model', source: 'github', source_name: 'GitHub',
  content_fingerprint: digest(text), content_status: 'usable_excerpt', published_at: '2026-10-19T05:00:00+08:00', fetched_at: '2026-10-19T05:01:00+08:00', output_schema: 'dual-1' };
const draft: Row = { title: '公司计划测试新模型', summary: '公司称新模型将在中国测试，预计速度提升20%，效果尚未独立验证。', short_summary: '公司计划测试新模型，效果未获独立验证。', points: [], why: '', uncertainties: [], claims: [{ claim: '计划测试', evidence: '公司表示新模型计划在中国测试' }], generated_at: '2026-10-19T05:30:00+08:00' };
const good = (d = draft) => ({ verdict: 'pass', update_has_new_facts: false, checks: Object.entries(displayFields(d)).map(([field, value]) => ({ field, pass: true, reason: '保留原文限定', evidence: value ? '公司表示新模型计划在中国测试' : '' })) });
function setup() {
  const root = mkdtempSync(tmpdir() + '/premium-quality-'); const store = new Store(root); const p = policy(); const key = cacheKey(a, p);
  atomic(root + '/trial.json', { schema_version: 1, mode: 'internal_test', enabled: true, model_enabled: true, delivery_enabled: true, production_enabled: false, allowed_recipient: RECIPIENT, start: '2026-10-19', days: 7, expires_at: EXPIRY, daily_budget_cny: 2 });
  atomic(root + '/test-delivery-config.json', { allowed_recipient: RECIPIENT });
  store.run('INSERT INTO jobs(key,article,status,result,attempts) VALUES (?,?,?,?,?)', key, pyjson(a), 'pending_ai_review', pyjson(draft), 1);
  return { store, p, key, close: () => { store.db.close(); rmSync(root, { recursive: true, force: true }); } };
}
const response = (result: Row) => new Response(JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 100 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] }));
const now = () => new Date('2026-10-19T05:35:00+08:00');

test('review validates every visible field, evidence, verdict and update delta', () => {
  const input = { ...a, review_draft: draft };
  assert.equal(validateReview(good(), input).verdict, 'pass');
  for (const edit of [
    (r: Row) => r.checks.pop(), (r: Row) => r.checks.push(r.checks[0]),
    (r: Row) => r.checks[0].evidence = '原文没有的证据不存在', (r: Row) => r.checks[0].pass = false,
    (r: Row) => r.checks[0].reason = '', (r: Row) => r.checks[0].evidence = '',
  ]) { const r = good(); edit(r); assert.throws(() => validateReview(r, input)); }
  assert.throws(() => validateReview(good(), { ...input, update_review_required: true }));
  const r = good(); r.update_has_new_facts = true;
  assert.equal(validateReview(r, { ...input, update_review_required: true, prior_evidence: [{ text: '旧事实' }] }).verdict, 'pass');
});
test('independent review uses separate prompt and same pre-POST budget ledger; exact cache reused', async () => {
  const { store, p, key, close } = setup(); let requests = 0;
  try {
    const deps = { now, token: 'test', verify: async () => true, fetcher: (async (_: any, options: any) => {
      requests++; const body = JSON.parse(options.body); assert.ok(body.messages[0].content.includes('独立科技新闻审稿员'));
      const input = JSON.parse(body.messages[1].content); assert.deepEqual(input.fields, Object.keys(displayFields(draft)));
      assert.equal(input.draft.ai_review, undefined); assert.equal(input.draft.claims, undefined);
      assert.equal(store.all('SELECT * FROM calls').at(-1)?.status, 'reserved'); return response(good());
    }) as typeof fetch };
    const job = store.one('SELECT * FROM jobs WHERE key=?', key)!;
    assert.equal(await reviewDraft(store, job, a, p, undefined, deps), 'ai_approved');
    const updated = store.one('SELECT * FROM jobs WHERE key=?', key)!;
    assert.equal(await reviewDraft(store, updated, a, p, undefined, deps), 'ai_approved'); assert.equal(requests, 1);
    const result = JSON.parse(updated.result); assert.ok(isApproved(a, result, p));
    assert.ok(!isApproved(a, { ...result, title: 'changed' }, p));
    assert.ok(!isApproved(a, result, { ...p, model_version: 'changed' }));
    assert.ok(!isApproved(a, result, p, '2026-10-19T05:34:59+08:00'));
  } finally { close(); }
});
test('unknown review usage never retries and budget/time boundaries block review POST', async () => {
  for (const mode of ['unknown', 'budget', 'late']) {
    const { store, p, key, close } = setup(); let requests = 0;
    try {
      if (mode === 'budget') store.run('INSERT INTO calls(day,job,reserved,status) VALUES (?,?,?,?)', '2026-10-19', 'old', 2, 'reserved');
      const deps = { now: mode === 'late' ? () => new Date('2026-10-19T06:12:00+08:00') : now, token: 'test', verify: async () => true,
        fetcher: (async () => { requests++; return new Response(JSON.stringify({ usage: {}, choices: [] })); }) as typeof fetch };
      const job = store.one('SELECT * FROM jobs WHERE key=?', key)!;
      await reviewDraft(store, job, a, p, undefined, deps); await reviewDraft(store, job, a, p, undefined, deps);
      assert.equal(requests, mode === 'unknown' ? 1 : 0);
      assert.ok(!isApproved(a, JSON.parse(store.one('SELECT result FROM jobs WHERE key=?', key)!.result), p));
    } finally { close(); }
  }
});
test('AI rejection preserves rejected draft and limits known-cost revisions', async () => {
  const { store, p, key, close } = setup();
  try {
    const r = good(); r.verdict = 'reject'; r.checks[0].pass = false; r.checks[0].reason = '遗漏测试限定';
    await reviewDraft(store, store.one('SELECT * FROM jobs WHERE key=?', key)!, a, p, undefined, { now, verify: async () => true, token: 'test', fetcher: (async () => response(r)) as typeof fetch });
    assert.equal(store.one('SELECT status FROM jobs WHERE key=?', key)!.status, 'ai_rejected');
    assert.ok(prepareRevision(store, store.one('SELECT * FROM jobs WHERE key=?', key)!, p));
    assert.equal(store.one('SELECT result FROM jobs WHERE key=?', key)!.result, null);
    assert.ok(store.one('SELECT result FROM jobs WHERE key=?', reviewKey(a, draft, p))?.result);
    store.run("UPDATE jobs SET status='ai_rejected',attempts=3 WHERE key=?", key);
    assert.ok(!prepareRevision(store, store.one('SELECT * FROM jobs WHERE key=?', key)!, p));
  } finally { close(); }
});
test('morning lifecycle prepares early, sends at 0640/0830, and performs no work at 0900', async () => {
  const { store, close } = setup();
  try {
    for (const time of ['04:07', '05:07', '06:40', '08:30', '09:00']) {
      const calls: string[] = []; const clock = new Date('2026-10-19T' + time + ':00+08:00');
      const deps: any = { collect: async () => { calls.push('collect'); }, assess: () => {}, enrich: async () => { calls.push('enrich'); }, compose: () => { calls.push('compose'); return { id: 'today' }; }, deliver: async () => { calls.push('deliver'); return { status: 'smtp_accepted' }; } };
      await morningTick(store, clock, deps);
      assert.equal(calls.includes('enrich'), time === '05:07');
      assert.equal(calls.includes('deliver'), ['06:40', '08:30'].includes(time));
      if (time === '09:00') assert.deepEqual(calls, []);
      assert.equal(morningTime(clock), time !== '09:00');
    }
    assert.ok(!due(store, new Date('2026-10-19T09:00:00+08:00')).deliver);
  } finally { close(); }
});
test('late revision preserves parent and removes expired stories without a model call', () => {
  const { store, close } = setup();
  try {
    const old = { ...a, published_at: '2026-10-18T06:20:00+08:00', job_key: cacheKey(a, policy()) };
    atomic(store.root + '/issues/test-2026-10-19/edition.json', { id: 'test-2026-10-19', kind: 'newsletter', articles: [old], rejected: [], collection_cutoff: '2026-10-19T06:15:00+08:00', generation_cutoff: '2026-10-19T06:15:00+08:00' });
    const id = refreshDeliveryIssue(store, 'test-2026-10-19', new Date('2026-10-19T08:30:00+08:00'));
    const revision = JSON.parse(readFileSync(store.root + '/issues/' + id + '/edition.json', 'utf8'));
    assert.equal(revision.parent_issue, 'test-2026-10-19'); assert.equal(revision.kind, 'diagnostic');
    assert.equal(revision.articles.length, 0); assert.equal(store.all('SELECT * FROM calls').length, 0);
    assert.equal(JSON.parse(readFileSync(store.root + '/issues/test-2026-10-19/edition.json', 'utf8')).articles.length, 1);
  } finally { close(); }
});
const env = { NOTION_API_KEY: 'test', NOTION_DATA_SOURCE_ID: 'synthetic' };
function subscriber(email: string, status = '正常', premium = true): Row { return { properties: { Email: { email }, 状态: { select: { name: status } }, 高级订阅: { checkbox: premium } } }; }
test('Notion pagination, status, checkbox, validity and dedupe; test allowlist remains enforced', async () => {
  const fetcher = (async (_: any, options: any) => {
    if (!options.method) return Response.json({ properties: { 高级订阅: { type: 'checkbox' } } });
    const payload = JSON.parse(options.body);
    return Response.json(payload.start_cursor ? { results: [subscriber(RECIPIENT), subscriber('b@example.org', '已退订'), subscriber('c@example.org', '正常', false)], has_more: false }
      : { results: [subscriber(' '+RECIPIENT.toUpperCase()+' '), subscriber('other@example.org'), subscriber('invalid'), subscriber('d@example.org', '待确认')], has_more: true, next_cursor: 'next' });
  }) as typeof fetch;
  assert.deepEqual(await premiumSubscribers(env, fetcher), [RECIPIENT, 'other@example.org']);
  assert.equal(await authorizedTestRecipient(env, fetcher), true);
});
test('Notion failure and looping pagination fail closed', async () => {
  await assert.rejects(() => premiumSubscribers(env, (async () => new Response('', { status: 503 })) as typeof fetch));
  await assert.rejects(() => premiumSubscribers(env, (async (_: any, options: any) => Response.json(options.method ? { results: [], has_more: true, next_cursor: 'same' } : { properties: { 高级订阅: { type: 'checkbox' } } })) as typeof fetch), /pagination/);
});

test('SMTP only retries explicit pre-send failures, caps attempts and blocks Notion failure before claim', async () => {
  const { store, close } = setup(); const saved = { ...process.env }; let sends = 0; let time = new Date('2026-10-19T06:40:00+08:00');
  try {
    process.env.SENDING_ACCOUNT = 'sender@example.org'; process.env.SENDING_PASSWORD = 'test'; process.env.SERVER = 'smtp.example.org';
    freezeIssue(store, { id: 'test-2026-10-19', kind: 'diagnostic', quality_policy: 'fidelity-1', articles: [], rejected: [], collection_cutoff: time.toISOString(), generation_cutoff: '2026-10-19T06:15:00+08:00' }, []);
    const transport = { sendMail: async () => { sends++; throw Object.assign(new Error('connection failed'), { command: 'CONN' }); }, close: () => {} };
    await assert.rejects(() => sendOnce(store, 'test-2026-10-19', { transport, now: () => time, authorize: async () => { throw new Error('notion_http_503'); } }));
    assert.equal(sends, 0);
    for (let i = 0; i < 3; i++) {
      assert.equal((await sendOnce(store, 'test-2026-10-19', { transport, now: () => time, authorize: async () => true })).status, 'failed_before_send');
      assert.equal((await sendOnce(store, 'test-2026-10-19', { transport, now: () => time, authorize: async () => true })).status, 'smtp_retry_pending_or_exhausted');
      time = new Date(time.getTime() + 4 * 60000);
    }
    assert.equal((await sendOnce(store, 'test-2026-10-19', { transport, now: () => time, authorize: async () => true })).status, 'smtp_retry_pending_or_exhausted');
    assert.equal(sends, 3);
  } finally { process.env = saved; close(); }
});
test('morning transient Notion failure stays resumable; private-state failure remains fatal', async () => {
  const { store, close } = setup();
  try {
    const deps: any = { collect: async () => {}, assess: () => {}, enrich: async () => {}, compose: () => ({ id: 'today' }), deliver: async () => { throw new Error('notion_http_503'); } };
    const clock = new Date('2026-10-19T08:30:00+08:00');
    assert.deepEqual(await morningTick(store, clock, deps), { status: 'notion_delivery_blocked', terminal: false });
    deps.deliver = async () => { throw new Error('push_failed'); };
    await assert.rejects(() => morningTick(store, clock, deps), /push_failed/);
  } finally { close(); }
});

test('daily report distinguishes on-time, delayed, insufficient and unknown outcomes', () => {
  const { store, close } = setup();
  try {
    const id = 'test-2026-10-19';
    atomic(store.root + '/issues/' + id + '/edition.json', { id, kind: 'newsletter', quality_policy: 'fidelity-1', articles: [] });
    for (const [time, expected] of [['06:30:10', 'on_time'], ['08:30:00', 'delayed']]) {
      atomic(store.root + '/deliveries/unit.json', { issue: id, status: 'smtp_accepted', accepted_at: '2026-10-19T' + time + '+08:00' });
      assert.equal(reportTrial(store, new Date('2026-10-19T09:00:00+08:00')).days[0].outcome, expected);
    }
    atomic(store.root + '/deliveries/unit.json', { issue: id, status: 'unknown_do_not_retry' });
    assert.equal(reportTrial(store, new Date('2026-10-19T09:00:00+08:00')).days[0].outcome, 'delivery_unknown');
    atomic(store.root + '/issues/' + id + '/edition.json', { id, kind: 'diagnostic', articles: [] });
    assert.equal(reportTrial(store, new Date('2026-10-19T09:00:00+08:00')).days[0].outcome, 'insufficient_content');
  } finally { close(); }
});

test('known-cost invalid review is repaired within the original job and unknown costs, limits, expiry and time stay blocked',async()=>{
 for(const mode of ['repair','unknown','limit','expired','late','budget']){
  const {store,p,key,close}=setup();let requests=0;
  try{
   const parent=store.one('SELECT * FROM jobs WHERE key=?',key)!;
   const deps={now,token:'test',verify:async()=>true,fetcher:(async(_u:any,options:any)=>{
    requests++;const input=JSON.parse(JSON.parse(options.body).messages[1].content);
    if(requests===2)assert.equal(input.output_constraints.previous_error,'review_verdict_conflict');
    const r=good();if(requests===1)r.verdict='reject';return response(r);
   }) as typeof fetch};
   await reviewDraft(store,parent,a,p,undefined,deps);
   const rk=reviewKey(a,draft,p);assert.equal(store.one('SELECT status FROM jobs WHERE key=?',rk)!.status,'failed_validation_review');
   if(mode==='unknown')store.run('UPDATE calls SET cost=NULL WHERE job=?',rk);
   if(mode==='limit')store.run('UPDATE jobs SET attempts=3 WHERE key=?',rk);
   if(mode==='budget')store.run('INSERT INTO calls(day,job,reserved,status) VALUES (?,?,?,?)','2026-10-19','budget',2,'reserved');
   const input=mode==='expired'?{...a,evidence_expired_or_missing:true}:a;
   const outcome=await reviewDraft(store,parent,input,p,undefined,{...deps,now:mode==='late'?()=>new Date('2026-10-19T06:14:00+08:00'):now});
   assert.equal(requests,mode==='repair'?2:1);
   if(mode==='repair'){assert.equal(outcome,'ai_approved');assert.equal(store.one('SELECT attempts FROM jobs WHERE key=?',rk)!.attempts,2);}
   const diagnostic=JSON.parse(store.one("SELECT data FROM meta WHERE key='call_diagnostic:1'")!.data);
   assert.equal(diagnostic.stage,'review');assert.equal(diagnostic.error_code,'review_verdict_conflict');assert.ok(diagnostic.started_at&&diagnostic.finished_at);
  }finally{close();}
 }
});
