import sys
import smtplib
import requests
from bs4 import BeautifulSoup
from email.header import Header
from email.mime.text import MIMEText

def send_message(receiver,text):
    user = "nowautor@163.com"
    password = "FECISOOVEVGKIMIP"
    server = "smtp.163.com"
    msg = MIMEText(text, 'html', 'utf-8')
    subject = '今日科技早报'
    msg['Subject'] = Header(subject, 'utf-8')  # 邮件主题
    try:
        smtpobj = smtplib.SMTP_SSL(server)
        # 建立连接--qq邮箱服务和端口号（可百度查询）
        smtpobj.connect(server)    
        # 登录--发送者账号和口令
        smtpobj.login(user, password)   
        # 发送邮件
        smtpobj.sendmail(user,receiver, msg.as_string()) 
        print("邮件发送成功")
    except smtplib.SMTPException:
        print("无法发送邮件")
    finally:
        # 关闭服务器
        smtpobj.quit()

def technews(): 
    url = 'https://tech.163.com/' 
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
    <p>今日科技早报<p>
    {}
    """.format(technews())
    return text

if __name__ == "__main__":
    try:
        with open("config.txt", encoding="utf-8") as f:
            config = eval(f.read())
    except FileNotFoundError:
        print("推送消息失败,请检查config.txt文件是否与程序位于同一路径")
        sys.exit(1)
    except SyntaxError:
        print("推送消息失败,请检查配置文件格式是否正确")
        sys.exit(1)
    text = message()
    for i in range(len(config['receivers'])):
        receiver = config['receivers'][i]
        send_message(receiver,text)