# EverydayTechNews
Automatically sending tech news to your email every morning.

Click [here](https://mailist.nowscott.top/) to subscribe to the Daily Tech Morning News.

[![technews][action-image]][action-url]
[![forks][forks-image]][forks-url]

[action-url]:https://github.com/NowScott/EverydayTechNews/actions/workflows/technews.yml "Action State"
[action-image]:https://img.shields.io/github/actions/workflow/status/NowScott/EverydayTechNews/technews.yml?label=Action
[forks-url]:https://github.com/NowScott/EverydayTechNews/forks
[forks-image]:https://img.shields.io/github/forks/NowScott/EverydayTechNews?label=Forks

## Switch to Chinese

[![readme-cn][readme-cn-image]][readme-cn-url]

[readme-cn-url]:https://github.com/NowScott/EverydayTechNews/blob/main/README_CN.md "Chinese Version"
[readme-cn-image]:https://img.shields.io/badge/%E4%B8%AD%E6%96%87%E7%89%88%E6%9C%AC-red

## Original Intention behind Creation

When I was young, the elders in my family used to subscribe to newspapers. However, with the advent of technology, newspapers gradually faded from our view, replaced by the overwhelming flood of internet news.

In this vast ocean of information, there is an abundance of content, often chaotic and diverse. Yet, in reality, I am only interested in a limited range of topics.

That's why I created this tool, which automatically sends me tech news to my email every day.

By doing so, I no longer get overwhelmed by the sheer volume of information. Instead, it allows me to focus on the specific areas of interest, just like reading the sections I found most fascinating in the newspaper.

Please note that the translation has been revised to improve clarity and readability while maintaining the essence of the original message.

## Tool Introduction
As I don't want to expose my personal email address, the actual tool running on a daily basis is in another private repository. The purpose of this project is to help friends with the same need to set up a similar tool.

This small tool for automatically sending news to email is developed based on Python. The main function is in the main.py file in the root directory, and the configuration file is config.json in the root directory.

## Tool Deployment

After the update on July 19, 2023, deployment will become much simpler!

Since I have placed all the sensitive information into the repository's secret variables, now deployment can be done through forking.

First, fork this repository: https://github.com/nowscott/EverydayTechNews

Next, go to "Settings" and find "Secrets and variables". Click on "Actions" below, and on the right side, you will see a blue button that says "New repository secret". Click on this button to create four secrets:


```
SENDING_ACCOUNT: send_email@example.com
SENDING_PASSWORD: smtp_password
SERVER: smtp.163.com
RECEIVER_LIST: receiver1_email@example.com,receiver2_email@example.com
```
1. The first two are the email address to be used and the secret key for SMTP.

2. Regarding the server, it depends on the email address you are using. Here, I provide an example using a Netease 163 email address. The server addresses for other commonly used email providers are listed at the end.

3. The receivers should be separated by ",". You can add not only your own email address but also your friends' email addresses. This allows you to share and discuss content of mutual interest.

After modifying the configuration information, locate the file .github/workflows/technews.yml.

The meaning of this portion of code is to execute at 22:30 UTC (Greenwich Mean Time) every day. To convert it to Beijing time, you need to add 8 hours, which means it will start executing at around 6:30 AM. However, it may not be entirely accurate. You can modify this part of the time according to your needs. For detailed rules about cron, please refer to this website: https://tool.lu/crontab/

After that, locate "Actions" above, click on "technews" on the left side, and find "Run workflow" on the right side. If there are no errors in the "Workflow runs" section below and the emails are being sent correctly, then it is successful.

However, if you need news from other sections, it may be a bit more complicated.

Since the layout of other sections may be different from the technology section, replacing sections means rewriting the code for page parsing to find news that suits your taste. I won't go into too much detail here.

## Common Email Server Addresses

The following content is quoted from [YangCheney's blog](https://blog.csdn.net/YangCheney/article/details/126546220):

Google Mail (mail.google.com):

    POP3 Server Address: pop.gmail.com (SSL enabled port: 995)
    SMTP Server Address: smtp.gmail.com (SSL enabled port: 587)

Alibaba Cloud Enterprise Mail (qiye.aliyun.com):

    POP3 Server Address: pop.qiye.aliyun.com(Standard: 110 / SSL enabled port: 995)
    SMTP Server Address: smtp.qiye.aliyun.com(Standard: 25 / SSL enabled port: 465)
    IMAP Server Address: imap.qiye.aliyun.com(Standard: 143 / SSL enabled port: 993)
QQ Mail (mail.qq.com): ❗❗ SMTP server requires authentication.

    POP3 Server Address: pop.qq.com (Port: 110)
    SMTP Server Address: smtp.qq.com (Port: 25)
Foxmail Mail (mail.foxmail.com):

    POP3 Server Address: pop.foxmail.com (Port: 110)
    SMTP Server Address: smtp.foxmail.com (Port: 25)
NetEase 163 Mail (163.com):

    POP3 Server Address: pop.163.com (Port: 110)
    SMTP Server Address: smtp.163.com (Port: 25)
126 Mail (126.com):

    POP3 Server Address: pop.live.com (Port: 995)
    SMTP Server Address: smtp.126.com (Port: 25)
HotMail Mail (hotmail.com):

    POP3 Server Address: pop.live.com (Port: 995)
    SMTP Server Address: smtp.live.com (Port: 587)
Tom Mail (mail.tom.com):

    POP3 Server Address: pop.tom.com (Port: 110)
    SMTP Server Address: smtp.tom.com (Port: 25)
Alibaba Cloud Mail (mail.aliyun.com):

    POP3 Server Address: pop3.aliyun.com (SSL encrypted port: 995; unencrypted port: 110)
    SMTP Server Address: smtp.aliyun.com (SSL encrypted port: 465; unencrypted port: 25)
    IMAP Server Address: imap.aliyun.com (SSL encrypted port: 993; unencrypted port: 143)
Sina Mail (sina.com):

    POP3 Server Address: pop3.sina.com.cn (Port: 110)
    SMTP Server Address: smtp.sina.com.cn (Port: 25)
Sohu Mail (mail.sohu.com):

    POP3 Server Address: pop3.sohu.com (Port: 110)
    SMTP Server Address: smtp.sohu.com (Port: 25)
China Mobile 139 Mail (mail.10086.cn):

    POP3 Server Address: pop.139.com (Port: 110)
    SMTP Server Address: smtp.139.com (Port: 25)
China.com Mail (mail.china.com):

    POP3 Server Address: pop.china.com (Port: 110)
    SMTP Server Address: smtp.china.com (Port: 25)
