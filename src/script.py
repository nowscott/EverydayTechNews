import os
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

def fetch_news(url, selector):
    response = requests.get(url)
    response.encoding = 'utf-8'
    if response.status_code == 200:
        soup = BeautifulSoup(response.text, 'html.parser')
        news_items = soup.select(f'{selector} li')
        news_data = []
        for item in news_items:
            category = item.select_one('a.c').text
            title = item.select_one('a.t').text
            link = item.select_one('a.t')['href']
            time_str = item.select_one('i').text
            time = datetime.strptime(time_str, "%Y-%m-%d %H:%M:%S")
            news_data.append({'category': category, 'title': title, 'link': link, 'time': time})
        return news_data
    else:
        print(f"无法访问页面，状态码: {response.status_code}")
        return []

def fetch_all_news():
    url = 'https://www.ithome.com/list/'
    news_data = fetch_news(url, 'ul.datel')
    return news_data

def ensure_dir_exists(path):
    if not os.path.exists(path):
        os.makedirs(path)

def write_news_file(filename, date_str):
    if not os.path.exists(filename):
        with open(filename, 'w', encoding='utf-8') as f:
            f.write(f"# 今日新闻 - {date_str}\n")

def save_news_to_markdown(now, new_news):
    year_month = now.strftime("%Y-%m")
    
    folder_path = f"news_archive/{year_month}"  # 文件夹路径
    ensure_dir_exists(folder_path)
    
    month_news_filename = f"{folder_path}/00.md"
    today_news_filename = f"{folder_path}/{now.strftime('%d')}.md"
    
    write_news_file(today_news_filename, now.strftime('%Y年%m月%d日'))

    # 读取或初始化本月新闻文件
    if os.path.exists(month_news_filename):
        with open(month_news_filename, 'r', encoding='utf-8') as f:
            existing_month_news = f.read()
    else:
        existing_month_news = "# 本月新闻\n"
        with open(month_news_filename, 'w', encoding='utf-8') as f:
            f.write(existing_month_news)
    
    news_set = set(existing_month_news.splitlines())
    
    news_written_count = 0
    
    for news in new_news:
        markdown_entry = f"- [{news['title']}]({news['link']})\n"
        news_time = news['time']
        news_day = news_time.strftime("%d")
        news_folder_path = f"news_archive/{news_time.strftime('%Y-%m')}"
        news_filename = f"{news_folder_path}/{news_day}.md"
        
        # 如果新闻文件夹不存在，则创建
        ensure_dir_exists(news_folder_path)
        
        # 如果新闻文件不存在，创建文件并写入标题
        write_news_file(news_filename, news_time.strftime('%Y年%m月%d日'))

        # 检查新闻条目是否重复
        is_new_entry = (markdown_entry not in news_set and
                        markdown_entry not in existing_month_news)
        if is_new_entry:
            news_set.add(markdown_entry)
            news_written_count += 1
            # 写入本月新闻文件
            with open(month_news_filename, 'a', encoding='utf-8') as month_file:
                month_file.write(markdown_entry)
            # 写入对应日期的新闻文件
            with open(news_filename, 'a', encoding='utf-8') as day_file:
                day_file.write(markdown_entry)
                    
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
    switch_to_parent_if_src()
    tz = ZoneInfo('Asia/Shanghai')
    now = datetime.now(tz)
    print("当前时间：", now.strftime("%Y-%m-%d %H:%M:%S %Z"))  # 打印当前的日期和时间以及时区信息
    # 调用函数爬取所有新闻榜单
    print("开始爬取所有新闻...")
    new_news = fetch_all_news()
    print("新闻爬取完成，共爬取到 {} 条新闻。".format(len(new_news)))
    # 保存新闻到Markdown文件
    save_news_to_markdown(now, new_news)

if __name__ == '__main__':
    main()
