import type { Row } from './core.ts';
import { complete } from './sources.ts';

/** 正文准入：选稿、排队、付费调用共用同一判定。
 *  只信任 content_status 会让「状态可用但正文为空/过短/截断」的条目占掉候选位，
 *  所以这里必须按实际正文再判一次。 */
export function contentAdmission(a: Row): string | null {
  if (a.evidence_expired_or_missing) return 'evidence_expired_or_missing';
  if (['electrek_tesla', 'teslanorth_tesla'].includes(a.source) && a.content_origin !== 'media_article_html') return 'media_article_body_unverified';
  if (a.content_status !== 'usable_excerpt') return 'insufficient_content';
  if (!a.text || complete(a.text) !== 'usable_excerpt') return 'insufficient_content';
  return null;
}
