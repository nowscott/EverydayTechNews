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
        keywords = (
            "IT早报",
            "华为",
            "鸿蒙",
            "昆仑",
            "HUAWEI",
            "HarmonyOS",
            "OpenHarmony",
            "EMUI",
            "海思",
            "麒麟",
            "Kirin",
            "昇腾",
            "Ascend",
            "鲲鹏",
            "Kunpeng",
            "乾崑",
            "问界",
            "智界",
            "享界",
            "尊界",
            "尚界",
            "星闪",
            "NearLink",
            "HiCar",
            "HMS for Car",
            "HMS Core",
            "AppGallery",
            "HiLink",
            "Pura",
            "MateBook",
            "MatePad",
            "FreeBuds",
            "Watch GT",
            "小艺",
        )
        for keyword in keywords:
            with self.subTest(keyword=keyword):
                self.assertTrue(should_filter_news(f"{keyword}相关科技新闻"))


if __name__ == "__main__":
    unittest.main()
