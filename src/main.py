import sys
import os
import time
import smtplib
import requests
from bs4 import BeautifulSoup
from email.header import Header
from email.mime.text import MIMEText
# from dotenv import load_dotenv
# # 指定.env文件的路径
# dotenv_path = './.env'
# # 加载.env文件中的环境变量
# load_dotenv(dotenv_path)


def send_message(sender, password, server, receiver, text):
    msg = MIMEText(text, 'html', 'utf-8')
    subject = '今日科技早报'
    msg['Subject'] = Header(subject, 'utf-8')  # 邮件主题
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


def extract_news(container):
    news_html = ''
    # 注意：下面的类名 'news-moudle_item' 需要根据实际的HTML结构进行调整
    items = container.find_all('li', class_='newstype1') if container else []
    for item in items:
        title_tag = item.find('div', class_='news-title').find('a')
        if title_tag:
            title = title_tag.get_text(strip=True)
            link = title_tag['href']
            news_html += '<p><a href="{}">{}</a></p>'.format(link, title)
    return news_html


def technews():
    url = "https://www.eepw.com.cn/news"  # 使用指定的新闻URL
    response = requests.get(url)

    # 确保网络请求成功
    if response.status_code == 200:
        html = response.text
        soup = BeautifulSoup(html, 'html.parser')

        # 获取指定的新闻容器
        news_container = soup.find('div', id='c01')
        news_html = extract_news(news_container)

        # 返回所有新闻
        return news_html
    else:
        return "请求失败，状态码：" + str(response.status_code)


def message():
    text = """
    <h1>今日科技早报</h1>{}
    <p>注：这是一封定时邮件，请勿回复该邮件，如果有任何问题或需求，请直接与我们联系。</p>
    """.format(technews())
    return text


if __name__ == "__main__":
    text = message()
    try:
        sending_account = os.environ["SENDING_ACCOUNT"]
        sending_password = os.environ["SENDING_PASSWORD"]
        server = os.environ["SERVER"]
        receiver_list = os.environ["RECEIVER_LIST"]
        receivers = receiver_list.split(',')
    except KeyError:
        print("推送消息失败，请检查环境变量是否正确设置")
        sys.exit(1)
    except ValueError:
        print("推送消息失败，请检查环境变量 RECEIVERS 的值是否按逗号分隔")
        sys.exit(1)
    except Exception as e:
        print("推送消息失败，发生了一个未处理的异常:", e)
        sys.exit(1)
    for receiver in receivers:
        send_message(sending_account, sending_password, server, receiver, text)
