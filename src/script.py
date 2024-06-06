# 标准库导入
import os
from datetime import datetime, timedelta

# 本地化和时区处理
from zoneinfo import ZoneInfo  # Python 3.9+

# Selenium 相关导入
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.support.wait import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# WebDriver 管理
from webdriver_manager.chrome import ChromeDriverManager


def fetch_news(driver, selector):
    try:
        WebDriverWait(driver, 20).until(EC.presence_of_element_located((By.CSS_SELECTOR, selector)))
        news_items = driver.find_elements(By.CSS_SELECTOR, f'{selector} li a')
        news_data = []
        for item in news_items:
            title = item.get_attribute('title')
            link = item.get_attribute('href')
            news_data.append({'title': title, 'link': link})
        return news_data
    except TimeoutException as e:
        print(f"抓取'{selector}'时发生超时异常: {e}")
        return []

def fetch_all_news():
    # 设置 Selenium WebDriver
    service = Service(ChromeDriverManager().install())
    options = Options()
    options.add_argument('--headless')
    options.add_argument('--disable-gpu')
    driver = webdriver.Chrome(service=service, options=options)
    all_news_data = []
    try:
        # 打开网页
        driver.get('https://digi.ithome.com/')
        # 抓取日榜新闻
        all_news_data.extend(fetch_news(driver, 'ul.bd.order#d-1'))
        # 抓取另一个 <ul> 中的内容
        all_news_data.extend(fetch_news(driver, 'ul.bd.order#d-4'))
    finally:
        # 关闭浏览器
        driver.quit()
    return all_news_data

def save_news_to_markdown(now, new_news):
    day = now.strftime("%d")
    yesterday = now - timedelta(days=1)
    yesterday_day = yesterday.strftime("%d")
    year_month = now.strftime("%Y-%m")
    yesterday_year_month = yesterday.strftime("%Y-%m")
    
    folder_path = f"news_archive/{year_month}"  # 文件夹路径
    yesterday_folder_path = f"news_archive/{yesterday_year_month}"
    
    # 打印路径信息
    print(f"当前工作目录: {os.getcwd()}")
    print(f"今日文件夹路径: {folder_path}")
    print(f"昨日文件夹路径: {yesterday_folder_path}")
    
    # 如果文件夹不存在，则创建
    if not os.path.exists(folder_path):
        os.makedirs(folder_path)
        print(f"创建文件夹: {folder_path}")
    if not os.path.exists(yesterday_folder_path):
        os.makedirs(yesterday_folder_path)
        print(f"创建文件夹: {yesterday_folder_path}")
        
    # 设置新闻文件路径
    month_news_filename = f"{folder_path}/00.md"
    today_news_filename = f"{folder_path}/{day}.md"
    yesterday_news_filename = f"{yesterday_folder_path}/{yesterday_day}.md"
    
    # 如果今日新闻文件不存在，创建文件并写入标题
    if not os.path.exists(today_news_filename):
        with open(today_news_filename, 'w') as f:
            f.write(f"# 今日新闻 - {now.strftime('%Y年%m月%d日')}\n")
        print(f"创建文件: {today_news_filename}")
            
    # 如果昨日新闻文件不存在，创建文件并写入标题
    if not os.path.exists(yesterday_news_filename):
        with open(yesterday_news_filename, 'w') as f:
            f.write(f"# 今日新闻 - {yesterday.strftime('%Y年%m月%d日')}\n")
        print(f"创建文件: {yesterday_news_filename}")
            
    news_written_count = 0  # 设置计数器来跟踪写入的新闻条数
    
    # 读取昨日新闻内容
    if os.path.exists(yesterday_news_filename):
        with open(yesterday_news_filename, 'r') as f:
            yesterday_news = f.read()
    else:
        yesterday_news = ""
        
    # 读取或初始化本月新闻文件
    if os.path.exists(month_news_filename):
        with open(month_news_filename, 'r') as f:
            existing_month_news = f.read()
    else:
        existing_month_news = ""
        with open(month_news_filename, 'w') as f:
            f.write("# 本月新闻\n")
    
    # 创建一个集合来跟踪已存在的新闻条目
    news_set = set(existing_month_news.splitlines())
    
    with open(month_news_filename, 'a') as f:
        for news in new_news:
            markdown_entry = f"- [{news['title']}]({news['link']})\n"
            # 检查新闻条目是否重复
            is_new_entry = (markdown_entry not in news_set and
                            markdown_entry not in yesterday_news and
                            markdown_entry not in existing_month_news)
            if is_new_entry:
                # 写入本月新闻文件
                f.write(markdown_entry)
                news_set.add(markdown_entry)
                news_written_count += 1
                # 同时写入今日新闻文件
                with open(today_news_filename, 'a') as df:
                    df.write(markdown_entry)
                    
    if news_written_count > 0:
        print(f"保存成功，本次更新了 {news_written_count} 条新闻。")
    else:
        print("保存失败，暂时没有新闻更新。")
        
    
def switch_to_parent_if_src():
    """检查当前目录的最后一级是否是src，如果是，则切换到上一级目录"""
    current_dir = os.getcwd()
    base_name = os.path.basename(current_dir)

    if base_name == 'src':
        parent_dir = os.path.dirname(current_dir)
        os.chdir(parent_dir)
        print(f'当前目录是 {current_dir}，切换到上一级目录: {parent_dir}')
    else:
        print(f'当前目录是 {current_dir}，无需切换')
                
if __name__ == '__main__':
    switch_to_parent_if_src()
    tz = ZoneInfo('Asia/Shanghai')
    now = datetime.now(tz)
    print("当前时间：", now.strftime("%Y-%m-%d %H:%M:%S %Z"))  # 打印当前的日期和时间以及时区信息
    # 调用函数爬取所有新闻榜单
    print("开始爬取所有新闻...")
    new_news = fetch_all_news()
    print("新闻爬取完成，共爬取到 {} 条新闻。".format(len(new_news)))
    # print(new_news)
    # 保存新闻到Markdown文件
    print("开始保存新闻到Markdown文件...")
    save_news_to_markdown(now, new_news)
