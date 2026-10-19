import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, cpSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { clean, canonical, parseFeed, parseAtom, parseTesla, parseHnItem } from '../src/sources.ts';
import { topic, duplicate, sequenceRatio, select } from '../src/editor.ts';
import { cacheKey, validate, cost, gate } from '../src/model.ts';
import { policy, digest, pyjson, type Row } from '../src/core.ts';
import { Store, files, extractEvidence } from '../src/store.ts';
import { candidates } from '../src/pool.ts';
import { article, cutoff, synthetic } from './fixtures.ts';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const python = process.env.PYTHON ?? (existsSync(repo + '.venv/bin/python') ? repo + '.venv/bin/python' : 'python3');
const fetched = '2026-10-18T10:00:00+08:00';
export const body = '公司计划在中国测试这一人工智能模型，尚未独立验证。'.repeat(20);
export function rss(host = 'www.ithome.com', content = body) {
  return `<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>AI模型测试版本发布</title><link>https://${host}/news/test/?utm_source=abc&amp;b=2&amp;a=1</link><pubDate>Sun, 18 Oct 2026 04:00:00 +0800</pubDate><description><![CDATA[<p>${content}</p><p class="ad">广告</p>]]></description><content:encoded><![CDATA[<p>${content}</p>]]></content:encoded></item></channel></rss>`;
}
function oracle(cases: Row[]): any[] {
  const result = spawnSync(python, [fileURLToPath(new URL('../tools/full_reference.py', import.meta.url))], { input: JSON.stringify(cases), encoding: 'utf8', maxBuffer: 80 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
}
function actual(c: Row): any {
  switch (c.op) {
    case 'clean': return clean(c.text);
    case 'canonical': return canonical(c.url);
    case 'feed': return parseFeed(c.raw, c.source, c.fetched);
    case 'atom': return parseAtom(c.raw, c.fetched);
    case 'tesla': return parseTesla(c.raw, c.fetched);
    case 'hn': return parseHnItem(c.item, c.fetched, c.rank);
    case 'topic': return topic(c.article);
    case 'duplicate': return duplicate(c.a, c.b);
    case 'ratio': return sequenceRatio(c.a, c.b);
    case 'select': { const [selected, rejected] = select(c.articles, c.cutoff, c.sample, c.target); return { selected, rejected }; }
    case 'cache': return cacheKey(c.article, c.policy);
    case 'validate': try { return { ok: true, result: validate(c.result, c.article) }; } catch (e) { return { ok: false, error: (e as Error).message }; }
    case 'cost': return cost(c.usage, c.policy, c.multiplier);
    case 'gate': return gate(c.policy, new Date(c.now), c.verified, c.permit);
  }
}
test('full source, editing, hash, model validation and price contracts match Python', () => {
  const a = { ...article(), url: 'https://example.org/model', content_fingerprint: digest(body), text: body, source_name: 'GitHub', fetched_at: fetched, output_schema: 'dual-1' };
  const p = { ...policy(), prompt_version: 'premium-pool-2' }; const valid = { title: '人工智能模型测试', summary: '公司计划在中国测试这一人工智能模型。', short_summary: '新模型正在测试，尚未独立验证。', why: '', points: ['一', '二', '三', '四'], uncertainties: [], claims: [{ claim: '模型测试', evidence: '公司计划在中国测试这一人工智能模型' }] };
  const cases: Row[] = [
    ...['<p>A <strong>B</strong> C<br>第二行</p>', '<script>bad</script><p>保留 &amp; 中文&nbsp; 内容</p><img src="x">', '<p>Read the full article</p><div>正常内容</div>', '<!--comment--><div>A<span>B</span>C</div>', '<p>京东商品链接</p><p class="advertisement">广告</p><footer>footer</footer>', 'A\u001cB\u0085C\ufeffD'].map(text => ({ op: 'clean', text })),
    ...['https://EXAMPLE.org/a///?z=2&z=1&utm_x=a&a=hello+world&x=~*#frag', 'https://example.org/中文?b=%E4%B8%AD&a=', 'https://example.org:443/a/../b?q=1'].map(url => ({ op: 'canonical', url })),
    ...['ithome', 'nvidia', 'github', 'cloudflare', 'microsoft_foundry', 'openai', 'google_ai', 'bloomberg', 'nasa', 'apple_developer', 'macrumors', 'nasa_blogs', 'ars_science'].map(source => ({ op: 'feed', raw: rss(({ ithome: 'www.ithome.com', nvidia: 'blogs.nvidia.com', github: 'github.blog', cloudflare: 'blog.cloudflare.com', microsoft_foundry: 'devblogs.microsoft.com', openai: 'openai.com', google_ai: 'blog.google', bloomberg: 'www.bloomberg.com', nasa: 'www.nasa.gov', apple_developer: 'developer.apple.com', macrumors: 'www.macrumors.com', nasa_blogs: 'science.nasa.gov', ars_science: 'arstechnica.com' } as Row)[source]), source, fetched })),
    { op: 'feed', raw: rss().replaceAll('content:', 'full:').replace('xmlns:content', 'xmlns:full'), source: 'ithome', fetched },
    { op: 'feed', raw: rss().replace(/<pubDate>.*?<\/pubDate>/, '<pubDate>Sun, 18 Oct 2026 04:00:00</pubDate>'), source: 'ithome', fetched },
    { op: 'atom', raw: `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Apple update</title><link href="https://www.apple.com/newsroom/test/"/><updated>2026-10-18T04:00:00Z</updated><summary>Short summary</summary></entry></feed>`, fetched },
    { op: 'tesla', raw: '<a href="/press-release/test">Tesla update</a><a href="/press-release/test">duplicate</a>', fetched },
    { op: 'hn', item: { id: 123, time: 1792252800, type: 'story', title: 'AI database research', url: 'https://example.org/test', score: 10 }, fetched, rank: 1 },
    { op: 'hn', item: { id: 1, time: 1, type: 'job', title: 'AI engineer' }, fetched, rank: 2 },
    ...['AI模型发布', '中文LLM中文', '安全漏洞', 'ſoftware', 'Tesla价格变化', '中文 AI 中文', 'aı模型'].map(title => ({ op: 'topic', article: { ...a, title } })),
    ...['', 'abc', 'a'.repeat(210), '中文'.repeat(150), '0123456789'.repeat(30)].flatMap(left => ['abc', left + 'XYZ', left.slice(1)].map(right => ({ op: 'ratio', a: left, b: right }))),
    ...['AI 新模型测试', 'Tesla robotaxi release', 'Tesla robotaxi price', 'GPT-5 发布', 'GPT-5 测试', '中文 SpaceX Starship launch', '星舰发布'].map((title, i) => ({ op: 'duplicate', a: { ...a, title }, b: { ...a, id: 'b', url: 'https://other.org/' + i, content_fingerprint: digest(String(i)), title: i % 2 ? 'Tesla robotaxi launch' : 'AI模型测试版本发布' } })),
    { op: 'select', articles: synthetic(120).map((a, i) => ({ ...a, url: 'https://example.org/' + i, content_fingerprint: digest(String(i)), fetched_at: fetched })), cutoff, target: 32 },
    { op: 'cache', article: a, policy: p }, { op: 'cache', article: { ...a, confirmed_update_facts: [{ fact: '测试', evidence: '公司计划在中国测试' }], prior_versions: [{ url: 'https://example.org/old', fingerprint: 'old' }] }, policy: p },
    { op: 'validate', article: a, result: valid }, { op: 'validate', article: a, result: { ...valid, short_summary: '中'.repeat(81) } },
    { op: 'validate', article: a, result: { ...valid, claims: [{ claim: '测试', evidence: '完全不存在的事实证据' }] } },
    { op: 'cost', policy: p, usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_cache_hit_tokens: 100 }, multiplier: 2 },
    ...['2026-10-18T04:59:59+08:00', '2026-10-18T05:00:00+08:00', '2026-10-18T06:11:59+08:00', '2026-10-18T06:12:00+08:00', '2026-10-26T00:00:00+08:00'].map(now => ({ op: 'gate', policy: p, now, verified: true })),
  ];
  const reference = oracle(cases);
  cases.forEach((c, i) => assert.deepEqual(JSON.parse(JSON.stringify(actual(structuredClone(c)))), reference[i], `case ${i} ${c.op}`));
});

test('read-only local archived real feeds match Python when available', { skip: !existsSync(repo + 'premium_data/pool/verification/fresh-archive/evidence.tar.gz') }, () => {
  const temp = mkdtempSync(tmpdir() + '/ts-feed-parity-');
  try {
    extractEvidence(temp, repo + 'premium_data/pool/verification/fresh-archive/evidence.tar.gz');
    const cases: Row[] = files(temp + '/transient').filter(p => /\/feeds\/[^/]+\/.*\.xml$/.test(p) && !p.includes('/apple/')).map(path => ({ op: 'feed', source: path.split('/').at(-2), raw: readFileSync(path, 'utf8'), fetched }));
    assert.ok(cases.length >= 6); const expected = oracle(cases);
    cases.forEach((c, i) => assert.ok(JSON.stringify(actual(c)) === JSON.stringify(expected[i]), `private feed mismatch: ${c.source}; content omitted`));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('legacy state snapshot round-trips with matching jobs, costs, keys and bodies', { skip: !existsSync(repo + 'premium_data/pool/durable/state.json') }, () => {
  const temp = mkdtempSync(tmpdir() + '/ts-state-parity-');
  try {
    cpSync(repo + 'premium_data/pool', temp, { recursive: true });
    const before = JSON.parse(readFileSync(temp + '/durable/state.json', 'utf8'));
    const store = new Store(temp); const count = store.one('SELECT COUNT(*) n FROM calls')!.n;
    let checked = 0;
    for (const job of store.all('SELECT * FROM jobs')) {
      const a = JSON.parse(job.article); const key = cacheKey(a, a.generation_policy ?? policy());
      if (a.output_schema === 'dual-1') { assert.equal(key, job.key); checked++; }
    }
    assert.ok(checked > 0);
    store.checkpoint(); store.db.close();
    const after = JSON.parse(readFileSync(temp + '/durable/state.json', 'utf8'));
    assert.deepEqual(after.tables.calls, before.tables.calls); assert.equal(count, before.tables.calls.length);
    assert.deepEqual(after.tables.jobs.map((r: Row) => [r.key, r.status, r.attempts]), before.tables.jobs.map((r: Row) => [r.key, r.status === 'pending_human_review' ? (r.result ? 'pending_ai_review' : 'queued') : r.status, r.attempts]));
    const code = `import sys,json;sys.path.insert(0,${JSON.stringify(repo + 'experiments/premium')});from durable import Store;s=Store(sys.argv[1]);print(json.dumps(dict(calls=s.db.execute('SELECT COUNT(*) FROM calls').fetchone()[0],jobs=s.db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0])));s.db.close()`;
    const result = spawnSync(python, ['-c', code, temp], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).calls, count);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
