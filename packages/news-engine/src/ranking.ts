import { readFileSync } from 'node:fs';
import { search, round2, timestamp, microtimestamp, compareText } from './compat.ts';
import { VERSION, PRIMARY, AI, CHIPS, SOFTWARE, INTERESTS, BROAD, IMPACT } from './rules.ts';
export { VERSION } from './rules.ts';

export interface EditorialConfig {
  version: string;
  interest_weights: Record<string, number>;
  edition_maximum: number;
  [key: string]: unknown;
}
export interface Article {
  id: string;
  title: string;
  text: string;
  source: string;
  published_at: string;
  content_status?: string;
  topic?: string | null;
  [key: string]: unknown;
}
export interface Ranking {
  version: string;
  score: number;
  interests: string[];
  config: EditorialConfig;
  breakdown: Record<string, number>;
  signals: string[];
  note: string;
  selection_order?: number;
  diversity_adjustment?: number;
}
export type RankedArticle = Article & { ranking: Ranking };
export interface Rejection {
  id: string; title: string;
  reason: 'editorial_score_below_threshold' | 'edition_capacity';
  ranking: Ranking;
}
export function preferences(): EditorialConfig {
  return JSON.parse(readFileSync(new URL('../../../experiments/premium/editorial.json', import.meta.url), 'utf8'));
}

const relevant = [AI, CHIPS, SOFTWARE, BROAD].join('|');
const primary = new Set<string>(PRIMARY);

export function evaluate(a: Article, cutoff: string, config: EditorialConfig): Ranking {
  const interests = Object.entries(INTERESTS).filter(([, pattern]) => search(pattern, a.title)).map(([name]) => name);
  const signals: string[] = [];
  let relevance: number;
  if (interests.length || search(relevant, a.title)) { relevance = 30; signals.push('科技领域直接相关'); }
  else if (search(relevant, a.text)) { relevance = 12; signals.push('仅正文涉及科技，关联弱'); }
  else { relevance = 5; signals.push('科技关联弱'); }
  const interestBonus = interests.length ? Math.max(...interests.map(x => config.interest_weights[x] ?? 0)) : 0;
  let impact = 4;
  for (const [pattern, value, reason] of IMPACT) {
    if (search(pattern, a.title)) { impact = Math.max(impact, value); signals.push(reason); }
  }
  // Python timedelta retains integer microseconds before conversion to seconds.
  const age = Math.max(0, Number(microtimestamp(cutoff) - microtimestamp(a.published_at)) / 1e6 / 3600);
  const freshness = round2(15 * Math.max(0, 1 - age / 48));
  let evidence = 13;
  const provenance = primary.has(a.source) ? 8 : 5;
  let penalty = 0;
  if (search('优惠|好价|促销|广告|秒杀|红包|sponsored|deals|giveaway', a.title)) {
    penalty = 45; signals.push('营销选题降权');
  } else if (search('配色|主题壁纸|表盘|抽奖|促销|获奖|award|celebrat', a.title)) {
    penalty = 16; signals.push('装饰/宣传内容降权');
  }
  if (search('战地|Gears of War|游戏皮肤|主题壁纸|表盘', a.title)) { penalty += 24; signals.push('非核心AI的游戏/外观更新降权'); }
  if (search("关注.{0,20}(账号|账户)|follow(?:s|ed|ing)? .{0,30}(?:account|tesla)|banana|香蕉|趣闻", a.title)) { penalty += 24; signals.push('社交关注或趣闻，信息增量低'); }
  if (search("(?:supercharg|充电站|超充).{0,60}(?:open|启用|开业|投票)|(?:open|启用|开业).{0,60}(?:supercharg|充电站|超充)", a.title)) { penalty += 20; signals.push('局部设施动态降权'); }
  if (search("预购.{0,20}(?:送达|交付)|(?:delivery|shipping) dates?.{0,20}(?:up|earl)|moving up.{0,30}(?:delivery|shipping)", a.title)) { penalty += 14; signals.push('局部订单时间调整降权'); }
  if (search("传闻|rumou?r|merger clues|hints?.{0,20}merger", a.title)) { penalty += 10; signals.push('未证实传闻降权'); }
  if (search('候选版本|候选版|release candidate|\\brc\\b', a.title) && !search('安全|漏洞|重大|security|vulnerab|breaking', a.title)) { penalty += 12; signals.push('常规候选版本降权'); }
  if (a.content_status !== 'usable_excerpt') { evidence = 0; penalty += 100; signals.push('正文不足，禁止生成'); }
  return {
    version: VERSION, score: round2(Math.max(0, Math.min(100, relevance + impact + freshness + evidence + provenance + interestBonus - penalty))),
    interests, config,
    breakdown: { relevance, impact, freshness, evidence_amount: evidence, source_proximity: provenance, interest_bonus: interestBonus, penalty: penalty ? -penalty : 0 },
    signals, note: '启发式选题分，不是事实正确率；企业自述仍需归因',
  };
}

/** Pure counterpart of ranking.choose: preserves input records without mutating them. */
export function choose(candidates: Article[], cutoff: string, config: EditorialConfig,
  options: { sample?: boolean; target?: number | null } = {}): [RankedArticle[], Rejection[]] {
  const target = options.target || config.edition_maximum; // Python treats zero as default.
  if (!Number.isInteger(target) || target < 0) throw new Error('target must be a non-negative integer');
  const minimum = options.sample ? 40 : 58;
  const pending: RankedArticle[] = candidates.map(a => ({ ...a, ranking: evaluate(a, cutoff, config) }));
  pending.sort((a, b) => b.ranking.score - a.ranking.score || compareText(b.published_at, a.published_at) || compareText(b.id, a.id));
  const sources = new Map<string, number>(); const topics = new Map<string | null | undefined, number>(); const counts = new Map<string, number>();
  const count = <T>(map: Map<T, number>, key: T) => map.get(key) ?? 0;
  const selected: RankedArticle[] = []; const rejected: Rejection[] = [];
  const diversity = (a: RankedArticle) => count(sources, a.source) + count(topics, a.topic ?? null)
    + (a.ranking.interests.length ? Math.min(...a.ranking.interests.map(x => count(counts, x))) : 0);
  while (pending.length && selected.length < target) {
    const best = pending.reduce((score, a) => Math.max(score, a.ranking.score), -Infinity);
    let index = -1;
    for (let i = 0; i < pending.length; i++) {
      const a = pending[i];
      if (a.ranking.score < best - 3) continue;
      if (index < 0) { index = i; continue; }
      const b = pending[index];
      const comparison = diversity(a) - diversity(b) || b.ranking.score - a.ranking.score || timestamp(b.published_at) - timestamp(a.published_at);
      if (comparison < 0) index = i;
    }
    const [a] = pending.splice(index, 1);
    if (a.ranking.score < minimum) {
      rejected.push({ id: a.id, title: a.title, reason: 'editorial_score_below_threshold', ranking: a.ranking }); continue;
    }
    a.ranking.selection_order = selected.length + 1; a.ranking.diversity_adjustment = 0;
    selected.push(a); sources.set(a.source, count(sources, a.source) + 1); topics.set(a.topic ?? null, count(topics, a.topic ?? null) + 1);
    for (const interest of a.ranking.interests) counts.set(interest, count(counts, interest) + 1);
  }
  rejected.push(...pending.map(a => ({ id: a.id, title: a.title, reason: 'edition_capacity' as const, ranking: a.ranking })));
  return [selected, rejected];
}
