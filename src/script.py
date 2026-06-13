import os
import re
import time
import difflib
from datetime import datetime
from zoneinfo import ZoneInfo
import requests
from bs4 import BeautifulSoup


NEWS_URL = "https://www.ithome.com/list/"
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 Chrome/149.0 Safari/537.36"
    )
}


def parse_news_html(html, selector="ul.datel"):
    soup = BeautifulSoup(html, "html.parser")
    news_items = soup.select(f"{selector} li")
    news_data = []
    for item in news_items:
        category_element = item.select_one("a.c")
        title_element = item.select_one("a.t")
        time_element = item.select_one("i")
        if not category_element or not title_element or not time_element:
            continue

        title = title_element.get_text(strip=True)
        link = title_element.get("href")
        try:
            category = category_element.get_text(strip=True)
            time_str = time_element.get_text(strip=True)
            news_time = datetime.strptime(time_str, "%Y-%m-%d %H:%M:%S")
        except ValueError as exc:
            print(f"跳过无法解析的新闻条目: {exc}")
            continue
        if title and link:
            news_data.append({
                'category': category,
                'title': title,
                'link': link,
                'time': news_time,
            })
    return news_data


def fetch_news(url=NEWS_URL, selector="ul.datel"):
    response = requests.get(
        url,
        headers=REQUEST_HEADERS,
        timeout=30,
    )
    response.raise_for_status()
    news_data = parse_news_html(response.text, selector)
    if not news_data:
        raise RuntimeError("新闻列表解析结果为空，网页结构可能已经变化")
    return news_data


def fetch_all_news():
    return fetch_news()

def ensure_dir_exists(path):
    if not os.path.exists(path):
        os.makedirs(path)

def write_news_file(filename, date_str):
    if not os.path.exists(filename):
        with open(filename, 'w', encoding='utf-8') as f:
            f.write(f"# 今日新闻 - {date_str}\n")

def is_similar(entry1, entry2, threshold=0.9):
    ratio = difflib.SequenceMatcher(None, entry1, entry2).ratio()
    ratio_rounded = round(ratio, 4)
    if 0.99 > ratio_rounded >= threshold:
        print(f"正在检测：{entry1}")
        print(f"相似度: {ratio_rounded}，检测到相似新闻")
    return ratio_rounded >= threshold

def read_archive_state(filename, heading):
    if os.path.exists(filename):
        with open(filename, 'r', encoding='utf-8') as file:
            content = file.read()
    else:
        content = heading
        with open(filename, 'w', encoding='utf-8') as file:
            file.write(content)

    entries = re.findall(r'^- \[(.*?)\]\((.*?)\)$', content, re.MULTILINE)
    return {
        "content": content,
        "titles": [title for title, _ in entries],
        "urls": {url for _, url in entries},
    }

def save_news_to_markdown(now, new_news):
    year_month = now.strftime("%Y-%m")
    folder_path = f"news_archive/{year_month}"  # 文件夹路径
    ensure_dir_exists(folder_path)
    today_news_filename = f"{folder_path}/{now.strftime('%d')}.md"
    write_news_file(today_news_filename, now.strftime('%Y年%m月%d日'))
    month_states = {}
    day_states = {}
    news_written_count = 0

    for news in new_news:
        markdown_entry = f"- [{news['title']}]({news['link']})"
        news_time = news['time']
        news_folder_path = f"news_archive/{news_time.strftime('%Y-%m')}"
        month_news_filename = f"{news_folder_path}/00.md"
        news_filename = f"{news_folder_path}/{news_time.strftime('%d')}.md"
        ensure_dir_exists(news_folder_path)
        write_news_file(news_filename, news_time.strftime('%Y年%m月%d日'))

        if month_news_filename not in month_states:
            month_states[month_news_filename] = read_archive_state(
                month_news_filename, "# 本月新闻\n"
            )
        month_state = month_states[month_news_filename]

        is_duplicate = news['link'] in month_state["urls"] or any(
            is_similar(news['title'], existing_title)
            for existing_title in month_state["titles"]
        )
        if is_duplicate:
            continue

        with open(month_news_filename, 'a', encoding='utf-8') as month_file:
            month_file.write(markdown_entry + "\n")
        month_state["urls"].add(news['link'])
        month_state["titles"].append(news['title'])
        news_written_count += 1

        if news_filename not in day_states:
            day_states[news_filename] = read_archive_state(
                news_filename,
                f"# 今日新闻 - {news_time.strftime('%Y年%m月%d日')}\n",
            )
        day_state = day_states[news_filename]
        if "(sorted)" in day_state["content"]:
            print(f"{news_filename} 已排序，仅更新月度归档")
            continue
        if news['link'] not in day_state["urls"]:
            with open(news_filename, 'a', encoding='utf-8') as day_file:
                day_file.write(markdown_entry + "\n")
            day_state["urls"].add(news['link'])
            day_state["titles"].append(news['title'])
    if news_written_count > 0:
        print(f"新闻保存成功，本次更新了 {news_written_count} 条新闻。")
    else:
        print("没有新的新闻需要更新。")

def switch_to_parent_if_src():
    """检查当前目录的最后一级是否是src，如果是，则切换到上一级目录"""
    current_dir = os.getcwd()
    base_name = os.path.basename(current_dir)

    if base_name == 'src':
        parent_dir = os.path.dirname(current_dir)
        os.chdir(parent_dir)
        print(f'切换到上一级目录: {parent_dir}')

def main():
    start_time = time.time()
    switch_to_parent_if_src()
    tz = ZoneInfo('Asia/Shanghai')
    now = datetime.now(tz)
    print("当前时间：", now.strftime("%Y-%m-%d %H:%M:%S %Z"))  # 打印当前的日期和时间以及时区信息
    # 调用函数爬取所有新闻榜单
    print("开始爬取所有新闻...")
    try:
        new_news = fetch_all_news()
        print("新闻爬取完成，共爬取到 {} 条新闻。".format(len(new_news)))
        # 保存新闻到Markdown文件
        save_news_to_markdown(now, new_news)
    except Exception as e:
        print(f"An error occurred: {e}")
        raise
    end_time = time.time()
    elapsed_time = end_time - start_time
    print(f"写入新闻完成，总耗时: {elapsed_time:.2f} 秒")

if __name__ == '__main__':
    main()
