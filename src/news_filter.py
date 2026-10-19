"""新闻过滤工具模块"""

import re
import json
from pathlib import Path


_RULES = json.loads((Path(__file__).resolve().parents[1] / "config/news-filter.json").read_text(encoding="utf-8"))
FILTER_KEYWORDS = tuple(_RULES["keywords"])
CURRENCY_PATTERNS = tuple(_RULES["currency_patterns"])


def should_filter_news(title):
    """判断新闻是否应该被过滤掉

    Args:
        title (str): 新闻标题

    Returns:
        bool: True表示应该过滤掉，False表示保留
    """
    # 检查是否包含过滤关键词
    normalized_title = title.casefold()
    has_filter_keyword = any(
        keyword.casefold() in normalized_title for keyword in FILTER_KEYWORDS
    )

    # 使用正则表达式更精确地匹配金额表达
    # 匹配数字+货币单位的模式，但排除大额数字（亿及以上）和文件大小单位
    currency_patterns = CURRENCY_PATTERNS

    # 检查是否包含真正的金额表达
    has_currency = any(re.search(pattern, title) for pattern in currency_patterns)

    return has_filter_keyword or has_currency

def filter_news_list(news_list, max_count=None):
    """过滤新闻列表

    Args:
        news_list (list): 新闻列表，每个元素为(title, url)元组
        max_count (int, optional): 最大返回数量

    Returns:
        list: 过滤后的新闻列表
    """
    filtered_news = []

    for title, url in news_list:
        if not should_filter_news(title):
            filtered_news.append((title, url))

    if max_count is not None:
        return filtered_news[:max_count]

    return filtered_news
