import { load } from 'cheerio/slim';
import { PROMPT, POOL_PROMPT } from './constants.ts';
import { digest, pyjson, stamp, day, localParts, at, EXPIRY, type Row } from './core.ts';
import { complete, whitespace } from './sources.ts';
import { Store } from './store.ts';
export const codepoints = (s: string) => Array.from(s).length;
function tariff(clock: Date) {
  const { hour } = localParts(clock); const weekday = new Date(clock.getTime() + 8 * 3600000).getUTCDay();
  return weekday >= 1 && weekday <= 5 && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)) ? 2 : 1;
}
export function cacheKey(a: Row, p: Row): string {
  const prompt = a.output_schema === 'dual-1' ? POOL_PROMPT : PROMPT;
  const parts = [a.url, a.title, a.published_at, a.content_fingerprint, p.model, p.model_version, p.prompt_version, digest(prompt)];
  if (a.output_schema) parts.push(a.output_schema);
  if (a.confirmed_update_facts?.length) parts.push(digest(pyjson(a.confirmed_update_facts, true)));
  if (a.prior_versions?.length) parts.push(digest(pyjson(a.prior_versions, true)));
  return digest(pyjson(parts));
}
export function validate(result: any, a: Row): Row {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('not object');
  for (const k of ['title', 'summary', 'why']) if (typeof result[k] !== 'string') throw new Error('text field');
  if (/[A-Za-z]/.test(a.title) && !/[\u4e00-\u9fff]/.test(result.title)) throw new Error('non_chinese_title');
  if (!result.title || !result.summary || codepoints(result.summary) > 220) throw new Error('empty or excessive summary');
  if (a.output_schema === 'dual-1') {
    if (codepoints(result.summary) > 150) throw new Error('lead_summary_over_150');
    if (typeof result.short_summary !== 'string' || !result.short_summary || codepoints(result.short_summary) > 80) throw new Error('short_summary_missing_or_over_80');
  }
  for (const key of ['points', 'uncertainties']) if (!Array.isArray(result[key]) || !result[key].every((s: any) => typeof s === 'string')) throw new Error(key);
  if (result.points.length > 3) {
    result.program_edits ??= []; result.program_edits.push({ action: 'limit_points', original_count: result.points.length, kept_count: 3, note: '仅删除多余要点，未改写事实；完整模型输出在原始响应中保留' }); result.points = result.points.slice(0, 3);
  }
  if (!Array.isArray(result.claims) || !result.claims.length) throw new Error('missing evidence');
  for (const claim of result.claims) if (!claim || typeof claim.claim !== 'string' || !claim.claim || typeof claim.evidence !== 'string'
    || codepoints(claim.evidence) < 8 || !whitespace(a.text).includes(whitespace(claim.evidence))) throw new Error('unsupported evidence');
  return result;
}
export function cost(usage: Row, p: Row, multiplier = 1) {
  const input = usage.prompt_tokens; const output = usage.completion_tokens; const hit = usage.prompt_cache_hit_tokens ?? 0;
  if (![input, output, hit].every(x => Number.isInteger(x) && x >= 0) || hit > input) throw new Error('bad usage');
  return multiplier * ((input - hit) * p.input_miss_per_million + hit * p.input_hit_per_million + output * p.output_per_million) / 1e6;
}
export function gate(p: Row, now: Date, verified: boolean, permit?: Row): string | null {
  if (!verified) return 'official_rules_unconfirmed';
  if (day(now) < p.verified_on || now.getTime() >= Date.parse(p.valid_until)) return 'rules_expired_or_future';
  if (now.getTime() >= Date.parse(EXPIRY)) return 'trial_expired';
  if (p.timezone !== 'Asia/Shanghai' || p.window_start !== '05:00' || p.window_end !== '06:15') return 'window_conflict';
  if (p.stop_new_before_seconds < p.request_deadline_seconds + 60 || p.request_deadline_seconds > 90) return 'unsafe_margin';
  if (permit) {
    if (permit.mode !== 'internal_test_anytime' || !/^(sample-|test-)/.test(permit.issue_id ?? '') || !Number.isFinite(Date.parse(permit.expires_at))) return 'invalid_test_permit';
    if (now.getTime() >= Math.min(Date.parse(permit.expires_at), Date.parse(EXPIRY)) - p.stop_new_before_seconds * 1000) return 'test_permit_expired';
    return null;
  }
  if (now < at(day(now), '05:00:00') || now.getTime() >= at(day(now), '06:15:00').getTime() - p.stop_new_before_seconds * 1000) return 'outside_window_or_margin';
  return null;
}
export async function verifyRules(p: Row, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (p.source !== 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/') return false;
  try {
    const response = await fetcher(p.source, { signal: AbortSignal.timeout(30000) }); if (!response.ok) return false;
    const $ = load(await response.text()); const table = $('table').first();
    const cellText = (node: any): string => {
      const tokens: string[] = [];
      const visit = (n: any) => { if (n.type === 'text' && n.data.trim()) tokens.push(n.data.trim()); else for (const child of n.children ?? []) visit(child); };
      visit(node); return whitespace(tokens.join(' '));
    };
    const rows = table.find('tr').toArray().map(tr => $(tr).children('th,td').toArray().map(cellText));
    const index = rows[0].map(s => s.split(' ')[0]).indexOf(p.model);
    if (![1, 2].includes(index) || rows[3]?.[index] !== p.model_version) return false;
    const prices = rows.filter(row => row.includes('空闲时段')).map(row => Number(row.at(-(3 - index))!.replace(/元$/, '')));
    const expected = [p.input_hit_per_million, p.input_miss_per_million, p.output_per_million];
    const rule = $.root().text().match(/北京时间[\s\S]*?均为空闲时段。/);
    const understood = '北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。';
    return JSON.stringify(prices) === JSON.stringify(expected) && !!rule && whitespace(rule[0]).replaceAll(' ', '') === whitespace(understood).replaceAll(' ', '');
  } catch { return false; }
}

export interface PaidDependencies {
  now?: () => Date; fetcher?: typeof fetch; verify?: (p: Row) => Promise<boolean>; token?: string;
}
/** The only model POST. CLI never exposes dependencies, clocks or token arguments. */
export async function paidRequest(store: Store, key: string, a: Row, p: Row, permit?: Row, deps: PaidDependencies = {}): Promise<string | null> {
  if (!store.syncGit && !deps.fetcher) throw new Error('paid_transport_requires_authoritative_checkpoint');
  const now = deps.now ?? (() => new Date()); const fetcher = deps.fetcher ?? fetch;
  const job = store.one('SELECT * FROM jobs WHERE key=?', key); if (!job) return 'unknown_job';
  if (job.result) return 'cached';
  if (['inflight', 'uncertain_requires_review', 'failed_validation_review'].includes(job.status)) return 'held_for_review';
  // Unknown-cost failures are held even when a legacy job carries retry_after.
  if (store.one('SELECT id FROM calls WHERE job=? AND cost IS NULL', key)) return 'held_unknown_cost';
  if (job.attempts >= p.max_attempts) return 'attempt_limit';
  if (job.status.startsWith('retry_after:') && now().getTime() < Date.parse(job.status.slice(12))) return 'backoff_pending';
  if (a.content_status !== 'usable_excerpt' || a.evidence_expired_or_missing || complete(a.text ?? '') !== 'usable_excerpt') return 'insufficient_content';
  if (cacheKey(a, p) !== key) return 'model_or_prompt_changed_create_new_issue';
  let blocked = gate(p, now(), true, permit); if (blocked) return blocked;
  const verified = await (deps.verify ?? verifyRules)(p);
  store.run('INSERT OR REPLACE INTO meta VALUES (?,?)', 'last_rule_check', pyjson({ at: stamp(now()), verified, source: p.source, policy_sha256: digest(pyjson(p, true)) }));
  blocked = gate(p, now(), verified, permit); if (blocked) return blocked;
  const token = deps.token ?? process.env.DEEPSEEK_API_KEY?.trim(); if (!token) return 'missing_api_key';
  const evidence: Row = Object.fromEntries(['title', 'url', 'source_name', 'published_at', 'text'].map(k => [k, a[k]]));
  if (job.attempts > 0) evidence.revision_instruction = '这是已知费用的内部校验修复，不是新文章。summary严格限制80–130个中文字符、绝不超过150字符；次要数字留在points，不必把所有事实塞入概括。英文标题译成自然中文。claims每段evidence逐字复制原文一段连续文字，保留换行，不允许拼接表格的不连续单元格。优先保住主体、核心变化、范围和计划/测试等限定。';
  if (a.prior_versions?.length) {
    evidence.prior_versions_untrusted = a.prior_versions; evidence.editorial_task = '更新报道：只选当前正文比旧版本新增且有证据的事实，不能确认增量则报告不足；旧发布时间不代表新事件时间。';
    if (a.confirmed_update_facts?.length) { evidence.human_reviewed_new_facts = a.confirmed_update_facts; evidence.editorial_task += '只对human_reviewed_new_facts中经人工确认的增量写作，仍须逐字证据；这不是事实正确保证。'; }
  }
  const prompt = a.output_schema === 'dual-1' ? POOL_PROMPT : PROMPT;
  const body = { model: p.model, thinking: { type: 'disabled' }, max_tokens: 1800, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: prompt }, { role: 'user', content: pyjson(evidence) }] };
  const clock = now(); const multiplier = tariff(clock);
  const reserve = ((Buffer.byteLength(pyjson(body)) + 512) * p.input_miss_per_million + 1800 * p.output_per_million) / 1e6 * (permit ? Math.max(multiplier, 2) : multiplier);
  const spent = store.one('SELECT COALESCE(SUM(COALESCE(cost,reserved)),0) total FROM calls WHERE day=?', day(clock))!.total;
  if (spent + reserve > Math.min(p.daily_budget_cny, 2)) return 'budget_exhausted';
  let callId: number = 0;
  store.tx(() => {
    callId = Number(store.run('INSERT INTO calls(day,job,reserved,status,tariff_multiplier,execution_mode) VALUES (?,?,?,?,?,?)', day(clock), key, reserve, 'reserved', multiplier, permit ? 'internal_test_anytime' : 'scheduled_window').lastInsertRowid);
    store.run("UPDATE jobs SET attempts=attempts+1,status='inflight' WHERE key=?", key);
  });
  store.checkpoint(); // Fail before any POST if reservation push failed.
  blocked = gate(p, now(), verified, permit);
  if (!blocked && (day(now()) !== day(clock) || tariff(now()) !== multiplier)) blocked = 'billing_period_changed';
  if (blocked) {
    store.run("UPDATE calls SET cost=0,status='not_sent' WHERE id=?", callId); store.run("UPDATE jobs SET status='queued' WHERE key=?", key); store.checkpoint(); return blocked;
  }
  const start = performance.now(); let received = false;
  try {
    const response = await fetcher('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      redirect: 'manual', signal: AbortSignal.timeout(Math.min(90, p.request_deadline_seconds) * 1000) });
    store.run('UPDATE calls SET http_status=? WHERE id=?', response.status, callId);
    if (!response.ok) {
      store.run("UPDATE calls SET status='http_error_usage_unknown' WHERE id=?", callId);
      store.run("UPDATE jobs SET status='uncertain_requires_review' WHERE key=?", key);
    } else {
      const raw = await response.json() as Row; received = true;
      store.run('INSERT OR REPLACE INTO responses VALUES (?,?,NULL)', callId, pyjson(raw));
      const estimated = cost(raw.usage, p, multiplier);
      store.run("UPDATE calls SET cost=?,usage=?,status='response_received' WHERE id=?", estimated, pyjson(raw.usage), callId);
      if (raw.choices?.[0]?.finish_reason !== 'stop') throw new Error('incomplete response');
      const result = validate(JSON.parse(raw.choices[0].message.content), a);
      result.generated_at = stamp(now()); result.generation_metadata = { model: p.model, model_version: p.model_version, prompt_version: p.prompt_version, prompt_sha256: digest(prompt), output_schema: a.output_schema ?? 'legacy-1' };
      result.request_strategy = job.attempts === 0 ? 'base' : 'length-and-evidence-repair-1';
      store.run("UPDATE jobs SET result=?,status='pending_human_review' WHERE key=?", pyjson(result), key);
    }
  } catch {
    if (received) {
      store.run("UPDATE responses SET validation_error='response_validation_failed' WHERE call_id=?", callId);
      store.run("UPDATE calls SET status='invalid_response' WHERE id=?", callId); store.run("UPDATE jobs SET status='failed_validation_review' WHERE key=?", key);
    } else {
      store.run("UPDATE calls SET status='transport_usage_unknown' WHERE id=?", callId); store.run("UPDATE jobs SET status='uncertain_requires_review' WHERE key=?", key);
    }
  } finally {
    store.run('UPDATE calls SET seconds=? WHERE id=?', (performance.now() - start) / 1000, callId); store.checkpoint();
  }
  return null;
}
