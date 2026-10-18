import type { Article } from '../src/ranking.ts';
import type { Input } from '../src/cli.ts';

export const cutoff = '2026-10-18T12:00:00+08:00';
export function article(overrides: Partial<Article> = {}): Article {
  return { id: 'one', title: '大模型正式发布', text: '公司计划测试人工智能模型。', source: 'github',
    published_at: '2026-10-18T04:00:00+08:00', content_status: 'usable_excerpt', topic: 'AI', ...overrides };
}

// Entirely synthetic; no source text or private state is checked in.
export function synthetic(count: number): Article[] {
  const titles = ['大模型正式发布', 'Apple 测试新系统', 'NVIDIA 芯片更新', 'Tesla 自动驾驶测试', 'SpaceX 发射任务',
    '软件安全漏洞修复', '机器人研究报告', '日常生活记录', '游戏皮肤获奖', '产品限时优惠', 'open source release', '监管调查尚未证实'];
  const sources = ['github', 'nvidia', 'ithome', 'apple', 'nasa', 'cloudflare'];
  return Array.from({ length: count }, (_, i) => article({
    id: `item-${String(i).padStart(6, '0')}`, title: titles[i % titles.length], source: sources[(i * 7) % sources.length],
    topic: ['AI', '芯片', '软件', '其他科技'][i % 4],
    published_at: new Date(Date.parse(cutoff) - (i * 7919 % 200000) * 1000).toISOString(),
    content_status: i % 17 === 0 ? 'discovery_only' : 'usable_excerpt',
  }));
}

export function parityCases(): Input[] {
  const titles = ['AI Apple NVIDIA Tesla SpaceX 正式发布', '游戏皮肤主题壁纸获奖', 'sponsored AI deals',
    'AI模型', '模型LLM模型', '中文 GPU 中文', 'ＡＩ', 'aigpu', '_llm_', 'AI²', 'ai٣', 'AI\u0301', 'aı model',
    'GİTHUB OPENAİ ſecurity', 'open\rsource', 'open\nsource', 'self\u2028driving', 'Mac\u0085mini',
    'Mac\u001cmini', 'Mac\ufeffmini', 'GPT-٣ 正式发布', 'xApple1', 'xAI', '芯片 NVIDIA 更新', 'Robotaxi 计划测试'];
  const all = titles.flatMap((title, i) => [article({ id: `title-${i}`, title }), article({ id: `body-${i}`, title: '日常记录', text: title })]);
  for (const seconds of [0, 1, 57.6, 172.8, 3600, 12672, 86400, 172800, 172801, -1]) {
    all.push(article({ id: `age-${seconds}`, published_at: new Date(Date.parse(cutoff) - seconds * 1000).toISOString() }));
  }
  const ties = ['a', 'z', '中', '😀', '\ue000'].map(id => article({ id }));
  const diversity = synthetic(408);
  const boundary = [103680, 103680.000001, 103737.6, 103737.600001].flatMap((seconds, i) =>
    [article({ id: `boundary-${i}`, title: '产品', source: 'ithome', published_at: new Date(Date.parse(cutoff) - seconds * 1000).toISOString() }),
      article({ id: `sample-boundary-${i}`, title: '日常生活', text: '人工智能', source: 'ithome', published_at: new Date(Date.parse(cutoff) - seconds * 1000).toISOString() })]);
  boundary.push(article({ id: 'micro', published_at: '2026-10-17T07:12:57.600001+08:00' }));
  const offsets = [article({ id: 'a', published_at: '2026-10-18T04:00:00Z' }), article({ id: 'z', published_at: '2026-10-18T12:00:00+08:00' })];
  return [
    { operation: 'evaluate', articles: all, cutoff },
    { articles: all, cutoff }, { articles: all, cutoff, sample: true, target: 100 },
    { articles: ties, cutoff, target: 2 }, { articles: [...ties].reverse(), cutoff, target: 0 },
    { articles: diversity, cutoff, target: 32 }, { articles: diversity, cutoff, sample: true, target: 100 },
    { articles: [], cutoff },
    { articles: [article({ content_status: undefined }), article({ id: 'null-topic', topic: null })], cutoff },
    { operation: 'evaluate', articles: synthetic(2500), cutoff },
    { operation: 'evaluate', articles: boundary, cutoff }, { articles: boundary, cutoff }, { articles: boundary, cutoff, sample: true },
    { articles: offsets, cutoff },
    { articles: all, cutoff, config: { version: 'test-custom', interest_weights: { AI: 2, Apple: 3 }, edition_maximum: 3 } },
  ];
}
