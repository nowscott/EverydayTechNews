import { choose, evaluate, preferences, type Article } from './ranking.ts';
import { search, compareText, microtimestamp } from './compat.ts';
import type { Row } from './core.ts';

export function topic(a: Row): string {
  const title = a.title.toLowerCase();
  for (const [label, pattern] of [
    ['AI', '\\bai\\b|人工智能|大模型|deepseek|chatgpt|智能体|copilot|foundry|agents?|llm'],
    ['芯片', '芯片|gpu|cpu|半导体|显卡|geforce'],
    ['软件更新', '更新|版本|软件|linux|windows|开源|available|runner|release|update|gateway|license'],
    ['产品发布', '发布|推出|上线|手机|笔记本'], ['行业事件', '公司|收购|营收|监管|投资|市场|company|acquisition|revenue|regulation'],
  ]) if (search(pattern, title, false)) return label;
  return '其他科技';
}

import { sequenceRatio } from '../../news-common/src/text.ts';
export { sequenceRatio } from '../../news-common/src/text.ts';
const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}_]/gu, '');
const terms = (s: string) => new Set(s.toLowerCase().match(/[a-z]+[ -]?\p{Nd}+[a-z0-9.\-]*|rtx\s*spark|deepseek[ -]v[\p{L}\p{N}_.\-]+|iphone\s+duo|roadster|robotaxi|starship|starlink/gu) ?? []);
const actions = ['发布|推出|上线|launch|release|introduc|arriv', '价格|售价|price|pricing', '安全|漏洞|security|vulnerab', '交付|deliver', '测试|预览|beta|preview|test', 'walk[ -]?in|无预约|现货|首发日'];
export function eventIdentity(a: Row): string | null {
  const title = a.title.toLowerCase();
  if (/tesla|特斯拉/.test(title) && /spacex/.test(title) && /merg|合并|合併/.test(title)) return 'tesla-spacex-merger';
  const cves = title.match(/cve-\d{4}-\d+/g);
  if (cves?.length) return 'security:' + [...new Set(cves)].sort().join(',');
  return null;
}
export function evidencePriority(a: Row): number {
  return (a.content_status === 'usable_excerpt' ? 100 : 0) + (a.content_origin === 'hn_show_original_post' ? 0 : /official|官方/.test(a.source_name ?? '') ? 20 : 0)
    + Math.min(10, Math.floor(Array.from(a.text ?? '').length / 500));
}
export function duplicate(a: Row, b: Row): boolean {
  if (a.url && a.url === b.url || a.content_fingerprint && a.content_fingerprint === b.content_fingerprint) return true;
  if (eventIdentity(a) && eventIdentity(a) === eventIdentity(b)) return true;
  if (sequenceRatio(normalize(a.title), normalize(b.title)) >= .72) return true;
  const bt = terms(b.title);
  return [...terms(a.title)].some(t => bt.has(t)) && actions.some(p => search(p, a.title) && search(p, b.title));
}
export function select(input: Row[], cutoff: string, sample = false, target?: number): [Row[], Row[]] {
  const selected: Row[] = []; const rejected: Row[] = []; const latest = new Map<string, Row>();
  const clock = microtimestamp(cutoff);
  const rows = input.map(a => ({ ...a })).sort((a, b) => compareText(a._last_observed_at ?? a.fetched_at, b._last_observed_at ?? b.fetched_at));
  for (const a of rows) {
    if (microtimestamp(a.fetched_at) > clock) { rejected.push({ id: a.id, content_fingerprint:a.content_fingerprint, title: a.title, reason: 'fetched_after_cutoff' }); continue; }
    latest.set(a.id, a);
  }
  const ordered = [...latest.values()].sort((a, b) => evidencePriority(b) - evidencePriority(a) || evaluate(b as Article, cutoff, preferences()).score - evaluate(a as Article, cutoff, preferences()).score || compareText(b.published_at, a.published_at));
  for (const a of ordered) {
    const published = microtimestamp(a.published_at); let reason: string | null = null;
    if (microtimestamp(a.fetched_at) > clock) reason = 'fetched_after_cutoff';
    else if (published > clock) reason = 'future_publication';
    else if (!sample && published < clock - 86400000000n) {
      if (a.update_review_required && microtimestamp(a.fetched_at) >= clock - 86400000000n) a.timeliness = 'older_publication_recent_content_change_pending_review';
      else reason = 'old_news';
    }
    if (!reason && a.content_status !== 'usable_excerpt') reason = a.content_status === 'discovery_only' ? 'discovery_only_no_body' : 'insufficient_content';
    if (!reason && search('优惠|好价|促销|广告|秒杀|红包|IT早报|新闻汇总|Everything we launched|Top Stories:|Weekly Roundup|Week in Review|Best Deals|Rocket Report:', a.title)) reason = 'promotion_or_roundup';
    const matches = !reason ? selected.filter(b => duplicate(a, b)).map(b => b.id) : [];
    if (matches.length) reason = 'duplicate_or_event_review';
    if (reason) { rejected.push({ id: a.id, content_fingerprint:a.content_fingerprint, title: a.title, reason, event_matches: matches }); continue; }
    a.topic = topic(a); a.event_group = a.id; selected.push(a);
  }
  const [chosen, extra] = choose(selected as Article[], cutoff, preferences(), { sample, target });
  return [chosen, [...rejected, ...extra]];
}
