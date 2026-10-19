import { readFileSync } from 'node:fs';
import { search } from './compat.ts';
import { preferences } from './ranking.ts';
import type { Row } from './core.ts';
const rules = JSON.parse(readFileSync(new URL('../../../config/news-filter.json', import.meta.url), 'utf8'));
export const FILTER_VERSION = rules.version;
const fold = (s: string) => s.toLowerCase().replaceAll('ß', 'ss').replaceAll('ſ', 's');
export function titleExclusion(title: string): Row | null {
  const normalized = fold(title);
  const keyword = rules.keywords.find((word: string) => normalized.includes(fold(word)));
  if (keyword) return { reason: 'shared_filter_keyword', matched_keyword: keyword, filter_version: FILTER_VERSION };
  if (rules.currency_patterns.some((pattern: string) => search(pattern, title, false))) return { reason: 'shared_filter_price', filter_version: FILTER_VERSION };
  return null;
}
// Brands are interests, not domains. Prefer the subject of the title to incidental body mentions.
const domains = [
  ['安全与网络', '漏洞|网络安全|隐私|加密|泄露|黑客|安全补丁|\\bsecurity\\b|vulnerab|encryption|privacy|data breach|\\btees?\\b'],
  ['航天与科学', '航天|火箭|卫星|星舰|太空|空间站|月球|火星|物理|天文|电池研究|科研|spacex|nasa|starship|starlink|rocket|satellite|physics|astronomy|scientific'],
  ['汽车与机器人', '汽车|自动驾驶|机器人|无人机|特斯拉|tesla|robot|autonomous|drone'],
  ['人工智能', '\\bai\\b|人工智能|大模型|智能体|deepseek|openai|anthropic|chatgpt|claude|copilot|\\bllms?\\b|machine learning'],
  ['芯片与计算硬件', '芯片|半导体|显卡|算力|服务器|\\bgpu\\b|\\bcpu\\b|nvidia|英伟达|geforce|semiconductor|hardware|processor|esp32|firmware|嵌入式'],
  ['软件与开发', '软件|开源|编程|代码|开发|操作系统|浏览器|数据库|linux|windows|python|rust|javascript|typescript|parser|combinator|compiler|database|programming|developer|framework|software|browser|\\bapi\\b|release|update'],
  ['消费电子', '手机|电脑|笔记本|耳机|手表|眼镜|门锁|iphone|ipad|macbook|surface|smartphone|laptop|wearable'],
] as const;
export const DOMAIN_NAMES = [...domains.map(([name]) => name), '科技产业'];
export function analyzeDomain(a: Row): Row {
  for (const [name, pattern] of domains) if (search(pattern, a.title)) return { primary: name, version: 'domains-1', basis: 'title' };
  return { primary: '科技产业', version: 'domains-1', basis: 'fallback' };
}
export function publisherKey(a: Row): string | null {
  let host: string;
  try { host = new URL(a.url).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return a.source ? 'source:' + a.source : null; }
  return ['ithome.com', 'apple.com', 'nasa.gov', 'nvidia.com', 'microsoft.com', 'cloudflare.com', 'electrek.co']
    .find(root => host === root || host.endsWith('.' + root)) ?? host;
}
export function publisherMaximum(a: Row): number {
  const p = preferences().source_policy as Row;
  return Number(p.overrides?.[publisherKey(a) ?? ''] ?? p.maximum_per_publisher);
}
export function publisherCapacityReached(a: Row, records: Row[]): boolean {
  const key = publisherKey(a);
  return !!key && records.filter(r => publisherKey(r.article ?? r) === key).length >= publisherMaximum(a);
}
export function limitDomains<T extends Row>(input: T[], rejected: Row[] = [], maximum = Number(preferences().edition_maximum)): T[] {
  const p = preferences().domain_policy as Row; const counts = new Map<string, number>(); const leads = new Map<string, number>(); const chosen: T[] = []; const deferred: T[] = [];
  const sourcePolicy = preferences().source_policy as Row; const publishers = new Map<string, number>(); const publisherLeads = new Map<string, number>();
  const leadCount = Number(preferences().lead_count);
  for (const original of input) {
    const a = original.article ?? original; const domain = analyzeDomain(a); a.domain = domain.primary; a.domain_analysis = domain;
    const exclusion = titleExclusion(a.title) ?? (original.result?.title ? titleExclusion(original.result.title) : null);
    if (exclusion) { rejected.push({ id: a.id, ...exclusion }); continue; }
    const publisher = publisherKey(a);
    if (publisher && (publishers.get(publisher) ?? 0) >= publisherMaximum(a)) { rejected.push({ id: a.id, reason: 'publisher_capacity', publisher }); continue; }
    if ((counts.get(a.domain) ?? 0) >= p.maximum_per_domain) { rejected.push({ id: a.id, reason: 'domain_capacity', domain: a.domain }); continue; }
    if (chosen.length < leadCount && ((leads.get(a.domain) ?? 0) >= p.maximum_leads_per_domain
      || publisher && (publisherLeads.get(publisher) ?? 0) >= sourcePolicy.maximum_leads_per_publisher)) { deferred.push(original); continue; }
    if (chosen.length >= maximum) { rejected.push({ id: a.id, reason: 'edition_capacity', domain: a.domain }); continue; }
    chosen.push(original); counts.set(a.domain, (counts.get(a.domain) ?? 0) + 1);
    if (publisher) publishers.set(publisher, (publishers.get(publisher) ?? 0) + 1);
    if (chosen.length <= leadCount) leads.set(a.domain, (leads.get(a.domain) ?? 0) + 1);
    if (chosen.length <= leadCount && publisher) publisherLeads.set(publisher, (publisherLeads.get(publisher) ?? 0) + 1);
  }
  // If fewer than five distinct-enough leads exist, keep a short edition rather than silently exceeding the lead limit.
  if (chosen.length >= leadCount) for (const row of deferred) {
    const a = row.article ?? row;
    const publisher = publisherKey(a);
    if (publisher && (publishers.get(publisher) ?? 0) >= publisherMaximum(a)) { rejected.push({ id: a.id, reason: 'publisher_capacity', publisher }); continue; }
    if (chosen.length < maximum && (counts.get(a.domain) ?? 0) < p.maximum_per_domain) { chosen.push(row); counts.set(a.domain, (counts.get(a.domain) ?? 0) + 1); if (publisher) publishers.set(publisher, (publishers.get(publisher) ?? 0) + 1); }
    else rejected.push({ id: a.id, reason: chosen.length >= maximum ? 'edition_capacity' : 'domain_capacity', domain: a.domain });
  }
  else for (const row of deferred) rejected.push({ id: (row.article ?? row).id, reason: 'lead_diversity_capacity', domain: (row.article ?? row).domain, publisher: publisherKey(row.article ?? row) });
  return chosen;
}
