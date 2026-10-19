import { readFileSync } from 'node:fs';
import { choose, evaluate, preferences, type Article, type EditorialConfig } from './ranking.ts';
import { timestamp } from './compat.ts';

export interface Input {
  operation?: 'choose' | 'evaluate';
  articles: Article[];
  cutoff: string;
  config?: EditorialConfig;
  sample?: boolean;
  target?: number | null;
}
export function execute(input: Input) {
  if (!input || !Array.isArray(input.articles)) throw new Error('articles must be an array');
  timestamp(input.cutoff);
  if (input.operation !== undefined && input.operation !== 'choose' && input.operation !== 'evaluate') throw new Error('Unknown operation');
  if (input.sample !== undefined && typeof input.sample !== 'boolean') throw new Error('sample must be boolean');
  if (input.target != null && (!Number.isInteger(input.target) || input.target < 0)) throw new Error('Invalid target');
  for (const article of input.articles) {
    if (!article || ['id', 'title', 'text', 'source', 'published_at'].some(k => typeof article[k] !== 'string')) throw new Error('Invalid article fields');
    timestamp(article.published_at);
  }
  const config = input.config ?? preferences();
  if (!config || typeof config.version !== 'string' || !Number.isInteger(config.edition_maximum) || config.edition_maximum < 1
    || !config.interest_weights || Object.values(config.interest_weights).some(x => typeof x !== 'number' || !Number.isFinite(x))) throw new Error('Invalid editorial config');
  if (input.operation === 'evaluate') return { rankings: input.articles.map(a => evaluate(a, input.cutoff, config)) };
  const [selected, rejected] = choose(input.articles, input.cutoff, config, input);
  return { selected, rejected };
}
if (import.meta.main) {
  try {
    if (process.argv.length > 3) throw new Error('Usage: node src/cli.ts [input.json|-]');
    const path = process.argv[2];
    const input = JSON.parse(readFileSync(!path || path === '-' ? 0 : path, 'utf8'));
    console.log(JSON.stringify(execute(input)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Ranking failed'); process.exitCode = 1;
  }
}
