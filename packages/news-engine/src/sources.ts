import { load } from 'cheerio/slim';
import { XMLValidator } from 'fast-xml-parser';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SOURCES, DISCOVERY_ONLY_SOURCES, ENCODED_REQUIRED_SOURCES } from './constants.ts';
import { digest, pyjson, stamp, type Row } from './core.ts';
import { compareText } from './compat.ts';
export { SOURCES } from './constants.ts';
export const whitespace = (s: string) => s.replace(/[\t-\r \u001c-\u001f\u0085\p{Zs}\u2028\u2029]+/gu, ' ').trim();
export function clean(s: string): string {
  const $ = load(s, { xml: { xmlMode: false, decodeEntities: true } }, false);
  $('script,style,iframe,form,img,video,footer,.ad,.advertisement').remove();
  const texts: string[] = [];
  function visit(nodes: any[]) { for (const node of nodes) { if (node.type === 'text') texts.push(node.data); else if (node.children) visit(node.children); } }
  visit($.root().contents().toArray());
  return texts.join('\n').split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/).map(whitespace)
    .filter(x => x && !/广告声明|京东.*链接|天猫.*链接|相关阅读|Read (?:the )?(?:full|more)/i.test(x)).join('\n');
}
export function complete(text: string): string {
  if (Array.from(text).length < 180) return 'insufficient';
  return /(?:…|\.\.\.|阅读原文|点击查看全文)\s*$/u.test(text) ? 'truncated' : 'usable_excerpt';
}
const form = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, x => '%' + x.charCodeAt(0).toString(16).toUpperCase()).replaceAll('%20', '+');
export function canonical(value: string): string {
  const url = new URL(value); const match = /^https:\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i.exec(value);
  if (!match || url.username || url.password) throw new Error('unsafe_url');
  const entries = [...new URLSearchParams(match[3] ?? '')].filter(([k]) => !k.toLowerCase().startsWith('utm_') && !['fbclid', 'gclid'].includes(k.toLowerCase()));
  entries.sort((a, b) => compareText(a[0], b[0]) || compareText(a[1], b[1]));
  const query = entries.map(([k, v]) => form(k) + '=' + form(v)).join('&');
  return 'https://' + match[1].toLowerCase() + match[2].replace(/\/+$/, '') + (query ? '?' + query : '');
}
const time = (s: string) => {
  if (!/(?:Z|[+-]\d\d:?\d\d|\b(?:GMT|UT|UTC|[ECMP][SD]T))\s*$/i.test(s)) throw new Error('publication_timezone_unconfirmed');
  const ms = Date.parse(s); if (!Number.isFinite(ms)) throw new Error('invalid_publication'); return stamp(new Date(ms));
};
function article(source: string, url: string, title: string, pub: string, fetched: string, text: string): Row {
  const published = time(pub);
  return { id: digest(url), url, source, source_name: (SOURCES as Row)[source][0], title, published_raw: pub,
    published_at: published, published_time_kind: 'rss_article_publication', original_article_published_at: published,
    fetched_at: fetched, event_time: null, text, content_status: complete(text), content_fingerprint: digest(text),
    content_origin: 'rss_description', language: source === 'ithome' ? 'zh-CN' : 'en', description_clean: text,
    rights_status: 'unconfirmed_model_and_distribution' };
}
export function parseFeed(raw: string, source: string, fetched: string): Row[] {
  if (XMLValidator.validate(raw) !== true) throw new Error('invalid_xml');
  const $ = load(raw, { xml: true }); const rows: Row[] = [];
  $('rss > channel > item').slice(0, 100).each((_, node) => {
    const item = $(node); const val = (name: string) => item.children(name).first().text();
    try {
      const url = canonical(val('link').trim()); const hosts = ['nasa', 'nasa_blogs'].includes(source)
        ? ['www.nasa.gov', 'nasa.gov', 'science.nasa.gov', 'blogs.nasa.gov'] : [(SOURCES as Row)[source][2]];
      if (!hosts.includes(new URL(url).hostname)) return;
      const description = clean(val('description'));
      // Resolve the namespace URI rather than assuming the publisher uses "content".
      const encodedNode = item.children().toArray().find((n: any) => {
        if (!n.name?.endsWith(':encoded')) return false;
        const prefix = n.name.split(':')[0]; let parent: any = n;
        while (parent) { if (parent.attribs?.[`xmlns:${prefix}`]) return parent.attribs[`xmlns:${prefix}`] === 'http://purl.org/rss/1.0/modules/content/'; parent = parent.parent; }
        return false;
      });
      const encoded = encodedNode ? $(encodedNode).text() : '';
      const text = encoded ? clean(encoded) : description;
      const a = article(source, url, val('title').trim(), val('pubDate').trim(), fetched, text);
      a.description_clean = description; a.content_origin = encoded ? 'rss_content_encoded' : 'rss_description';
      if ((DISCOVERY_ONLY_SOURCES as readonly string[]).includes(source) || ((ENCODED_REQUIRED_SOURCES as readonly string[]).includes(source) && !encoded)) a.content_status = 'discovery_only';
      rows.push(a);
    } catch { /* Invalid individual entries do not invalidate the remaining feed. */ }
  });
  return rows;
}
export function parseAtom(raw: string, fetched: string): Row[] {
  if (XMLValidator.validate(raw) !== true) throw new Error('invalid_atom');
  const $ = load(raw, { xml: true }); const rows: Row[] = [];
  $('feed > entry').slice(0, 100).each((_, node) => {
    const item = $(node); const val = (name: string) => item.children(name).first().text();
    try {
      const url = canonical(item.children('link').filter((_, el) => !$(el).attr('rel') || $(el).attr('rel') === 'alternate').first().attr('href') ?? '');
      if (new URL(url).hostname !== 'www.apple.com' || !new URL(url).pathname.startsWith('/newsroom/')) return;
      const published = val('published'); const updated = val('updated'); const text = clean(val('content') || val('summary'));
      const a = article('apple', url, val('title').trim(), published || updated, fetched, text);
      Object.assign(a, { updated_at: updated || null, original_article_published_at: published || null,
        published_time_kind: published ? 'atom_publication' : 'atom_update_not_publication', content_status: 'discovery_only', content_origin: 'atom_summary' });
      rows.push(a);
    } catch { /* Invalid article/time remains unavailable. */ }
  }); return rows;
}
export function parseTesla(raw: string, fetched: string): Row[] {
  const $ = load(raw); const rows: Row[] = []; const seen = new Set<string>();
  $('a[href*="/press-release/"]').each((_, el) => {
    try {
      const url = canonical(new URL($(el).attr('href')!, 'https://ir.tesla.com').href); const title = whitespace($(el).text());
      if (new URL(url).hostname !== 'ir.tesla.com' || seen.has(url) || !title) return; seen.add(url);
      const a = article('tesla', url, title, fetched, fetched, '');
      Object.assign(a, { published_raw: '', original_article_published_at: null, published_time_kind: 'discovery_time_not_publication', content_status: 'discovery_only', content_origin: 'ir_listing' }); rows.push(a);
    } catch { /* Skip invalid links. */ }
  }); return rows.slice(0, 20);
}
export function parseHnItem(item: any, fetched: string, rank: number): Row | null {
  if (!item || item.type !== 'story' || item.dead || item.deleted || !Number.isInteger(item.id) || !Number.isInteger(item.time) || !item.title) return null;
  const title = clean(item.title);
  if (!/\b(?:ai|llm|gpu|cpu|api|openai|anthropic|chatgpt|claude|chip|chips|software|hardware|python|rust|linux|windows|apple|google|microsoft|github|security|browser|computer|computers|developer|developers|programming|database|databases|cloud|research|technology|tech|code|coding|model|models|web|internet|framework|encryption)\b/i.test(title)) return null;
  const discussion = `https://news.ycombinator.com/item?id=${item.id}`; let url = discussion;
  try { url = canonical(item.url ?? ''); } catch { /* HN text submission. */ }
  const text = clean(item.text ?? ''); const submitted = stamp(new Date(item.time * 1000));
  return { id: digest(discussion), url, source: 'hackernews', source_name: 'Hacker News', title, published_raw: String(item.time), published_at: submitted,
    published_time_kind: 'hn_submission', original_article_published_at: null, source_submitted_at: submitted, fetched_at: fetched, event_time: null, text,
    content_status: 'discovery_only', content_fingerprint: digest(title + '\n' + text), content_origin: 'hn_submission_not_article', language: 'en', description_clean: text,
    rights_status: 'unconfirmed_original_publisher_rights', discussion_url: discussion, discovery_rank: rank, community_score: item.score ?? null,
    uncertainty: 'HN投稿/热度不代表原文发表时间、新闻新鲜度或事实核实；未获取链接正文' };
}
export async function mapLimit<T, U>(items: T[], limit: number, fn: (value: T) => Promise<U>): Promise<U[]> {
  const output: U[] = new Array(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) { const i = cursor++; if (i >= items.length) return; output[i] = await fn(items[i]); }
  })); return output;
}
export async function get(url: string, fetcher: typeof fetch = fetch, redirects = true) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(40000), redirect: redirects ? 'follow' : 'manual', headers: { 'User-Agent': 'EverydayTechNews-internal-research/TS-1.0' } });
  if (!response.ok) throw Object.assign(new Error('http_error'), { status: response.status });
  const raw = Buffer.from(await response.arrayBuffer());
  if (raw.length > 20_000_000) throw new Error('oversized_source');
  return { raw, response };
}
async function supplement(rows: Row[], folder: string, fetcher: typeof fetch) {
  for (const a of rows.slice(0, 5)) {
    if (a.source === 'apple' && Date.now() - Date.parse(a.published_at) > 172800000) continue;
    try {
      const url = new URL(a.url); const [host, prefix] = a.source === 'apple' ? ['www.apple.com', '/newsroom/'] : ['ir.tesla.com', '/press-release/'];
      if (url.hostname !== host || !url.pathname.startsWith(prefix)) throw new Error('body_url_not_allowlisted');
      const { raw, response } = await get(a.url, fetcher, false); if (response.status !== 200) throw new Error('article_redirect_or_blocked');
      a.body_fetched_at = stamp(); a.fetched_at = a.body_fetched_at;
      const path = `${folder}/feeds/${a.source}/${digest(raw.toString('hex'))}.html`; mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, raw);
      const $ = load(raw.toString('utf8')); let date = $('meta[property="article:published_time"],meta[name="datePublished"]').first().attr('content');
      const published = (o: any): any => Array.isArray(o) ? o.map(published).find(Boolean) : o && typeof o === 'object' ? o.datePublished || published(o['@graph'] ?? []) : null;
      $('script[type="application/ld+json"]').each((_, el) => { try { date ||= published(JSON.parse($(el).text())); } catch { /* Unusable metadata. */ } });
      if (!date) { a.body_probe_status = 'publication_timestamp_unconfirmed'; continue; }
      const pub = time(date); const node = $('.article-body, .pagebody, .wd_body, article').first();
      if (!node.length) { a.body_probe_status = 'article_selector_missing'; continue; }
      const text = clean($.html(node)); Object.assign(a, { text, content_fingerprint: digest(text), content_status: complete(text), content_origin: 'official_article_html', published_raw: date,
        published_at: pub, original_article_published_at: pub, published_time_kind: 'official_article_publication', body_snapshot: path, body_probe_status: 'parsed' });
    } catch (error) { if (storageError(error)) throw error; a.body_probe_status = 'fetch_or_parse_failed'; }
  }
}
export async function fetchSource(source: string, folder: string, fetcher: typeof fetch = fetch): Promise<{ rows: Row[]; health: Row }> {
  const start = performance.now(); let response: Response | undefined; let rows: Row[] = []; let raw: Buffer; let suffix = '.xml';
  try {
    const result = await get((SOURCES as Row)[source][1], fetcher); response = result.response; raw = result.raw; const observed = stamp();
    let feedItems: number; let scanned: number; let failures = 0;
    if (source === 'hackernews') {
      const ids = JSON.parse(raw.toString()); if (!Array.isArray(ids)) throw new Error('invalid_hn_list');
      const chosen = ids.slice(0, 30).filter(x => Number.isInteger(x) && x > 0);
      const items = await mapLimit(chosen, 5, async id => { try { return JSON.parse((await get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, fetcher)).raw.toString()); } catch { return null; } });
      rows = items.map((item, i) => parseHnItem(item, observed, i + 1)).filter((a): a is Row => a !== null);
      raw = Buffer.from(pyjson({ top_ids: ids, scanned_ids: chosen, items })); feedItems = ids.length; scanned = chosen.length; failures = items.filter(x => x === null).length; suffix = '.json';
    } else if (source === 'apple' || source === 'tesla') {
      rows = source === 'apple' ? parseAtom(raw.toString('utf8'), observed) : parseTesla(raw.toString('utf8'), observed);
      feedItems = rows.length; scanned = feedItems; suffix = source === 'apple' ? '.xml' : '.html'; await supplement(rows, folder, fetcher);
    } else { rows = parseFeed(raw.toString('utf8'), source, observed); feedItems = load(raw.toString('utf8'), { xml: true })('rss > channel > item').length; scanned = Math.min(100, feedItems); }
    if (!rows.length) throw new Error('empty_feed');
    const hash = digest(raw); const path = `${folder}/feeds/${source}/${hash}${suffix}`;
    // Storage errors deliberately propagate rather than turning into source failures.
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, raw);
    for (const a of rows) Object.assign(a, { feed_sha256: hash, source_observed_at: observed, feed_snapshot: path });
    return { rows, health: { source, ok: true, count: rows.length, usable: rows.filter(a => a.content_status === 'usable_excerpt').length,
      discovery_only: rows.filter(a => a.content_status === 'discovery_only').length, feed_item_count: feedItems, scanned, item_failures: failures,
      retained_limit: source === 'hackernews' ? 30 : 100, http_status: response.status, final_url: response.url || (SOURCES as Row)[source][1],
      execution_environment: process.env.GITHUB_ACTIONS === 'true' ? 'github_actions' : 'local', seconds: (performance.now() - start) / 1000 } };
  } catch (error) {
    if (storageError(error)) throw error;
    return { rows: [], health: { source, ok: false, error: 'fetch_or_parse_failed', http_status: (error as any).status ?? null,
      execution_environment: process.env.GITHUB_ACTIONS === 'true' ? 'github_actions' : 'local', seconds: (performance.now() - start) / 1000 } };
  }
}
function storageError(error: unknown) {
  return ['ENOSPC', 'EACCES', 'EPERM', 'EIO', 'EROFS', 'ENOTDIR', 'EISDIR', 'EMFILE', 'ENOENT'].includes(String((error as NodeJS.ErrnoException)?.code));
}
