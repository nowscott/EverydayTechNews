type Row = Record<string, any>;
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
