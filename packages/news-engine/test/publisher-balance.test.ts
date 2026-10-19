import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitDomains, publisherKey, publisherCapacityReached } from '../src/editorial-policy.ts';
import { parseFeed, fetchSource } from '../src/sources.ts';
import { ACTIVE_SOURCES } from '../src/constants.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.ts';
import { candidates } from '../src/pool.ts';

test('publisher quotas cover cached items, HN referrals and publisher subdomains', () => {
  const domains = ['AI模型发布', '开源编译器更新', 'GPU芯片进展', '火箭测试', '机器人升级', '安全漏洞修复', '手机更新', '公司研究'];
  const hosts = ['www.ithome.com', 'github.blog', 'blogs.nvidia.com', 'blog.cloudflare.com', 'developer.apple.com', 'science.nasa.gov', 'arstechnica.com'];
  const input = hosts.flatMap((host, h) => Array.from({ length: 10 }, (_, i) => ({ article: {
    id: `${h}-${i}`, title: domains[i % domains.length], source: h === 0 ? 'ithome' : 'hackernews', url: `https://${host}/news/${i}` },
    result: { title: domains[i % domains.length] } })));
  const rejected: any[] = []; const chosen = limitDomains(input, rejected);
  assert.equal(chosen.length, 20);
  const counts = new Map<string, number>();
  for (const row of chosen) { const key = publisherKey(row.article)!; counts.set(key, (counts.get(key) ?? 0) + 1); }
  assert.equal(counts.get('ithome.com'), 3);
  assert.ok([...counts.values()].every(n => n <= 4));
  assert.equal(new Set(chosen.slice(0, 5).map(r => publisherKey(r.article))).size, 5);
  assert.ok(rejected.some(r => r.reason === 'publisher_capacity'));
  assert.equal(publisherKey({ url: 'https://developer.apple.com/news/one' }), publisherKey({ url: 'https://www.apple.com/newsroom/two' }));
  assert.equal(publisherCapacityReached({ url: 'https://www.ithome.com/hn-link', source: 'hackernews' }, chosen), true);
  assert.equal(limitDomains(input.slice(0, 10)).length, 1); // No publisher padding when five diverse leads are unavailable.
});

test('Tesla replacement is publisher-labelled RSS evidence, filtered to Tesla topics with real publication times', () => {
  assert.ok(!ACTIVE_SOURCES.includes('tesla')); assert.ok(ACTIVE_SOURCES.includes('electrek_tesla'));
  const text = 'The company describes a limited vehicle test and its geographical restrictions. '.repeat(5);
  const item = (title: string, date: string) => `<item><title>${title}</title><link>https://electrek.co/2026/test/${encodeURIComponent(title)}</link><pubDate>${date}</pubDate><description><![CDATA[<p>${text}</p>]]></description></item>`;
  const raw = `<rss><channel>${item('Tesla FSD limited test', 'Mon, 19 Oct 2026 01:00:00 +0000')}${item('Other brand vehicle launch', 'Mon, 19 Oct 2026 01:00:00 +0000')}${item('Tesla undated rumor', '')}</channel></rss>`;
  const rows = parseFeed(raw, 'electrek_tesla', '2026-10-19T12:00:00+08:00');
  assert.equal(rows.length, 1); assert.match(rows[0].source_name, /Electrek/); assert.ok(!rows[0].source_name.includes('官方'));
  assert.equal(rows[0].content_status, 'discovery_only'); assert.equal(rows[0].published_at, '2026-10-19T09:00:00+08:00');
});

test('Tesla RSS teasers require a public dated article body; redirects, paywalls and old entries are not expanded', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-19T12:00:00Z') });
  const root = mkdtempSync(tmpdir() + '/tesla-media-'); const visited: string[] = [];
  const item = (name: string, date = 'Mon, 19 Oct 2026 01:00:00 +0000') => `<item><title>Tesla ${name}</title><link>https://electrek.co/2026/10/19/${name}/</link><pubDate>${date}</pubDate><description>Vehicle test teaser…</description></item>`;
  try {
    const fetcher = (async (input: any, options: any) => {
      const url = String(input); visited.push(url);
      if (url.endsWith('/feed/')) return new Response(`<rss><channel>${item('good')}${item('restricted')}${item('redirect')}${item('old', 'Fri, 16 Oct 2026 01:00:00 +0000')}</channel></rss>`);
      assert.equal(options.redirect, 'manual');
      assert.ok(url.endsWith('/'));
      if (url.endsWith('/redirect/')) return new Response('', { status: 302, headers: { Location: 'https://other.example/' } });
      return new Response(`<html><head><meta property="article:published_time" content="2026-10-19T01:00:00Z"><link rel="canonical" href="${url}"></head><body>${url.endsWith('/restricted/') ? '<div class="paywall">restricted</div>' : ''}<div class="post-content">${'The company describes a limited vehicle test. '.repeat(20)}</div></body></html>`);
    }) as typeof fetch;
    const { rows } = await fetchSource('electrek_tesla', root, fetcher);
    assert.equal(rows.find(a => a.url.endsWith('/good'))?.content_status, 'usable_excerpt');
    assert.equal(rows.find(a => a.url.endsWith('/restricted'))?.body_probe_status, 'restricted_content');
    assert.equal(rows.find(a => a.url.endsWith('/redirect'))?.body_http_status, 302);
    assert.ok(!visited.some(url => /\/old\/?$/.test(url) || url.includes('other.example')));
  } finally { rmSync(root, { recursive: true, force: true }); t.mock.timers.reset(); }
});

test('legacy cached Tesla media teasers are rejected before queueing', () => {
  const root = mkdtempSync(tmpdir() + '/tesla-teaser-cache-'); const store = new Store(root);
  try {
    store.run('INSERT INTO articles VALUES (?,?,?)', 'old-teaser', 'version', JSON.stringify({ id: 'old-teaser', source: 'teslanorth_tesla',
      title: 'Tesla FSD测试更新', url: 'https://teslanorth.com/2026/10/19/test', published_at: '2026-10-19T01:00:00Z',
      content_origin: 'rss_description', content_status: 'usable_excerpt', text: 'A seemingly long teaser. '.repeat(30) }));
    const [chosen, rejected] = candidates(store, '2026-10-19T12:00:00+08:00');
    assert.equal(chosen.length, 0); assert.ok(rejected.some(r => r.reason === 'media_article_body_unverified'));
  } finally { store.db.close(); rmSync(root, { recursive: true, force: true }); }
});
