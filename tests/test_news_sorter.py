import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from selenium.common.exceptions import WebDriverException

import news_sorter


class FetchNewsValuesTests(unittest.TestCase):
    @patch("news_sorter.time.sleep")
    def test_page_failure_does_not_abort_the_batch(self, sleep):
        driver = Mock()
        driver.get.side_effect = WebDriverException("page load failed")

        values = news_sorter.fetch_news_values(
            [("普通科技新闻", "https://example.com/news")], driver
        )

        self.assertEqual(values["https://example.com/news"], "-100")
        self.assertEqual(driver.get.call_count, news_sorter.MAX_RETRIES)

    def test_filtered_news_is_ranked_at_the_bottom(self):
        values = news_sorter.fetch_news_values(
            [("限时好价 99 元", "https://example.com/deal")], Mock()
        )

        self.assertEqual(values["https://example.com/deal"], "-1000")


if __name__ == "__main__":
    unittest.main()
