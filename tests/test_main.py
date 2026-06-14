import os
import smtplib
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import Mock, patch
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import main


class FetchNotionUsersTests(unittest.TestCase):
    @patch("notion_client.requests.get")
    @patch("notion_client.requests.post")
    def test_paginates_and_handles_empty_names(self, post, get):
        database_response = Mock(status_code=200)
        database_response.json.return_value = {
            "data_sources": [{"id": "data-source-id", "name": "Subscribers"}]
        }
        get.return_value = database_response
        first_response = Mock(status_code=200)
        first_response.json.return_value = {
            "results": [
                {
                    "id": "first-page-id",
                    "properties": {
                        "Name": {"title": []},
                        "Email": {"email": "First@Example.com"},
                        "状态": {"select": {"name": "正常"}},
                    }
                }
            ],
            "has_more": True,
            "next_cursor": "next-page",
        }
        second_response = Mock(status_code=200)
        second_response.json.return_value = {
            "results": [
                {
                    "id": "alice-page-id",
                    "properties": {
                        "Name": {
                            "title": [
                                {
                                    "plain_text": "Alice",
                                    "text": {"content": "Alice"},
                                }
                            ]
                        },
                        "Email": {"email": "alice@example.com"},
                        "状态": {"status": {"name": "正常"}},
                    }
                },
                {
                    "id": "duplicate-page-id",
                    "properties": {
                        "Name": {"title": [{"plain_text": "Duplicate"}]},
                        "Email": {"email": "first@example.com"},
                        "状态": {"select": {"name": "正常"}},
                    }
                },
                {
                    "id": "disabled-page-id",
                    "properties": {
                        "Name": {"title": [{"plain_text": "Disabled"}]},
                        "Email": {"email": "disabled@example.com"},
                        "状态": {"select": {"name": "异常"}},
                    }
                },
            ],
            "has_more": False,
            "next_cursor": None,
        }
        post.side_effect = [first_response, second_response]

        users = main.fetch_notion_users("api-key", "database-id")

        self.assertEqual(
            users,
            [
                {
                    "name": "订阅者",
                    "email": "First@Example.com",
                    "notion_page_id": "first-page-id",
                    "status_property_name": "状态",
                    "status_property_type": "select",
                },
                {
                    "name": "Alice",
                    "email": "alice@example.com",
                    "notion_page_id": "alice-page-id",
                    "status_property_name": "状态",
                    "status_property_type": "status",
                },
            ],
        )
        self.assertEqual(post.call_count, 2)
        self.assertIn("/data_sources/data-source-id/query", post.call_args_list[0].args[0])
        self.assertEqual(
            post.call_args_list[1].kwargs["json"]["start_cursor"], "next-page"
        )

    @patch("notion_client.requests.get")
    @patch("notion_client.requests.post")
    def test_does_not_expose_notion_error_body(self, post, get):
        database_response = Mock(status_code=200)
        database_response.json.return_value = {
            "data_sources": [{"id": "data-source-id"}]
        }
        get.return_value = database_response
        post.return_value = Mock(status_code=401, text="secret response")

        with self.assertRaisesRegex(RuntimeError, "HTTP 状态码：401") as context:
            main.fetch_notion_users("api-key", "database-id")

        self.assertNotIn("secret response", str(context.exception))

    @patch("notion_client.requests.get")
    def test_rejects_ambiguous_multi_source_database(self, get):
        response = Mock(status_code=200)
        response.json.return_value = {
            "data_sources": [{"id": "one"}, {"id": "two"}]
        }
        get.return_value = response

        with self.assertRaisesRegex(RuntimeError, "包含多个数据源"):
            main.fetch_notion_users("api-key", "database-id")

    @patch("notion_client.requests.get")
    @patch("notion_client.requests.post")
    def test_rejects_empty_subscriber_list(self, post, get):
        database_response = Mock(status_code=200)
        database_response.json.return_value = {
            "data_sources": [{"id": "data-source-id"}]
        }
        get.return_value = database_response
        query_response = Mock(status_code=200)
        query_response.json.return_value = {
            "results": [],
            "has_more": False,
            "next_cursor": None,
        }
        post.return_value = query_response

        with self.assertRaisesRegex(RuntimeError, "没有有效的订阅邮箱"):
            main.fetch_notion_users("api-key", "database-id")


class EnvironmentTests(unittest.TestCase):
    def test_empty_environment_variable_is_rejected(self):
        with patch.dict(os.environ, {"SENDING_ACCOUNT": ""}, clear=False):
            with self.assertRaises(ValueError):
                main.get_env_variable("SENDING_ACCOUNT")


class MainWorkflowTests(unittest.TestCase):
    @patch("main.datetime")
    def test_missing_news_file_fails(self, mocked_datetime):
        now = datetime(2026, 6, 14, 7, 23, tzinfo=ZoneInfo("Asia/Shanghai"))
        mocked_datetime.now.return_value = now

        with tempfile.TemporaryDirectory() as temp_dir:
            old_cwd = os.getcwd()
            os.chdir(temp_dir)
            try:
                with self.assertRaisesRegex(
                    FileNotFoundError,
                    "news_archive/2026-06/13.md 不存在",
                ):
                    main.main()
            finally:
                os.chdir(old_cwd)

    @patch("main.datetime")
    def test_empty_news_file_fails(self, mocked_datetime):
        now = datetime(2026, 6, 14, 7, 23, tzinfo=ZoneInfo("Asia/Shanghai"))
        mocked_datetime.now.return_value = now

        with tempfile.TemporaryDirectory() as temp_dir:
            old_cwd = os.getcwd()
            os.chdir(temp_dir)
            try:
                archive = Path("news_archive/2026-06")
                archive.mkdir(parents=True)
                (archive / "13.md").write_text(
                    "# 今日新闻 - 2026年06月13日\n",
                    encoding="utf-8",
                )

                with self.assertRaisesRegex(
                    RuntimeError,
                    "没有可发送的新闻条目",
                ):
                    main.main()
            finally:
                os.chdir(old_cwd)


