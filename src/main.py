import configparser
import os
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

from mailer import (
    SEND_PERMANENT_FAILURE,
    SEND_SUCCESS,
    SEND_TEMPORARY_FAILURE,
    send_message,
)
from newsletter import build_message, format_news, is_news_sorted, simple_filter_news
from notion_client import fetch_notion_users, update_notion_user_status


def get_env_variable(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise ValueError(f"环境变量 {name} 未设置")
    return value


def switch_to_parent_if_src():
    current_dir = os.getcwd()
    if os.path.basename(current_dir) == "src":
        os.chdir(os.path.dirname(current_dir))


def load_notifications(filename="notifications.ini"):
    config = configparser.ConfigParser()
    config.read(filename, encoding="utf-8")
    return {
        "start_notification": config.get("开头通知", "content", fallback=""),
        "end_notification": config.get("结尾通知", "content", fallback=""),
        "end_comment": config.get("结尾注释", "content", fallback=""),
    }


def get_yesterday_news_filename(now):
    yesterday = now - timedelta(days=1)
    return (
        f"news_archive/{yesterday.strftime('%Y-%m')}/"
        f"{yesterday.strftime('%d')}.md"
    )


def message(name, formatted_news):
    return build_message(
        name,
        formatted_news,
        globals().get("start_notification", ""),
        globals().get("end_notification", ""),
        globals().get("end_comment", ""),
    )


def send_newsletter_to_users(
    users,
    formatted_news,
    api_key,
    sender,
    password,
    server,
    notifications,
):
    failed_users = []
    for user in users:
        personalized_message = build_message(
            user["name"],
            formatted_news,
            **notifications,
        )
        result = send_message(
            sender,
            password,
            server,
            user["email"],
            personalized_message,
        )
        if result == SEND_SUCCESS:
            continue

        failed_users.append(user["email"])
        if result == SEND_PERMANENT_FAILURE:
            try:
                update_notion_user_status(api_key, user, "异常")
                print(f"已将 {user['email']} 的 Notion 状态更新为异常")
            except Exception as error:
                print(f"无法更新 {user['email']} 的 Notion 状态: {error}")
    return failed_users


def main():
    switch_to_parent_if_src()
    load_dotenv()

    now = datetime.now(ZoneInfo("Asia/Shanghai"))
    news_filename = get_yesterday_news_filename(now)
    if not os.path.exists(news_filename):
        print(f"{news_filename} 不存在，跳过发送邮件")
        return

    with open(news_filename, "r", encoding="utf-8") as news_file:
        formatted_news = format_news(news_file.read())
    if not formatted_news:
        print("没有新闻条目，结束程序运行")
        return

    try:
        api_key = get_env_variable("NOTION_API_KEY")
        database_id = get_env_variable("NOTION_DATABASE_ID")
        sender = get_env_variable("SENDING_ACCOUNT")
        password = get_env_variable("SENDING_PASSWORD")
        server = get_env_variable("SERVER")
        users = fetch_notion_users(api_key, database_id)
    except Exception as error:
        print(f"推送消息失败: {error}")
        sys.exit(1)

    failed_users = send_newsletter_to_users(
        users,
        formatted_news,
        api_key,
        sender,
        password,
        server,
        load_notifications(),
    )
    if failed_users:
        print(f"共有 {len(failed_users)} 封邮件发送失败")
        sys.exit(1)


if __name__ == "__main__":
    main()
