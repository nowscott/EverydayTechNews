type Row = Record<string, any>;
const API = 'https://api.notion.com/v1';
export async function notionRequest(path: string, env: Row = process.env, fetcher: typeof fetch = fetch, init: RequestInit = {}): Promise<Row> {
  if (!env.NOTION_API_KEY) throw new Error('notion_configuration_missing');
  let response: Response;
  const deadline = Number(env.NOTION_REQUEST_DEADLINE ?? Infinity);
  const timeout = Number.isFinite(deadline) ? Math.max(1, Math.min(30000, deadline - Date.now())) : 30000;
  try { response = await fetcher(API + path, { ...init, signal: AbortSignal.timeout(timeout), headers: {
    Authorization: `Bearer ${env.NOTION_API_KEY}`, 'Notion-Version': '2026-03-11', 'Content-Type': 'application/json' } }); } catch { throw new Error('notion_network_failure'); }
  if (!response.ok) {
    const error = new Error('notion_http_' + response.status) as Error & { retryAfterMs?: number };
    if (response.status === 429) {
      const value = response.headers.get('retry-after');
      if (value) { const seconds = Number(value); error.retryAfterMs = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(value) - Date.now()) || 0; }
    }
    throw error;
  }
  try { return await response.json() as Row; } catch { throw new Error('notion_invalid_response'); }
}
export async function dataSource(env: Row = process.env, fetcher: typeof fetch = fetch): Promise<string> {
  if (env.NOTION_DATA_SOURCE_ID) return env.NOTION_DATA_SOURCE_ID;
  if (!env.NOTION_DATABASE_ID) throw new Error('notion_database_missing');
  const db = await notionRequest('/databases/' + env.NOTION_DATABASE_ID, env, fetcher);
  if (db.data_sources?.length !== 1) throw new Error('notion_data_source_ambiguous');
  return db.data_sources[0].id;
}
