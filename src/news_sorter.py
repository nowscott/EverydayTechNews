# 标准库导入
import re
from datetime import datetime, timedelta

# 本地化和时区处理
from zoneinfo import ZoneInfo  # Python 3.9+

# Selenium 相关导入
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.wait import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# WebDriver 管理
from webdriver_manager.chrome import ChromeDriverManager


def setup_driver():
    """设置并返回Selenium WebDriver"""
    service = Service(ChromeDriverManager().install())
    options = webdriver.ChromeOptions()
    options.add_argument('--headless')
    options.add_argument('--disable-gpu')
    return webdriver.Chrome(service=service, options=options)

def fetch_news_values(news_list, driver):
    """批量获取新闻链接的价值信息，返回字典"""
    values_dict = {}
    max_retries = 3  # 最大重试次数
    news_num = len(news_list)
    print(f'共有{news_num}条新闻')
    for title, url in news_list:
        retry_count = 0
        while retry_count < max_retries:
            try:
                driver.get(url)
                wait = WebDriverWait(driver, 10)
                value_element = wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, ".sd .ss")))
                value = value_element.text if value_element else "0"
                values_dict[url] = value
                break  # 如果成功获取到数据，跳出重试循环
            except Exception as e:
                retry_count += 1
                print(f"访问 {title} 时出错，尝试第 {retry_count} 次重试")
                time.sleep(3)  # 出错后等待3秒再重试
                if retry_count == max_retries:
                    print(f"访问 {title} 失败，已达到最大重试次数")
                    news_num -= 1
                    values_dict[url] = "0"
    print(f'成功对{news_num}条新闻排序')
    return values_dict

def sort_news_by_value(news_list, values_dict):
    """根据价值排序新闻链接"""
    return sorted(news_list, key=lambda x: float(values_dict.get(x[1], "0")), reverse=True)

def format_news_to_md(sorted_news):
    """格式化排序后的新闻列表为Markdown字符串"""
    formatted_news = ""
    for title, link in sorted_news:
        formatted_news += f'- [{title}]({link})\n'
    return formatted_news

def parse_news(md_content):
    """解析Markdown内容中的新闻链接和标题，返回元组列表"""
    pattern = r'- \[(.*?)\]\((.*?)\)'
    return re.findall(pattern, md_content)

def main():
    tz = ZoneInfo('Asia/Shanghai')
    now = datetime.now(tz)
    yesterday = now - timedelta(days=1)
    yesterday_day = yesterday.strftime("%d")
    year_month = now.strftime("%Y-%m")
    yesterday_folder_path = f"news_archive/{year_month}"
    yesterday_news_filename = f"{yesterday_folder_path}/{yesterday_day}.md"
    with open(yesterday_news_filename, 'r') as f:
        yesterday_news = f.read()
    news_list = parse_news(yesterday_news)
    driver = setup_driver()
    values_dict = fetch_news_values(news_list, driver)
    driver.quit()
    sorted_news = sort_news_by_value(news_list, values_dict)
    formatted_md = format_news_to_md(sorted_news)
    with open(yesterday_news_filename, 'w') as f:
        f.write(f"# 今日新闻 - {yesterday.strftime('%Y年%m月%d日')}\n")
        f.write(formatted_md)

if __name__ == "__main__":
    main()
