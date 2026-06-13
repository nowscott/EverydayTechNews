import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests

from news_filter import should_filter_news


MAX_RETRIES = 3
REQUEST_TIMEOUT = 15
MAX_WORKERS = 8
FILTERED_SCORE = -1000
FAILED_SCORE = -100
GRADE_URL = "https://dyn.ithome.com/grade/{news_id}"
REQUEST_HEADERS = {"User-Agent": "Mozilla/5.0"}


def calculate_score(valuable, unvaluable):
    total = valuable + unvaluable
    if total == 0:
        return 0
    if valuable == 0:
        return -10
    if unvaluable == 0:
        return 10 + valuable
    return (valuable / total) * 10


def adjust_value_based_on_title(title):
    if should_filter_news(title):
        return FILTERED_SCORE
    return None


def extract_news_id(url):
    match = re.search(r"/(\d+)/(\d+)\.htm(?:[?#].*)?$", url)
    if not match:
        return None
    return "".join(match.groups())


def parse_grade_response(content):
    valuable_match = re.search(
        r'id=["\']sgrade2["\'].*?<div>(\d+)</div>',
        content,
        re.DOTALL,
    )
    unvaluable_match = re.search(
        r'id=["\']sgrade0["\'].*?<div>(\d+)</div>',
        content,
        re.DOTALL,
    )
    if not valuable_match or not unvaluable_match:
        raise ValueError("评分接口响应中缺少评分数字")
    return int(valuable_match.group(1)), int(unvaluable_match.group(1))


def fetch_news_value(title, url):
    news_id = extract_news_id(url)
    if not news_id:
        print(f"{title} 无法提取新闻 ID，设置为低分")
        return FAILED_SCORE

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = requests.get(
                GRADE_URL.format(news_id=news_id),
                headers=REQUEST_HEADERS,
                timeout=REQUEST_TIMEOUT,
            )
            response.raise_for_status()
            valuable, unvaluable = parse_grade_response(response.text)
            return calculate_score(valuable, unvaluable)
        except (requests.RequestException, ValueError) as error:
            print(f"{title} 第 {attempt} 次评分失败: {type(error).__name__}")
            if attempt < MAX_RETRIES:
                time.sleep(1)

    return FAILED_SCORE


def fetch_news_values(news_list, max_workers=MAX_WORKERS):
    values_dict = {}
    pending_news = {}

    for title, url in news_list:
        if url in values_dict or url in pending_news:
            continue
        adjusted_value = adjust_value_based_on_title(title)
        if adjusted_value is not None:
            values_dict[url] = str(adjusted_value)
        else:
            pending_news[url] = title

    print(
        f"开始评分：共 {len(news_list)} 条，"
        f"过滤 {len(values_dict)} 条，请求 {len(pending_news)} 条"
    )
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_url = {
            executor.submit(fetch_news_value, title, url): url
            for url, title in pending_news.items()
        }
        for future in as_completed(future_to_url):
            url = future_to_url[future]
            try:
                values_dict[url] = str(future.result())
            except Exception as error:
                print(f"{pending_news[url]} 评分任务异常: {type(error).__name__}")
                values_dict[url] = str(FAILED_SCORE)

    print(f"成功处理 {len(values_dict)} 条新闻评分")
    return values_dict


def sort_news_by_value(news_list, values_dict):
    return sorted(
        news_list,
        key=lambda news: float(values_dict.get(news[1], FAILED_SCORE)),
        reverse=True,
    )


def format_news_to_md(sorted_news):
    return "\n".join(f"- [{title}]({link})" for title, link in sorted_news) + "\n"


def parse_news(md_content):
    return re.findall(r"- \[(.*?)\]\((.*?)\)", md_content)


def switch_to_parent_if_src():
    current_dir = os.getcwd()
    if os.path.basename(current_dir) == "src":
        os.chdir(os.path.dirname(current_dir))


def process_yesterday_news(yesterday, yesterday_news_filename):
    with open(yesterday_news_filename, "r", encoding="utf-8") as news_file:
        yesterday_news = news_file.read()
    if "(sorted)" in yesterday_news:
        print(f"{yesterday_news_filename} 已排序，跳过处理")
        return

    news_list = parse_news(yesterday_news)
    values_dict = fetch_news_values(news_list)
    sorted_news = sort_news_by_value(news_list, values_dict)
    formatted_md = format_news_to_md(sorted_news)
    with open(yesterday_news_filename, "w", encoding="utf-8") as news_file:
        news_file.write(
            f"# 今日新闻 - {yesterday.strftime('%Y年%m月%d日')}(sorted)\n"
        )
        news_file.write(formatted_md)
    print(f"新闻已成功排序并保存到 {yesterday_news_filename}")


def main():
    start_time = time.time()
    switch_to_parent_if_src()
    now = datetime.now(ZoneInfo("Asia/Shanghai"))
    yesterday = now - timedelta(days=1)
    filename = (
        f"news_archive/{yesterday.strftime('%Y-%m')}/"
        f"{yesterday.strftime('%d')}.md"
    )
    if not os.path.exists(filename):
        print(f"{filename} 不存在，跳过处理")
    else:
        process_yesterday_news(yesterday, filename)
    print(f"排序完成，总耗时: {time.time() - start_time:.2f} 秒")


if __name__ == "__main__":
    main()
