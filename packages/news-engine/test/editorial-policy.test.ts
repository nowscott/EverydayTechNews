import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { titleExclusion, analyzeDomain, limitDomains } from '../src/editorial-policy.ts';
import { extractHnPublisher, hnPublisher } from '../src/hn-publishers.ts';
import { fetchSource } from '../src/sources.ts';
import { select } from '../src/editor.ts';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const python = process.env.PYTHON ?? (existsSync(repo + '.venv/bin/python') ? repo + '.venv/bin/python' : 'python3');
const rules = JSON.parse(readFileSync(repo + 'config/news-filter.json', 'utf8'));

test('ordinary and premium filters share every keyword and currency rule', () => {
  const titles = [...rules.keywords.flatMap((s: string) => [s + '发布新闻', s.toUpperCase() + '新品']),
    ...['3999 元', '3 万元', '9 千元', '12 亿美元', '30 日元', '€ 500', '$ 299', 'RM 99', '₽ 20', '2 万越南盾', '16GB 内存', '2000 亿元投资', '两家公司研发新芯片', 'Open source compiler release', 'WATCHGT update', 'aſcend update'].map(s => '新进展 ' + s)];
  const reference = spawnSync(python, ['-c', 'import sys,json;sys.path.insert(0,sys.argv[1]+"/src");from news_filter import should_filter_news;print(json.dumps([should_filter_news(s) for s in json.load(sys.stdin)]))', repo], { input: JSON.stringify(titles), encoding: 'utf8' });
  assert.equal(reference.status, 0, reference.stderr); assert.deepEqual(titles.map(s => !!titleExclusion(s)), JSON.parse(reference.stdout));
  assert.equal(titleExclusion('华为 nova 12 手机推 HarmonyOS 7 更新')?.reason, 'shared_filter_keyword');
});
test('one domain per article, bounded whole edition and top-five leads; cached translations are filtered too', () => {
  assert.equal(analyzeDomain({ title: '苹果发布 AI 模型' }).primary, '人工智能');
  assert.equal(analyzeDomain({ title: 'AI 芯片存在安全漏洞' }).primary, '安全与网络');
  const names = ['AI 模型发布', '开源编译器更新', 'GPU 芯片升级', '火箭测试', '机器人测试', '隐私漏洞修复'];
  const records = Array.from({ length: 60 }, (_, i) => ({ article: { id: String(i), title: names[Math.floor(i / 10)] }, result: { title: names[Math.floor(i / 10)] } }));
  records.unshift({ article: { id: 'blocked', title: '新软件功能' }, result: { title: '华为新软件功能' } });
  const rejected: any[] = []; const chosen = limitDomains(records, rejected);
  assert.equal(chosen.length, 20); assert.ok(!chosen.some(r => r.article.id === 'blocked'));
  for (const subset of [chosen, chosen.slice(0, 5)]) {
    const counts = new Map<string, number>(); for (const r of subset) counts.set(analyzeDomain(r.article).primary, (counts.get(analyzeDomain(r.article).primary) ?? 0) + 1);
    assert.ok([...counts.values()].every(n => n <= (subset.length === 5 ? 2 : 4)));
  }
  assert.ok(rejected.some(r => r.reason === 'shared_filter_keyword')); assert.ok(rejected.some(r => r.reason === 'domain_capacity'));
  assert.equal(limitDomains(records.slice(1, 11)).length, 2); // A single field cannot supply five diverse leads.
});
const prose = '<p>Researchers describe the new compiler and its limitations. '.repeat(20) + '</p>';
const page = (date?: string) => `<html><head>${date ? `<meta property="article:published_time" content="${date}">` : ''}</head><body><article><h1>Parser Combinators</h1>${prose}</article></body></html>`;
test('HN publisher extraction requires allowlist, canonical identity and original dated evidence', () => {
  const a = { url: 'https://www.anthropic.com/research/parser' };
  assert.equal(extractHnPublisher(page('2026-10-18T01:00:00Z'), a).body_probe_status, 'parsed');
  assert.equal(extractHnPublisher(page(), a).body_probe_status, 'publication_timestamp_unconfirmed');
  assert.equal(extractHnPublisher(page('2026-10-18'), a).body_probe_status, 'publication_timestamp_unconfirmed');
  assert.equal(extractHnPublisher(page().replace('<head>', '<head><link rel="canonical" href="/research/other">'), a).body_probe_status, 'canonical_mismatch');
  assert.equal(extractHnPublisher(page().replace('<article>', '<article class="paywall">'), a).body_probe_status, 'restricted_content');
  for (const url of ['http://www.anthropic.com/research/x', 'https://127.0.0.1/x', 'https://www.anthropic.com.evil.org/research/x', 'https://user@www.anthropic.com/research/x', 'https://www.anthropic.com:444/research/x']) assert.equal(hnPublisher(url), null);
});
test('HN scans top and new once, never fetches comments or arbitrary hosts, and distinguishes original publication', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-18T10:00:00+08:00') });
  const root = mkdtempSync(tmpdir() + '/hn-publisher-test-'); const visited: string[] = []; let active = 0; let peak = 0;
  try {
    const fetcher = (async (url: any, options: any) => {
      visited.push(String(url)); assert.notEqual(options?.method, 'POST');
      if (String(url).endsWith('/topstories.json')) return Response.json([1, 2, 3]);
      if (String(url).endsWith('/newstories.json')) return Response.json([3, 4, 5]);
      const id = /\/item\/(\d+)\.json$/.exec(String(url));
      if (id) return Response.json({ id: Number(id[1]), type: 'story', time: Date.parse('2026-10-18T01:00:00Z') / 1000, title: Number(id[1]) === 5 ? 'Show HN: A new compiler' : Number(id[1]) === 1 ? 'Parser Combinators' : 'Software release ' + id[1], text: Number(id[1]) === 5 ? prose : '', url: Number(id[1]) >= 3 && Number(id[1]) !== 4 ? 'https://127.0.0.1/private' : 'https://www.anthropic.com/research/' + id[1], kids: [999] });
      assert.equal(options.redirect, 'manual'); active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 5)); active--;
      return new Response(page(String(url).endsWith('/2') ? '2026-10-16T00:00:00Z' : String(url).endsWith('/4') ? undefined : '2026-10-18T00:30:00Z'), { headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
    const { rows, health } = await fetchSource('hackernews', root, fetcher);
    assert.equal(health.ok, true); assert.equal(health.scanned, 5); assert.equal(health.api_access_ok, true); assert.ok(peak <= 2);
    assert.equal(rows.find(a => a.title.startsWith('Show HN:'))?.content_origin, 'hn_show_original_post');
    assert.equal(rows.find(a => a.title.startsWith('Show HN:'))?.url, 'https://news.ycombinator.com/item?id=5');
    assert.equal(rows.find(a => a.title === 'Parser Combinators')?.content_status, 'usable_excerpt');
    assert.equal(rows.find(a => a.url.endsWith('/2'))?.published_at, '2026-10-16T08:00:00+08:00');
    assert.equal(rows.find(a => a.url.endsWith('/4'))?.content_status, 'discovery_only');
    assert.ok(!visited.some(url => url.includes('127.0.0.1') || url.includes('/999.json')));
    const [, rejected] = select(rows, '2026-10-18T10:00:00+08:00'); assert.ok(rejected.some(a => a.reason === 'old_news'));
  } finally { rmSync(root, { recursive: true, force: true }); t.mock.timers.reset(); }
});
