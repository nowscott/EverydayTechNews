import { RECIPIENT, type Row } from './core.ts';
import { notionRequest, dataSource } from '../../news-common/src/notion.ts';
export { notionRequest, dataSource } from '../../news-common/src/notion.ts';
export async function premiumSubscribers(env: Row = process.env, fetcher: typeof fetch = fetch, internalTest = false): Promise<string[]> {
  const id = await dataSource(env, fetcher);
  const schema = await notionRequest('/data_sources/' + id, env, fetcher);
  if (schema.properties?.['高级订阅']?.type !== 'checkbox') throw new Error('premium_checkbox_missing');
  if (internalTest && schema.properties?.['高级内测']?.type !== 'checkbox') throw new Error('premium_test_checkbox_missing');
  const emails = new Set<string>(); const cursors = new Set<string>(); let cursor: string | undefined;
  do {
    const page = await notionRequest('/data_sources/' + id + '/query', env, fetcher, { method: 'POST',
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }) });
    if (!Array.isArray(page.results) || typeof page.has_more !== 'boolean') throw new Error('notion_invalid_page');
    for (const record of page.results) {
      const props = record.properties ?? {}; const status = props['状态'] ?? props.Status;
      if (!record.archived && !record.in_trash && (!props.Email || !status || !props['高级订阅'] || (internalTest && !props['高级内测']))) throw new Error('notion_invalid_subscriber_record');
      const email = String(props.Email?.email ?? '').trim().toLowerCase();
      if (!record.archived && !record.in_trash && (status?.status?.name ?? status?.select?.name) === '正常'
        && props['高级订阅']?.checkbox === true && (!internalTest || props['高级内测']?.checkbox === true) && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email)) emails.add(email);
    }
    if (!page.has_more) break;
    cursor = page.next_cursor;
    if (!cursor || cursors.has(cursor)) throw new Error('notion_pagination_invalid');
    cursors.add(cursor);
  } while (true);
  return [...emails];
}
export async function authorizedTestRecipient(env: Row = process.env, fetcher: typeof fetch = fetch): Promise<boolean> {
  return (await premiumSubscribers(env, fetcher)).includes(RECIPIENT);
}

export async function internalTestSubscribers(env: Row = process.env, fetcher: typeof fetch = fetch): Promise<string[]> {
  return premiumSubscribers(env, fetcher, true);
}

export async function resolveTestSubscribers(root: string, deadline: Date, fallback = true) {
  const { resolveAudience } = await import('../../news-common/src/subscriber-backup.ts');
  return resolveAudience<string>({ root, kind: 'premium-internal-test', deadline, fallback, get: () => internalTestSubscribers({...process.env, NOTION_REQUEST_DEADLINE: deadline.getTime()}),
    valid: (value: unknown): value is string => typeof value === 'string' && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value) });
}
