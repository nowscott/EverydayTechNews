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


def _build_message(sender, receiver, text, subject="今日科技早报"):
    message = MIMEText(text, "html", "utf-8")
    message["Subject"] = Header(subject, "utf-8")
    message["From"] = sender
    message["To"] = receiver
    return message


class SMTPMailer:
    def __init__(self, sender, password, server, timeout=30):
        self.sender = sender
        self.password = password
        self.server = server
        self.timeout = timeout
        self.connection_count = 0
        self._smtp = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()

    def _connect(self):
        smtp = smtplib.SMTP_SSL(self.server, timeout=self.timeout)
        try:
            smtp.login(self.sender, self.password)
        except Exception:
            try:
                smtp.close()
            finally:
                raise
        self._smtp = smtp
        self.connection_count += 1

    def _ensure_connected(self):
        if self._smtp is None:
            self._connect()

    def _reset_connection(self):
        smtp, self._smtp = self._smtp, None
        if smtp is not None:
            try:
                smtp.close()
            except (smtplib.SMTPException, OSError):
                pass

    def close(self):
        smtp, self._smtp = self._smtp, None
        if smtp is None:
            return
        try:
            smtp.quit()
        except (smtplib.SMTPException, OSError):
            try:
                smtp.close()
            except (smtplib.SMTPException, OSError):
                pass

    def send_message(self, receiver, text, subject="今日科技早报"):
        message = _build_message(self.sender, receiver, text, subject)
        permanent_failures = 0

        for attempt in range(1, 4):
            try:
                self._ensure_connected()
                self._smtp.sendmail(
                    self.sender,
                    receiver,
                    message.as_string(),
                )
                return SEND_SUCCESS
            except (smtplib.SMTPException, OSError) as error:
                if _is_permanent_recipient_failure(error):
                    permanent_failures += 1
                else:
                    self._reset_connection()
                if attempt < 3:
                    time.sleep(3)

        if permanent_failures == 3:
            return SEND_PERMANENT_FAILURE
        return SEND_TEMPORARY_FAILURE


def send_message(
    sender,
    password,
    server,
    receiver,
    text,
    subject="今日科技早报",
):
    with SMTPMailer(sender, password, server) as mailer:
        return mailer.send_message(receiver, text, subject)
