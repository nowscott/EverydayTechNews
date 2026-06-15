import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from news_filter import should_filter_news


class NewsFilterTests(unittest.TestCase):
    def test_price_is_not_hidden_by_storage_capacity(self):
        self.assertTrue(should_filter_news("某手机 3999 元起，配备 16GB 内存"))

    def test_storage_capacity_without_price_is_kept(self):
        self.assertFalse(should_filter_news("新款电脑配备 16GB 内存"))

    def test_normal_business_cooperation_is_kept(self):
        self.assertFalse(should_filter_news("两家公司合作研发新芯片"))

    def test_promotional_language_is_filtered(self):
        self.assertTrue(should_filter_news("限时好价，智能手表 99 元发车"))

    def test_configured_topic_keywords_are_filtered(self):
        for keyword in ("IT早报", "华为", "鸿蒙", "昆仑"):
            with self.subTest(keyword=keyword):
                self.assertTrue(should_filter_news(f"{keyword}相关科技新闻"))


if __name__ == "__main__":
    unittest.main()
