import { readFileSync } from 'node:fs';
import { load } from 'cheerio/slim';
import type { Row } from './core.ts';
export const hnConfig: Row = JSON.parse(readFileSync(new URL('../../../experiments/premium/hn-publishers.json', import.meta.url), 'utf8'));
export function hnPublisher(value: string): Row | null {
  try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const p = hnConfig.publishers[url.hostname]; return p && p.paths.some((prefix: string) => url.pathname.startsWith(prefix)) ? p : null;
  } catch { return null; }
}
// A post's submission time is never substituted for the linked article's publication time.
export function extractHnPublisher(raw: string, a: Row): Row {
  const publisher = hnPublisher(a.url); if (!publisher) return { body_probe_status: 'publisher_not_allowlisted' };
  const $ = load(raw); const node = $(publisher.selector).filter((_, el) => !$(el).parents(publisher.selector).length).first();
  if ($('[class*="paywall"], [id*="paywall"], [data-paywall]').length) return { body_probe_status: 'restricted_content' };
  const canonical = $('link[rel="canonical"]').first().attr('href');
  if (canonical) {
    try { const normalized = (value: string) => { const u = new URL(value, a.url); return u.origin + u.pathname.replace(/\/+$/, ''); };
      if (normalized(canonical) !== normalized(a.url)) return { body_probe_status: 'canonical_mismatch' };
    } catch { return { body_probe_status: 'canonical_mismatch' }; }
  }
  if (!node.length) return { body_probe_status: 'article_selector_missing' };
  let date = $('meta[property="article:published_time"],meta[name="datePublished"]').first().attr('content');
  const dates: string[] = [];
  function visit(value: any) {
    if (Array.isArray(value)) { value.forEach(visit); return; } if (!value || typeof value !== 'object') return;
    if (['Article', 'NewsArticle', 'BlogPosting', 'TechArticle'].some(type => (Array.isArray(value['@type']) ? value['@type'] : [value['@type']]).includes(type))) {
      const identity = value.url ?? value.mainEntityOfPage?.['@id'];
      if ((!identity || new URL(identity, a.url).pathname.replace(/\/+$/, '') === new URL(a.url).pathname.replace(/\/+$/, '')) && typeof value.datePublished === 'string') dates.push(value.datePublished);
    }
    visit(value['@graph']);
  }
  $('script[type="application/ld+json"]').each((_, el) => { try { visit(JSON.parse($(el).text())); } catch { /* Invalid metadata cannot authorize publication. */ } });
  if (!date && new Set(dates).size === 1) date = dates[0];
  const times = node.find('time[datetime]').map((_, el) => $(el).attr('datetime')!).get();
  if (!date && new Set(times).size === 1) date = times[0];
  if (!date || !/(?:Z|[+-]\d\d:\d\d)$/.test(date) || !Number.isFinite(Date.parse(date))) return { body_probe_status: 'publication_timestamp_unconfirmed' };
  node.find('nav,header,footer,aside,script,style,form,[class*="related"],[class*="share"]').remove();
  return { body_probe_status: 'parsed', raw_article_html: $.html(node), publication_raw: date, publisher_host: new URL(a.url).hostname };
}
