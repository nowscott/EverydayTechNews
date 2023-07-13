# EverydayTechNews
Automatically sending tech news to your email every morning.

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

Deploying this small tool is very simple. If you, like me, only need to read 30 pieces of tech news every day, all you need to do is modify the configuration file.

Since the forked repository cannot be set to private, you need to create a new private repository (to prevent your email from being exposed, it's mainly the sender's email used for sending, with the account and password in the configuration file).

Then, download all the code from my repository and upload it to your newly created repository.

The config.json file is as follows:

```json
{
    "sender": "send_email@example.com",
    "password": "smtp_password",
    "server": "smtp.163.com",
    "receivers": [
        "receive_email@example.com"
        ]
}
```

Make the following changes to the config.json file:


1. Open the smtp option and enter the email address after sender, and put the password obtained from SMTP in the password field.

2. Regarding the server, it depends on the email address you are using. Here, I provide the example of using the NetEase 163 email address. The server addresses for other commonly used email providers are listed at the end.

3. I have set the receivers as a list, which means you can not only include your own email address but also your friends' email addresses. This allows you to share and discuss contents of mutual interest.

After making these changes, find the technews.yml file under .github/workflows/.

Uncomment the 4th and 5th lines (since this repository is just an example repository and cannot be scheduled). This part sets the execution time at midnight UTC time. To convert it to Beijing time, add 8 hours, which means it will run around 8 AM (though it's not precise and usually finishes around 8:45 AM). For specific rules regarding cron, please refer to this website: https://tool.lu/crontab/.

Next, find the "Actions" tab, click on "technews" on the left-hand side, and on the right-hand side, find "Run workflow" to try running it. If there are no errors and the emails are sent successfully, then it is a success.

However, if you need news from other categories and not just tech, it may be a bit more complicated.

Since the layout of other categories may differ from tech news, changing the category means rewriting the code for page parsing to find news articles that match your taste. I won't go into further detail here.

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