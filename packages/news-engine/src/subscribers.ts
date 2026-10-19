import { RECIPIENT, type Row } from './core.ts';
const API = 'https://api.notion.com/v1';
export async function notionRequest(path: string, env: Row = process.env, fetcher: typeof fetch = fetch, init: RequestInit = {}): Promise<Row> {
  if (!env.NOTION_API_KEY) throw new Error('notion_configuration_missing');
  let response: Response;
  try { response = await fetcher(API + path, { ...init, signal: AbortSignal.timeout(30000), headers: {
    Authorization: `Bearer ${env.NOTION_API_KEY}`, 'Notion-Version': '2026-03-11', 'Content-Type': 'application/json' } }); } catch { throw new Error('notion_network_failure'); }
  if (!response.ok) throw new Error('notion_http_' + response.status);
  try { return await response.json() as Row; } catch { throw new Error('notion_invalid_response'); }
}
export async function dataSource(env: Row = process.env, fetcher: typeof fetch = fetch): Promise<string> {
  if (env.NOTION_DATA_SOURCE_ID) return env.NOTION_DATA_SOURCE_ID;
  if (!env.NOTION_DATABASE_ID) throw new Error('notion_database_missing');
  const db = await notionRequest('/databases/' + env.NOTION_DATABASE_ID, env, fetcher);
  if (db.data_sources?.length !== 1) throw new Error('notion_data_source_ambiguous');
  return db.data_sources[0].id;
}
export async function premiumSubscribers(env: Row = process.env, fetcher: typeof fetch = fetch): Promise<string[]> {
  const id = await dataSource(env, fetcher);
  const schema = await notionRequest('/data_sources/' + id, env, fetcher);
  if (schema.properties?.['高级订阅']?.type !== 'checkbox') throw new Error('premium_checkbox_missing');
  const emails = new Set<string>(); const cursors = new Set<string>(); let cursor: string | undefined;
  do {
    const page = await notionRequest('/data_sources/' + id + '/query', env, fetcher, { method: 'POST',
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }) });
    if (!Array.isArray(page.results)) throw new Error('notion_invalid_page');
    for (const record of page.results) {
      const props = record.properties ?? {}; const status = props['状态'] ?? props.Status;
      const email = String(props.Email?.email ?? '').trim().toLowerCase();
      if (!record.archived && !record.in_trash && (status?.status?.name ?? status?.select?.name) === '正常'
        && props['高级订阅']?.checkbox === true && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email)) emails.add(email);
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
