import configparser
import os
import sys
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

from mailer import (
    SEND_PERMANENT_FAILURE,
    SEND_SUCCESS,
    SEND_TEMPORARY_FAILURE,
    SMTPMailer,
    send_message,
)
from newsletter import build_message, format_news, is_news_sorted, simple_filter_news
from notion_client import fetch_notion_users, update_notion_user_status
from subscription_links import build_unsubscribe_link


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


def build_delivery_message_id_seed(formatted_news, delivery_date=""):
    if delivery_date:
        return f"{delivery_date}\n{formatted_news}"
    return formatted_news


def send_newsletter_to_users(
    users,
    formatted_news,
    api_key,
    sender,
    password,
    server,
    notifications,
    app_base_url="",
    confirmation_secret="",
    delivery_date="",
):
    failed_users = []
    total_users = len(users)
    started_at = time.monotonic()
    status_updates = 0
    status_update_failures = 0
    message_id_seed = build_delivery_message_id_seed(
        formatted_news,
        delivery_date,
    )

    with SMTPMailer(sender, password, server) as mailer:
        for index, user in enumerate(users, start=1):
            unsubscribe_url = ""
            if app_base_url and confirmation_secret:
                unsubscribe_url = build_unsubscribe_link(
                    user["email"],
                    app_base_url,
                    confirmation_secret,
                )
            personalized_message = build_message(
                user["name"],
                formatted_news,
                **notifications,
                unsubscribe_url=unsubscribe_url,
                delivery_date=delivery_date,
            )
            result = mailer.send_message(
                user["email"],
                personalized_message,
                f"今日科技早报｜{delivery_date}" if delivery_date else "今日科技早报",
                message_id_seed=message_id_seed,
            )
            if result != SEND_SUCCESS:
                failed_users.append(user["email"])
                failure_type = (
                    "永久退信"
                    if result == SEND_PERMANENT_FAILURE
                    else "临时故障"
                )
                print(f"发送失败：收件人序号 {index}，类型 {failure_type}")

                if result == SEND_PERMANENT_FAILURE and user.get("notion_page_id"):
                    try:
                        update_notion_user_status(api_key, user, "异常")
                        status_updates += 1
                    except Exception as error:
                        status_update_failures += 1
                        print(f"订阅状态更新失败：{error}")

            if index % 25 == 0 and index < total_users:
                print(f"发送进度：{index}/{total_users}")

        connection_count = mailer.connection_count

    elapsed = time.monotonic() - started_at
    print(
        f"SMTP 发送阶段完成：耗时 {elapsed:.2f} 秒，"
        f"连接 {connection_count} 次"
    )
    if status_updates or status_update_failures:
        print(
            f"永久退信状态处理：更新 {status_updates} 条，"
            f"失败 {status_update_failures} 条"
        )
    return failed_users


def main():
    started_at = time.monotonic()
    switch_to_parent_if_src()
    load_dotenv()
    test_recipient = os.environ.get("TEST_RECIPIENT", "").strip()

    now = datetime.now(ZoneInfo("Asia/Shanghai"))
    delivery_date = now.strftime("%Y年%m月%d日")
    news_filename = get_yesterday_news_filename(now)
    if not os.path.exists(news_filename):
        raise FileNotFoundError(f"{news_filename} 不存在，无法发送邮件")

    with open(news_filename, "r", encoding="utf-8") as news_file:
        formatted_news = format_news(news_file.read())
    if not formatted_news:
        raise RuntimeError(f"{news_filename} 中没有可发送的新闻条目")
    print(f"新闻准备完成：{news_filename}")

    try:
        sender = get_env_variable("SENDING_ACCOUNT")
        password = get_env_variable("SENDING_PASSWORD")
        server = get_env_variable("SERVER")
        app_base_url = get_env_variable("APP_BASE_URL")
        confirmation_secret = get_env_variable(
            "SUBSCRIPTION_CONFIRMATION_SECRET"
        )
        if test_recipient:
            api_key = ""
            users = [{"name": "NowScott", "email": test_recipient}]
            print("测试模式：仅发送到指定测试收件人")
        else:
            api_key = get_env_variable("NOTION_API_KEY")
            database_id = get_env_variable("NOTION_DATABASE_ID")
            users = fetch_notion_users(api_key, database_id)
    except Exception as error:
        print(f"推送消息失败: {error}")
        sys.exit(1)

    preparation_elapsed = time.monotonic() - started_at
    print(
        f"收件人准备完成：共 {len(users)} 人，"
        f"耗时 {preparation_elapsed:.2f} 秒"
    )
    failed_users = send_newsletter_to_users(
        users,
        formatted_news,
        api_key,
        sender,
        password,
        server,
        load_notifications(),
        app_base_url,
        confirmation_secret,
        delivery_date,
    )
    success_count = len(users) - len(failed_users)
    total_elapsed = time.monotonic() - started_at
    print(
        f"邮件任务完成：成功 {success_count} 封，"
        f"失败 {len(failed_users)} 封，总耗时 {total_elapsed:.2f} 秒"
    )
    if failed_users:
        sys.exit(1)


if __name__ == "__main__":
    main()
