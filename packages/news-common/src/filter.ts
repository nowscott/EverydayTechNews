import { readFileSync } from 'node:fs';
import { search } from './compat.ts';
type Row = Record<string, any>;
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
