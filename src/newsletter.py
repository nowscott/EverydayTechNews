import re
from html import escape

from news_filter import filter_news_list, should_filter_news


def is_news_sorted(news_string):
    return "(sorted)" in news_string


def simple_filter_news(matches):
    news_list = [(title, url) for title, url in matches]
    filtered_news = filter_news_list(news_list)
    quality_filtered = [
        (title, url) for title, url in filtered_news if len(title) >= 10
    ]

    if len(quality_filtered) < 25:
        for title, url in news_list:
            if (title, url) in quality_filtered:
                continue
            if not should_filter_news(title):
                quality_filtered.append((title, url))
            if len(quality_filtered) == 25:
                break

    return quality_filtered[:25]


def format_news(news_string):
    matches = re.findall(r"\[(.*?)\]\((.*?)\)", news_string)
    if is_news_sorted(news_string):
        matches = matches[:25]
    else:
        matches = simple_filter_news(matches)

    return "".join(
        '<p><a href="{}">{}</a></p>'.format(
            escape(link, quote=True),
            escape(title),
        )
        for title, link in matches
    )


def build_message(
    name,
    formatted_news,
    start_notification="",
    end_notification="",
    end_comment="",
):
    greeting = f"早上好{escape(name)}，以下是今日的科技早报"
    return f"""
    <h2>{greeting}</h2>
    <p>{start_notification}</p>
    <div>{formatted_news}</div>
    <p>{end_notification}</p>
    <p>{end_comment}</p>
    """
