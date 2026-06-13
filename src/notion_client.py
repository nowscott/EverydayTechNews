import requests


NOTION_API_VERSION = "2026-03-11"


def _extract_title(property_value):
    title_items = property_value.get("title", [])
    if not title_items:
        return ""
    title = title_items[0]
    return title.get("plain_text") or title.get("text", {}).get("content", "")


def _extract_status(properties):
    property_name = "状态" if "状态" in properties else "Status"
    status_property = properties.get(property_name, {})
    property_type = "status" if "status" in status_property else "select"
    option = status_property.get("status") or status_property.get("select") or {}
    return option.get("name", "").strip(), property_name, property_type


def _get_data_source_id(api_key, database_id):
    response = requests.get(
        f"https://api.notion.com/v1/databases/{database_id}",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Notion-Version": NOTION_API_VERSION,
        },
        timeout=30,
    )
    if response.status_code != 200:
        raise RuntimeError(
            f"Notion 数据库请求失败，HTTP 状态码：{response.status_code}"
        )

    data_sources = response.json().get("data_sources", [])
    if not data_sources:
        raise RuntimeError("Notion 数据库中未找到可查询的数据源")
    if len(data_sources) > 1:
        raise RuntimeError(
            "Notion 数据库包含多个数据源，当前无法确定订阅者所在的数据源"
        )
    return data_sources[0]["id"]


def fetch_notion_users(api_key, database_id):
    data_source_id = _get_data_source_id(api_key, database_id)
    url = f"https://api.notion.com/v1/data_sources/{data_source_id}/query"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Notion-Version": NOTION_API_VERSION,
        "Content-Type": "application/json",
    }
    users = []
    seen_emails = set()
    start_cursor = None

    while True:
        payload = {"page_size": 100}
        if start_cursor:
            payload["start_cursor"] = start_cursor

        response = requests.post(url, headers=headers, json=payload, timeout=30)
        if response.status_code != 200:
            raise RuntimeError(
                f"Notion API 请求失败，HTTP 状态码：{response.status_code}"
            )

        data = response.json()
        for result in data.get("results", []):
            properties = result.get("properties", {})
            status, status_property_name, status_property_type = _extract_status(
                properties
            )
            if status != "正常":
                continue

            name = _extract_title(properties.get("Name", {})).strip() or "订阅者"
            email = properties.get("Email", {}).get("email")
            if not email:
                continue

            normalized_email = email.strip().lower()
            if normalized_email and normalized_email not in seen_emails:
                seen_emails.add(normalized_email)
                users.append({
                    "name": name,
                    "email": email.strip(),
                    "notion_page_id": result.get("id"),
                    "status_property_name": status_property_name,
                    "status_property_type": status_property_type,
                })

        if not data.get("has_more"):
            break
        start_cursor = data.get("next_cursor")
        if not start_cursor:
            raise RuntimeError("Notion API 返回了不完整的分页信息")

    if not users:
        raise RuntimeError("Notion 数据源中没有有效的订阅邮箱")
    return users


def update_notion_user_status(api_key, user, status):
    page_id = user.get("notion_page_id")
    if not page_id:
        raise RuntimeError("订阅者记录缺少 Notion 页面 ID")

    property_name = user["status_property_name"]
    property_type = user["status_property_type"]
    response = requests.patch(
        f"https://api.notion.com/v1/pages/{page_id}",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Notion-Version": NOTION_API_VERSION,
            "Content-Type": "application/json",
        },
        json={
            "properties": {
                property_name: {
                    property_type: {"name": status}
                }
            }
        },
        timeout=30,
    )
    if response.status_code != 200:
        raise RuntimeError(
            f"更新 Notion 用户状态失败，HTTP 状态码：{response.status_code}"
        )
