import smtplib
import time
from email.header import Header
from email.mime.text import MIMEText


SEND_SUCCESS = "success"
SEND_PERMANENT_FAILURE = "permanent_failure"
SEND_TEMPORARY_FAILURE = "temporary_failure"


def _is_permanent_recipient_failure(error):
    if not isinstance(error, smtplib.SMTPRecipientsRefused):
        return False
    failures = error.recipients.values()
    return bool(error.recipients) and all(
        isinstance(code, int) and 500 <= code < 600
        for code, _ in failures
    )


def send_message(sender, password, server, receiver, text):
    msg = MIMEText(text, "html", "utf-8")
    msg["Subject"] = Header("今日科技早报", "utf-8")
    msg["From"] = sender
    msg["To"] = receiver
    permanent_failures = 0

    for attempt in range(1, 4):
        try:
            with smtplib.SMTP_SSL(server, timeout=30) as smtp:
                smtp.login(sender, password)
                smtp.sendmail(sender, receiver, msg.as_string())
            print("邮件发送成功")
            return SEND_SUCCESS
        except (smtplib.SMTPException, OSError) as error:
            if _is_permanent_recipient_failure(error):
                permanent_failures += 1
            print(f"第 {attempt} 次邮件发送失败")
            if attempt < 3:
                time.sleep(3)

    print("达到最大尝试次数，无法发送邮件")
    if permanent_failures == 3:
        return SEND_PERMANENT_FAILURE
    return SEND_TEMPORARY_FAILURE
