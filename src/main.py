# 标准库导入
import os
import re
import sys
import time
from datetime import datetime, timedelta

# 本地化和时区处理
from zoneinfo import ZoneInfo  # Python 3.9+

# 网络请求和配置文件处理
import requests
import configparser

# 邮件处理库
import smtplib
from email.header import Header
from email.mime.text import MIMEText

# # 以下部分是本地测试时使用的代码
# from dotenv import load_dotenv
# dotenv_path = './.env'
# load_dotenv(dotenv_path)
# # 以上部分是本地测试时使用的代码

# #获取环境变量
def fetch_notion_users(api_key, database_id):
    url = f"https://api.notion.com/v1/databases/{database_id}/query"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Notion-Version": "2021-05-13",
        "Content-Type": "application/json"
    }
    response = requests.post(url, headers=headers)
    if response.status_code != 200:
        raise Exception("Failed to fetch data from Notion API: " + response.text) 
    data = response.json()
    users = []
    for result in data.get("results", []):
        user_data = {}
        properties = result.get("properties", {})
        # 假设姓名字段名为 "Name"，邮箱字段名为 "Email"
        name = properties.get("Name", {}).get("title", [{}])[0].get("text", {}).get("content")
        email = properties.get("Email", {}).get("email")
        if name and email:
            user_data["name"] = name
            user_data["email"] = email
            users.append(user_data)
    return users

def send_message(sender, password, server, receiver, text):
    msg = MIMEText(text, 'html', 'utf-8')
    subject = '今日科技早报'
    msg['Subject'] = Header(subject, 'utf-8')  # type: ignore # 邮件主题
    attempt = 1
    while attempt <= 3:
        try:
            smtpobj = smtplib.SMTP_SSL(server)
            smtpobj.connect(server)
            smtpobj.login(sender, password)
            smtpobj.sendmail(sender, receiver, msg.as_string())
            print("邮件发送成功")
            smtpobj.quit()  # 关闭服务器
            return True
        except smtplib.SMTPException:
            print("尝试发送邮件失败，进行下一次尝试...")
            time.sleep(3)
            attempt += 1
    print("达到最大尝试次数，无法发送邮件")
    return False


# 创建一个ConfigParser对象
config = configparser.ConfigParser()
# 读取配置文件
config.read('notifications.ini')
# 获取开头通知、结尾通知和结尾注释内容，如果不存在则设置为空字符串
start_notification = config.get('开头通知', 'content', fallback='')
end_notification = config.get('结尾通知', 'content', fallback='')
end_comment = config.get('结尾注释', 'content', fallback='')
tz = ZoneInfo('Asia/Shanghai')
now = datetime.now(tz)
yesterday = now - timedelta(days=1)
yesterday_day = yesterday.strftime("%d") 
yesterday_year_month = yesterday.strftime("%Y-%m")
yesterday_folder_path = f"news_archive/{yesterday_year_month}"
yesterday_news_filename = f"{yesterday_folder_path}/{yesterday_day}.md"
with open(yesterday_news_filename, 'r') as f:
    yesterday_news = f.read()

def format_news(news_string):
    # 使用正则表达式提取链接和标题
    pattern = r'\[(.*?)\]\((.*?)\)'
    matches = re.findall(pattern, news_string)
    # 限制结果到前25条
    matches = matches[:25]
    formatted_news = ''
    for match in matches:
        title = match[0]
        link = match[1]
        formatted_link = '<p><a href="{}">{}</a></p>'.format(link, title)
        formatted_news += formatted_link
    return formatted_news

def message(name):
    # 使用用户的名字来创建个性化问候
    greeting = f"早上好{name}，以下是今日的科技早报"
    # 检查配置变量是否为空，如果为空则设置为空字符串
    start_notification_text = start_notification if start_notification else ''
    end_notification_text = end_notification if end_notification else ''
    end_comment_text = end_comment if end_comment else ''
    text = f"""
    <h2>{greeting}</h2>
    <p>{start_notification_text}</p>
    <div>{format_news(yesterday_news)}</div>
    <p>{end_notification_text}</p>
    <p>{end_comment_text}</p>
    """
    return text
def get_env_variable(name):
    try:
        return os.environ[name]
    except KeyError:
        print(f"环境变量 {name} 未设置，请检查配置。")
        sys.exit(1)

if __name__ == "__main__":
    try:
        API_KEY = get_env_variable("NOTION_API_KEY")
        DATABASE_ID = get_env_variable("NOTION_DATABASE_ID")
        sending_account = get_env_variable("SENDING_ACCOUNT")
        sending_password = get_env_variable("SENDING_PASSWORD")
        server = get_env_variable("SERVER")
        users = fetch_notion_users(API_KEY, DATABASE_ID)  # 确保这个函数调用不抛出KeyError
    except Exception as e:
        print("推送消息失败，发生了一个未处理的异常:", e)
        sys.exit(1)
    for user in users:
        personalized_message = message(user['name'])  # 创建个性化消息
        send_message(sending_account, sending_password, server, user['email'], personalized_message)

    # # 以下部分是我本地测试时使用的代码
    # send_message(sending_account, sending_password, server,'nowscott@qq.com',message('NowScott'))
    # # 以上部分是我本地测试时使用的代码