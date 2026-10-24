import { readFileSync, existsSync, readdirSync, unlinkSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { load } from 'cheerio/slim';
import { XMLParser } from 'fast-xml-parser';
import { sequenceRatio } from '../../news-common/src/text.ts';
import { titleExclusion } from '../../news-common/src/filter.ts';
import { day, yesterday, atomicText, atomic, sleep, hash, type Row } from './core.ts';
import { Store } from './store.ts';
export type News = { title: string; link: string; time: string; category: string };
export type Item = [string, string];
export const parseMarkdown = (s: string): Item[] => [...s.matchAll(/- \[(.*?)\]\((.*?)\)/g)].map(m => [m[1], m[2]]);
export const heading = (date: string, sorted = false) => '# 今日新闻 - ' + date.replace(/^(\d+)-(\d+)-(\d+)$/, '$1年$2月$3日') + (sorted ? '(sorted)' : '') + '\n';
export const archivePath = (root: string, date: string) => root + '/news_archive/' + date.slice(0, 7) + '/' + date.slice(8) + '.md';
export const markdown = (items: Item[]) => items.map(([t, u]) => `- [${t}](${u})`).join('\n') + (items.length ? '\n' : '');
const shanghai = (date: Date) => new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 19);
export function parseHtml(raw: string): News[] {
  const $ = load(raw); const rows: News[] = [];
  $('ul.datel li').each((_i, li) => {
    const c = $(li).find('a.c'), a = $(li).find('a.t'), t = $(li).find('i');
    const title = a.text().trim(), link = a.attr('href'), time = t.text().trim();
    if (!c.length || !a.length || !t.length || !title || !link || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(time)) return;
    const date = new Date(time.replace(' ', 'T') + '+08:00');
    if (!Number.isFinite(date.getTime()) || shanghai(date) !== time.replace(' ', 'T')) return;
    rows.push({ title, link, time: time.replace(' ', 'T'), category: c.text().trim() });
  }); return rows;
}
export function parseRss(raw: string): News[] {
  const doc = new XMLParser({ ignoreAttributes: false, trimValues: false }).parse(raw);
  let items = doc.rss?.channel?.item ?? []; if (!Array.isArray(items)) items = [items];
  return items.flatMap((i: Row) => {
    const title = String(i.title ?? '').trim(), link = String(i.link ?? '').trim(), published = String(i.pubDate ?? '').trim();
    if (!title || !link || !published) return [];
    const naive = /\d\d:\d\d(?::\d\d)?$/.test(published);
    const date = new Date(published + (naive ? ' +0800' : ''));
    return Number.isFinite(date.getTime()) ? [{ title, link, time: shanghai(date), category: 'IT之家' }] : [];
  });
}
export async function request(url: string, fetcher: typeof fetch = fetch, retries = 3, timeout = 40000, delays = [2000, 5000]): Promise<string> {
  let last:unknown;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetcher(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(timeout) });
      if (response.ok) return await response.text();
      last=Object.assign(new Error('source_http_error'),{http_status:response.status});
      if (![429, 500, 502, 503, 504].includes(response.status)) throw Object.assign(new Error('source_http_permanent'),{http_status:response.status});
    } catch (e) { last=e;if (e instanceof Error && e.message === 'source_http_permanent') throw e; }
    if (i + 1 < retries) await sleep(delays[Math.min(i, delays.length - 1)] ?? 0);
  }
  throw Object.assign(new Error('source_retries_exhausted'),{http_status:(last as any)?.http_status,cause_code:(last as any)?.name==='TimeoutError'?'timeout':'network_or_http'});
}
export function recoverArchive(root: string) {
  const path=root+'/archive-journal.json';if(!existsSync(path))return;
  const journal=JSON.parse(readFileSync(path,'utf8'));
  for(const item of journal.updates??[]) {if(!/^news_archive\/\d{4}-\d\d\/\d\d\.md$/.test(item.path)||typeof item.body!=='string'||hash(item.body)!==item.sha256)throw new Error('archive_journal_invalid');}
  for(const item of journal.updates)atomicText(root+'/'+item.path,item.body);
  unlinkSync(path);const dir=openSync(root,'r');try{fsyncSync(dir);}finally{closeSync(dir);}
}
export function saveNews(root: string, now: Date, input: News[]) {
  recoverArchive(root);
  const today = archivePath(root, day(now)); if (!existsSync(today)) atomicText(today, heading(day(now)));
  const states = new Map<string, string>(); let written = 0;
  const get = (p: string, h: string) => { if (!states.has(p)) states.set(p, existsSync(p) ? readFileSync(p, 'utf8') : h); return states.get(p)!; };
  for (const a of input) {
    const date = a.time.slice(0, 10), monthPath = root + '/news_archive/' + date.slice(0, 7) + '/00.md';
    const month = get(monthPath, '# 本月新闻\n'); const old = parseMarkdown(month);
    if (old.some(([title, url]) => url === a.link || Math.round(sequenceRatio(title, a.title) * 10000) / 10000 >= .9)) continue;
    const line = markdown([[a.title, a.link]]); states.set(monthPath, month + line); written++;
    const path = archivePath(root, date); const daily = get(path, heading(date));
    if (!daily.includes('(sorted)') && !parseMarkdown(daily).some(([, url]) => url === a.link)) states.set(path, daily + line);
  }
  if(states.size) {atomic(root+'/archive-journal.json',{updates:[...states].map(([path,body])=>({path:path.slice(root.length+1),body,sha256:hash(body)}))});recoverArchive(root);}
  return { added: written, fetched: input.length };
}
export async function collect(store: Store, now = new Date(), fetcher: typeof fetch = fetch): Promise<Row> {
  recoverArchive(store.root);
  const sources = [['list', 'https://www.ithome.com/list/', parseHtml], ['rss', 'https://www.ithome.com/rss/', parseRss]] as const;
  for (const [source, url, parse] of sources) {
    try { const rows = parse(await request(url, fetcher)); if (!rows.length) continue;
      const result = { at: now.toISOString(), source, ...saveNews(store.root, now, rows) }; store.meta('collection', result); return result;
    } catch { /* Independent RSS fallback; no response bodies in logs. */ }
  }
  throw new Error('all_collection_sources_failed');
}
export function calculateScore(valuable: number, unvaluable: number): number {
  if (valuable + unvaluable === 0) return 0; if (!valuable) return -10; if (!unvaluable) return 10 + valuable;
  return valuable / (valuable + unvaluable) * 10;
}
export function parseGrade(raw: string): [number, number] {
  const a = /id=["']sgrade2["'][\s\S]*?<div>(\d+)<\/div>/.exec(raw), b = /id=["']sgrade0["'][\s\S]*?<div>(\d+)<\/div>/.exec(raw);
  if (!a || !b) throw new Error('grade_parse_failed'); return [Number(a[1]), Number(b[1])];
}
export const newsId = (url: string) => /\/((?:\d+\/)+\d+)\.htm(?:[?#].*)?$/.exec(url)?.[1].replaceAll('/', '').replace(/^0+(?=\d)/, '') ?? null;
export function sortItems(items: Item[], values: Record<string, number>): Item[] { return [...items].sort((a, b) => (values[b[1]] ?? -100) - (values[a[1]] ?? -100)); }
export async function rank(store: Store, now = new Date(), fetcher: typeof fetch = fetch) {
  recoverArchive(store.root);
  const date = yesterday(now), path = archivePath(store.root, date);
  if (!existsSync(path)) throw new Error('yesterday_archive_missing');
  const before = readFileSync(path, 'utf8'); if (before.includes('(sorted)')) return { status: 'already_sorted', day: date };
  const items = parseMarkdown(before); const unique = [...new Map(items.map(a => [a[1], a])).values()]; let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, unique.length) }, async () => {
    while (next < unique.length) {
      const [title, url] = unique[next++]; if (store.one('SELECT url FROM grades WHERE day=? AND url=?', date, url)) continue;
      let score = -100, status = 'failed', details: Row = {}; const id = newsId(url);
      if (titleExclusion(title)) { score = -1000; status = 'filtered'; }
      else if (id) for (let attempt = 1; attempt <= 3; attempt++) {
        try { const raw = await request('https://dyn.ithome.com/grade/' + id, fetcher, 1, 15000, []); const votes = parseGrade(raw);
          score = calculateScore(...votes); status = 'valid'; details = { votes, attempts: attempt, response_sha256: hash(raw) }; break;
        } catch (error:any) { details = { attempts: attempt, failed_at:new Date().toISOString(), error_code:error.message==='grade_parse_failed'?'grade_parse_failed':error.http_status?'grade_http_error':error.name==='TimeoutError'||error.cause_code==='timeout'?'grade_timeout':'grade_network_error', http_status:error.http_status??null, parser_version:'ithome-votes-1' }; if (attempt < 3) await sleep(1000); }
      }
      store.run('INSERT OR REPLACE INTO grades VALUES (?,?,?,?,?)', date, url, score, status, JSON.stringify(details));
    }
  }));
  const grades = store.all('SELECT url,score,status,data FROM grades WHERE day=?', date); const values = Object.fromEntries(grades.map(a => [a.url, a.score]));
  const sorted = sortItems(items, values); const after = heading(date, true) + markdown(sorted);
  atomic(store.root + '/rank-evidence/' + date + '.json', { day: date, before, values, grades, input_sha256: hash(before), output_sha256: hash(after) });
  atomicText(path, after); return { day: date, total: items.length, valid: grades.filter(g => g.status === 'valid').length, failed: grades.filter(g => g.status === 'failed').length };
}
export function archiveFiles(root: string): string[] {
  if (!existsSync(root + '/news_archive')) return [];
  return readdirSync(root + '/news_archive', { withFileTypes: true }).filter(d => d.isDirectory() && /^\d{4}-\d\d$/.test(d.name)).flatMap(d => readdirSync(root + '/news_archive/' + d.name).filter(n => /^\d\d\.md$/.test(n)).map(n => d.name + '/' + n));
}