class NotionStatusUpdateTests(unittest.TestCase):
    @patch("notion_client.requests.patch")
    def test_updates_select_status_to_abnormal(self, patch_request):
        patch_request.return_value = Mock(status_code=200)
        user = {
            "notion_page_id": "page-id",
            "status_property_name": "状态",
            "status_property_type": "select",
        }

        main.update_notion_user_status("api-key", user, "异常")

        self.assertEqual(
            patch_request.call_args.kwargs["json"],
            {"properties": {"状态": {"select": {"name": "异常"}}}},
        )


class SendMessageTests(unittest.TestCase):
    @patch("mailer.time.sleep")
    @patch("mailer.smtplib.SMTP_SSL")
    def test_three_permanent_recipient_rejections_are_classified(self, smtp_ssl, sleep):
        smtp = smtp_ssl.return_value.__enter__.return_value
        smtp.sendmail.side_effect = smtplib.SMTPRecipientsRefused(
            {"bad@example.com": (550, b"mailbox unavailable")}
        )

        result = main.send_message(
            "sender@example.com",
            "password",
            "smtp.example.com",
            "bad@example.com",
            "<p>message</p>",
        )

        self.assertEqual(result, main.SEND_PERMANENT_FAILURE)
        self.assertEqual(smtp.sendmail.call_count, 3)

    @patch("mailer.time.sleep")
    @patch("mailer.smtplib.SMTP_SSL")
    def test_authentication_failure_does_not_disable_recipient(self, smtp_ssl, sleep):
        smtp = smtp_ssl.return_value.__enter__.return_value
        smtp.login.side_effect = smtplib.SMTPAuthenticationError(
            535, b"authentication failed"
        )

        result = main.send_message(
            "sender@example.com",
            "password",
            "smtp.example.com",
            "user@example.com",
            "<p>message</p>",
        )

        self.assertEqual(result, main.SEND_TEMPORARY_FAILURE)


class NewsletterDeliveryTests(unittest.TestCase):
    @patch("main.update_notion_user_status")
    @patch("main.send_message", return_value=main.SEND_PERMANENT_FAILURE)
    def test_permanent_failure_updates_notion_status(
        self,
        send_message,
        update_status,
    ):
        user = {
            "name": "Alice",
            "email": "alice@example.com",
            "notion_page_id": "page-id",
            "status_property_name": "状态",
            "status_property_type": "select",
        }

        failed = main.send_newsletter_to_users(
            [user],
            "<p>news</p>",
            "api-key",
            "sender@example.com",
            "password",
            "smtp.example.com",
            {
                "start_notification": "",
                "end_notification": "",
                "end_comment": "",
            },
        )

        self.assertEqual(failed, ["alice@example.com"])
        update_status.assert_called_once_with("api-key", user, "异常")

    @patch("main.update_notion_user_status")
    @patch("main.send_message", return_value=main.SEND_PERMANENT_FAILURE)
    def test_test_recipient_without_page_id_does_not_update_notion(
        self,
        send_message,
        update_status,
    ):
        failed = main.send_newsletter_to_users(
            [{"name": "NowScott", "email": "test@example.com"}],
            "<p>news</p>",
            "",
            "sender@example.com",
            "password",
            "smtp.example.com",
            {
                "start_notification": "",
                "end_notification": "",
                "end_comment": "",
            },
        )

        self.assertEqual(failed, ["test@example.com"])
        update_status.assert_not_called()

    @patch("main.build_unsubscribe_link", return_value="https://example.com/unsubscribe")
    @patch("main.build_message", return_value="<p>message</p>")
    @patch("main.send_message", return_value=main.SEND_SUCCESS)
    def test_daily_message_contains_personalized_unsubscribe_link(
        self,
        send_message,
        build_message,
        build_unsubscribe_link,
    ):
        user = {"name": "Alice", "email": "alice@example.com"}

        failed = main.send_newsletter_to_users(
            [user],
            "<p>news</p>",
            "",
            "sender@example.com",
            "password",
            "smtp.example.com",
            {
                "start_notification": "",
                "end_notification": "",
                "end_comment": "",
            },
            "https://mailist.example.com",
            "signing-secret",
        )

        self.assertEqual(failed, [])
        build_unsubscribe_link.assert_called_once_with(
            "alice@example.com",
            "https://mailist.example.com",
            "signing-secret",
        )
        self.assertEqual(
            build_message.call_args.kwargs["unsubscribe_url"],
            "https://example.com/unsubscribe",
        )


class FormattingTests(unittest.TestCase):
    def test_escapes_news_html(self):
        content = "- [<b>unsafe</b>](https://example.com/?a=1&b=2)"

        formatted = main.format_news(content)

        self.assertIn("&lt;b&gt;unsafe&lt;/b&gt;", formatted)
        self.assertNotIn("<b>unsafe</b>", formatted)

    def test_daily_message_escapes_content_and_contains_unsubscribe_button(self):
        message = main.build_message(
            "<Scott>",
            "<p>news</p>",
            start_notification="<notice>",
            unsubscribe_url="https://example.com/?a=1&b=2",
        )

        self.assertIn("早上好，&lt;Scott&gt;", message)
        self.assertIn("&lt;notice&gt;", message)
        self.assertIn("退订每日科技早报", message)
        self.assertIn("a=1&amp;b=2", message)


if __name__ == "__main__":
    unittest.main()
