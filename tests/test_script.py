import os
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import script


class SaveNewsTests(unittest.TestCase):
    def test_does_not_append_to_sorted_daily_archive(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            old_cwd = os.getcwd()
            os.chdir(temp_dir)
            try:
                archive = Path("news_archive/2026-06")
                archive.mkdir(parents=True)
                daily_file = archive / "12.md"
                daily_file.write_text(
                    "# 今日新闻 - 2026年06月12日(sorted)\n"
                    "- [已有新闻](https://example.com/old)\n",
                    encoding="utf-8",
                )

                script.save_news_to_markdown(
                    datetime(2026, 6, 13, 8, 0),
                    [
                        {
                            "title": "迟到新闻",
                            "link": "https://example.com/late",
                            "time": datetime(2026, 6, 12, 23, 59),
                        }
                    ],
                )

                self.assertNotIn(
                    "迟到新闻", daily_file.read_text(encoding="utf-8")
                )
                self.assertIn(
                    "迟到新闻",
                    (archive / "00.md").read_text(encoding="utf-8"),
                )
            finally:
                os.chdir(old_cwd)

    def test_deduplicates_by_url(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            old_cwd = os.getcwd()
            os.chdir(temp_dir)
            try:
                news_time = datetime(2026, 6, 13, 8, 0)
                script.save_news_to_markdown(
                    news_time,
                    [
                        {
                            "title": "原标题",
                            "link": "https://example.com/same",
                            "time": news_time,
                        },
                        {
                            "title": "修改后的标题",
                            "link": "https://example.com/same",
                            "time": news_time,
                        },
                    ],
                )

                daily = Path("news_archive/2026-06/13.md").read_text(
                    encoding="utf-8"
                )
                self.assertEqual(daily.count("https://example.com/same"), 1)
            finally:
                os.chdir(old_cwd)


class FetchAllNewsTests(unittest.TestCase):
    def test_parses_news_from_html(self):
        html = """
        <ul class="datel">
          <li>
            <a class="c">软件之家</a>
            <a class="t" href="https://example.com/news">测试新闻标题</a>
            <i>2026-06-13 12:30:00</i>
          </li>
        </ul>
        """

        news = script.parse_news_html(html)

        self.assertEqual(
            news,
            [{
                "category": "软件之家",
                "title": "测试新闻标题",
                "link": "https://example.com/news",
                "time": datetime(2026, 6, 13, 12, 30),
            }],
        )

    def test_parses_news_from_rss(self):
        xml = """
        <rss version="2.0">
          <channel>
            <item>
              <title>RSS 测试新闻标题</title>
              <link>https://example.com/rss-news</link>
              <pubDate>Thu, 18 Jun 2026 02:46:16 GMT</pubDate>
            </item>
          </channel>
        </rss>
        """

        news = script.parse_rss_news(xml)

        self.assertEqual(
            news,
            [{
                "category": "IT之家",
                "title": "RSS 测试新闻标题",
                "link": "https://example.com/rss-news",
                "time": datetime(2026, 6, 18, 10, 46, 16),
            }],
        )

    @patch("script.time.sleep")
    @patch("script.requests.get")
    def test_list_fetch_retries_timeout_then_succeeds(self, get, sleep):
        html = """
        <ul class="datel">
          <li>
            <a class="c">软件之家</a>
            <a class="t" href="https://example.com/news">测试新闻标题</a>
            <i>2026-06-13 12:30:00</i>
          </li>
        </ul>
        """
        response = Mock(text=html, status_code=200)
        response.raise_for_status.return_value = None
        get.side_effect = [script.requests.ConnectTimeout("timeout"), response]

        news = script.fetch_news()

        self.assertEqual(len(news), 1)
        self.assertEqual(get.call_count, 2)
        sleep.assert_called_once_with(2)

    @patch("script.time.sleep")
    @patch("script.requests.get")
    def test_falls_back_to_rss_after_list_timeouts(self, get, sleep):
        rss = """
        <rss version="2.0">
          <channel>
            <item>
              <title>RSS 兜底新闻</title>
              <link>https://example.com/rss-fallback</link>
              <pubDate>Thu, 18 Jun 2026 02:46:16 GMT</pubDate>
            </item>
          </channel>
        </rss>
        """
        rss_response = Mock(text=rss, status_code=200)
        rss_response.raise_for_status.return_value = None
        get.side_effect = [
            script.requests.ConnectTimeout("timeout 1"),
            script.requests.ConnectTimeout("timeout 2"),
            script.requests.ConnectTimeout("timeout 3"),
            rss_response,
        ]

        news = script.fetch_all_news()

        self.assertEqual(news[0]["title"], "RSS 兜底新闻")
        self.assertEqual(get.call_count, 4)
        self.assertEqual(sleep.call_count, 2)

    @patch("script.requests.get")
    def test_http_failure_is_raised(self, get):
        response = Mock()
        response.raise_for_status.side_effect = RuntimeError("request failed")
        get.return_value = response

        with self.assertRaisesRegex(RuntimeError, "request failed"):
            script.fetch_all_news()

    @patch("script.requests.get")
    def test_empty_parse_result_is_rejected(self, get):
        response = Mock(text="<html></html>")
        response.raise_for_status.return_value = None
        get.return_value = response

        with self.assertRaisesRegex(RuntimeError, "解析结果为空"):
            script.fetch_all_news()


if __name__ == "__main__":
    unittest.main()
