import type {
  Subscriber,
  SubscriberRecord,
  SubscriberRepository,
} from "./types.js";

const NOTION_API_VERSION = "2026-03-11";
const NOTION_API_URL = "https://api.notion.com/v1";

type StatusProperty = {
  name: "状态" | "Status";
  type: "select" | "status";
};

interface DataSourceConfig {
  id: string;
  statusProperty: StatusProperty;
}

interface NotionEnvironment {
  NOTION_API_KEY?: string;
  NOTION_DATABASE_ID?: string;
  NOTION_DATA_SOURCE_ID?: string;
}

function required(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`缺少环境变量 ${name}`);
  return normalized;
}

async function notionRequest<T>(
  path: string,
  apiKey: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${NOTION_API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Notion-Version": NOTION_API_VERSION,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Notion API 请求失败，HTTP 状态码：${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function buildSubscriberProperties(
  subscriber: Subscriber,
  statusProperty: StatusProperty,
  status = "待确认",
) {
  return {
    Name: {
      title: [{ text: { content: subscriber.name } }],
    },
    Email: {
      email: subscriber.email,
    },
    [statusProperty.name]: {
      [statusProperty.type]: { name: status },
    },
  };
}

export function buildStatusProperty(
  statusProperty: StatusProperty,
  status: string,
) {
  return {
    [statusProperty.name]: {
      [statusProperty.type]: { name: status },
    },
  };
}

export function createNotionSubscriberRepository(
  environment: NotionEnvironment = process.env,
): SubscriberRepository {
  const apiKey = required(environment.NOTION_API_KEY, "NOTION_API_KEY");
  let configPromise: Promise<DataSourceConfig> | undefined;

  async function resolveDataSource(): Promise<DataSourceConfig> {
    if (configPromise) return configPromise;

    configPromise = (async () => {
      let dataSourceId = environment.NOTION_DATA_SOURCE_ID?.trim();
      if (!dataSourceId) {
        const databaseId = required(
          environment.NOTION_DATABASE_ID,
          "NOTION_DATABASE_ID",
        );
        const database = await notionRequest<{
          data_sources?: Array<{ id: string }>;
        }>(`/databases/${databaseId}`, apiKey);
        const dataSources = database.data_sources || [];
        if (dataSources.length !== 1) {
          throw new Error(
            `Notion 数据库应包含一个数据源，当前检测到 ${dataSources.length} 个`,
          );
        }
        dataSourceId = dataSources[0].id;
      }

      const dataSource = await notionRequest<{
        properties?: Record<string, { type?: string }>;
      }>(`/data_sources/${dataSourceId}`, apiKey);
      const properties = dataSource.properties || {};
      const statusName = "状态" in properties ? "状态" : "Status";
      const statusType = properties[statusName]?.type;
      if (statusType !== "select" && statusType !== "status") {
        throw new Error("Notion 数据源缺少“状态”选择或状态字段");
      }

      return {
        id: dataSourceId,
        statusProperty: {
          name: statusName,
          type: statusType,
        },
      };
    })();

    return configPromise;
  }

  return {
    async find(email) {
      const config = await resolveDataSource();
      const result = await notionRequest<{
        results?: Array<{
          id: string;
          properties?: Record<string, unknown>;
        }>;
      }>(
        `/data_sources/${config.id}/query`,
        apiKey,
        {
          method: "POST",
          body: JSON.stringify({
            page_size: 1,
            filter: {
              property: "Email",
              email: { equals: email },
            },
          }),
        },
      );
      const page = result.results?.[0];
      if (!page) return null;

      const properties = page.properties || {};
      const nameProperty = properties.Name as
        | { title?: Array<{ plain_text?: string; text?: { content?: string } }> }
        | undefined;
      const emailProperty = properties.Email as { email?: string } | undefined;
      const statusValue = properties[config.statusProperty.name] as
        | {
            select?: { name?: string } | null;
            status?: { name?: string } | null;
          }
        | undefined;

      const record: SubscriberRecord = {
        id: page.id,
        name:
          nameProperty?.title?.[0]?.plain_text ||
          nameProperty?.title?.[0]?.text?.content ||
          email,
        email: emailProperty?.email || email,
        status:
          statusValue?.[config.statusProperty.type]?.name || null,
      };
      return record;
    },

    async createPending(subscriber) {
      const config = await resolveDataSource();
      await notionRequest("/pages", apiKey, {
        method: "POST",
        body: JSON.stringify({
          parent: {
            type: "data_source_id",
            data_source_id: config.id,
          },
          properties: buildSubscriberProperties(
            subscriber,
            config.statusProperty,
            "待确认",
          ),
        }),
      });
    },

    async activate(id) {
      const config = await resolveDataSource();
      await notionRequest(`/pages/${id}`, apiKey, {
        method: "PATCH",
        body: JSON.stringify({
          properties: buildStatusProperty(config.statusProperty, "正常"),
        }),
      });
    },
  };
}
