import sys
import os
import json
import time
import smtplib
import requests
from bs4 import BeautifulSoup
from email.header import Header
from email.mime.text import MIMEText

def send_message(sender,password,server,receiver,text):
    sender = sender
    password = password
    server = server
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

def technews(): 
    url = 'https://tech.163.com/' #这里我使用的是网易新闻的科技板块，可以按需更换
    html = requests.get(url).text 
    soup = BeautifulSoup(html,'html.parser') 
    displayno = soup.find_all('div',style='display:none;') 
    titles = [] 
    for d in displayno: 
        for i in range(len(d.find_all('a'))): 
            t = d.find_all('a')[i] 
            titles.append(t) 
    news = ''.join(['<p>{}</p>'.format(title) for title in titles])
    return news

def message():
    text = """
    <h1>今日科技早报</h1>{}
    <p>注：这是一封定时邮件，请勿回复该邮件，如果有任何问题或需求，请直接与我们联系。</p>
    """.format(technews())
    return text

if __name__ == "__main__":
    try:
        with open('config.json', 'r') as file:
            config = json.load(file)
            sender = config['sender']
            password = config['password']
            server = config['server']
    except FileNotFoundError:
        print("推送消息失败,请检查config.txt文件是否与程序位于同一路径")
        sys.exit(1)
    except SyntaxError:
        print("推送消息失败,请检查配置文件格式是否正确")
        sys.exit(1)
    text = message()
    for i in range(len(config['receivers'])):
        receiver = config['receivers'][i]
        send_message(sender,password,server,receiver,text)