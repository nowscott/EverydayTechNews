import re
import time
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.support.wait import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager

# 常量定义
MAX_RETRIES = 3
WAIT_TIME = 3
TIMEOUT = 10

def setup_driver():
    """设置并返回Selenium WebDriver"""
    service = Service(ChromeDriverManager().install())
    options = webdriver.ChromeOptions()
    options.add_argument('--headless')
    options.add_argument('--disable-gpu')
    return webdriver.Chrome(service=service, options=options)

# 评分函数
def calculate_score(valuable, unvaluable):
    total = valuable + unvaluable
    if total == 0:
        return 0
    elif valuable == 0 and unvaluable != 0:
        return -10
    elif unvaluable == 0 and valuable != 0:
        return 10 + valuable
    else:
        return (valuable / total) * 10

def adjust_value_based_on_title(title):
    """根据标题调整价值"""
    currency_units = [' 元', ' 万元', ' 美元', ' 日元']
    for unit in currency_units:
        if unit in title:
            return -5
    return None

def fetch_news_values(news_list, driver):
    """批量获取新闻链接的价值信息，返回字典"""
    values_dict = {}
    if not news_list:
        print("没有新闻要处理，返回空字典")
        return values_dict
    print(f'共有{len(news_list)}条新闻')
    for title, url in news_list[:]:
        adjusted_value = adjust_value_based_on_title(title)
        if adjusted_value is not None:
            values_dict[url] = str(adjusted_value)
            print(f"{title} 包含金额，跳过评分")
            continue  # 跳过爬取
        for attempt in range(MAX_RETRIES):
            try:
                driver.get(url)
                WebDriverWait(driver, TIMEOUT).until(lambda d: d.execute_script('return document.readyState') == 'complete')
                if "404" in driver.title or "Page Not Found" in driver.page_source:
                    print(f"{title} 页面跳到404，删除该新闻")
                    news_list.remove((title, url))
                    break
                try:
                    scores_element = WebDriverWait(driver, TIMEOUT).until(EC.visibility_of_element_located((By.CSS_SELECTOR, ".bt")))
                    valuable = int(scores_element.find_element(By.CSS_SELECTOR, "#sgrade2 div").text)
                    unvaluable = int(scores_element.find_element(By.CSS_SELECTOR, "#sgrade0 div").text)
                except (TimeoutException, ValueError):
                    print(f"{title} 页面评分获取失败，设置为-100分")
                    valuable = 0
                    unvaluable = 1
                # 计算综合评分
                value = calculate_score(valuable, unvaluable)
                values_dict[url] = str(value)
                break
            except TimeoutException:
                print(f"访问 {title} 时出错，尝试第 {attempt + 1} 次重试")
                time.sleep(WAIT_TIME)
                if attempt == MAX_RETRIES - 1:
                    print(f"访问 {title} 失败，已达到最大重试次数")
                    values_dict[url] = "-10"
    print(f'成功对{len(news_list)}条新闻排序')
    return values_dict

def sort_news_by_value(news_list, values_dict):
    """根据价值排序新闻链接"""
    return sorted(news_list, key=lambda x: float(values_dict.get(x[1], "0")), reverse=True)

def format_news_to_md(sorted_news):
    """格式化排序后的新闻列表为Markdown字符串"""
    return "\n".join(f'- [{title}]({link})' for title, link in sorted_news) + "\n"

def parse_news(md_content):
    """解析Markdown内容中的新闻链接和标题，返回元组列表"""
    pattern = r'- \[(.*?)\]\((.*?)\)'
    return re.findall(pattern, md_content)

def switch_to_parent_if_src():
    """检查当前目录的最后一级是否是src，如果是，则切换到上一级目录"""
    current_dir = os.getcwd()
    base_name = os.path.basename(current_dir)
    if base_name == 'src':
        parent_dir = os.path.dirname(current_dir)
        os.chdir(parent_dir)
        print(f'切换到上一级目录: {parent_dir}')

def process_yesterday_news(yesterday,yesterday_news_filename):
    """处理昨天的新闻"""
    with open(yesterday_news_filename, 'r') as f:
        yesterday_news = f.read()
    if "(sorted)" in yesterday_news:
        print(f"{yesterday_news_filename} 已排序，跳过处理")
        return
    news_list = parse_news(yesterday_news)
    with setup_driver() as driver:
        values_dict = fetch_news_values(news_list, driver)
    sorted_news = sort_news_by_value(news_list, values_dict)
    formatted_md = format_news_to_md(sorted_news)
    with open(yesterday_news_filename, 'w') as f:
        f.write(f"# 今日新闻 - {yesterday.strftime('%Y年%m月%d日')}(sorted)\n")
        f.write(formatted_md)
    print(f"新闻已成功排序并保存到 {yesterday_news_filename}")

def main():
    start_time = time.time()
    switch_to_parent_if_src()
    tz = ZoneInfo('Asia/Shanghai')
    now = datetime.now(tz)
    yesterday = now - timedelta(days=1)
    year_month = yesterday.strftime("%Y-%m")
    yesterday_day = yesterday.strftime("%d")
    yesterday_folder_path = f"news_archive/{year_month}"
    yesterday_news_filename = f"{yesterday_folder_path}/{yesterday_day}.md"
    if not os.path.exists(yesterday_news_filename):
        print(f"{yesterday_news_filename} 不存在，跳过处理")
    else:
        process_yesterday_news(yesterday,yesterday_news_filename)
    end_time = time.time()
    elapsed_time = end_time - start_time
    print(f"排序完成，总耗时: {elapsed_time:.2f} 秒")

if __name__ == "__main__":
    main()
