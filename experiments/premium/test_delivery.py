"""Explicit single-address test delivery; never reads subscriber data.
SMTP credentials come from environment. CLI may load the existing ignored .env.
"""
import argparse
from datetime import datetime
from email.message import EmailMessage
from email.utils import formataddr
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import smtplib
import ssl
from zoneinfo import ZoneInfo


def prepare(data, issue_id, recipient, sender):
    if not re.fullmatch(r'[A-Za-z0-9_-]+',issue_id):raise ValueError('invalid_issue')
    config=json.loads((data/'test-delivery-config.json').read_text())
    # A single explicit allowlisted address; no subscriber list, CC or BCC support.
    allowed=config.get('allowed_recipient')
    if not re.fullmatch(r'[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+',recipient) or recipient!=allowed:
        raise ValueError('recipient_not_explicitly_authorized')
    folder=data/'issues'/issue_id
    content=(folder/'email.html').read_text();plain=(folder/'email.txt').read_text()
    if '【测试】' not in content or '【测试】' not in plain:raise ValueError('missing_test_label')
    if re.search(r'sk-[A-Za-z0-9_-]{20,}',content+'\n'+plain):raise ValueError('credential_like_text_blocked')
    if not sender or any(c in sender for c in '\r\n'):raise ValueError('invalid_sender')
    fingerprint=hashlib.sha256((recipient+'\0'+issue_id+'\0'+content+'\0'+plain).encode()).hexdigest()
    message=EmailMessage()
    comparison=folder/'comparison.json'
    has_ai=comparison.exists() and any(row.get('result') for row in json.loads(comparison.read_text()).get('records',[]))
    message['Subject']=f'【测试】AI科技精编｜{issue_id}｜中文标题与选题审阅' if has_ai else f'【测试】每日科技早报｜{issue_id}｜多来源版式审阅'
    message['From']=formataddr(('每日科技早报 · 测试',sender))
    message['To']=recipient
    message['Message-ID']=f'<premium-test-{fingerprint[:32]}@{sender.rsplit("@",1)[-1]}>'
    message.set_content(plain)
    message.add_alternative(content,subtype='html')
    return message,fingerprint


def send_once(data,issue_id,recipient,sender,password,server,*,smtp_factory=smtplib.SMTP_SSL,checkpoint=None):
    message,fingerprint=prepare(data,issue_id,recipient,sender)
    path=data/'deliveries'/(fingerprint+'.json');path.parent.mkdir(parents=True,exist_ok=True)
    with (data/'test-delivery.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        if path.exists():return dict(json.loads(path.read_text()),reused=True)
        for existing in (data/'deliveries').glob('*.json'):
            old=json.loads(existing.read_text())
            if old.get('issue')==issue_id and old.get('recipient')==recipient:
                return dict(old,reused=True,note='edition_already_attempted_even_if_layout_changed')
        receipt=dict(issue=issue_id,recipient=recipient,subject=str(message['Subject']),message_id=str(message['Message-ID']),status='sending',started_at=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(),model_content_generated=False)
        comparison=data/'issues'/issue_id/'comparison.json'
        if comparison.exists():
            receipt['model_content_generated']=any(row.get('result') is not None for row in json.loads(comparison.read_text()).get('records',[]))
        def save():
            from durable import atomic
            atomic(path,receipt)
            if checkpoint:checkpoint()
        save();phase='connect'
        try:
            with smtp_factory(server,465,timeout=30,context=ssl.create_default_context()) as smtp:
                smtp.login(sender,password)
                phase='sending'
                refused=smtp.send_message(message,from_addr=sender,to_addrs=[recipient])
                receipt['status']='smtp_accepted' if not refused else 'recipient_refused'
                # Persist acceptance before QUIT; disconnect on QUIT cannot trigger a duplicate send.
                receipt['accepted_at']=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat()
                save()
        except (smtplib.SMTPException,OSError):
            if receipt['status']!='smtp_accepted':
                receipt['status']='unknown_do_not_retry' if phase=='sending' else 'failed_before_send'
                save()
        return receipt


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--data',type=Path,default=Path('premium_data'))
    parser.add_argument('--issue',required=True)
    parser.add_argument('--send',action='store_true')
    args=parser.parse_args()
    from dotenv import load_dotenv
    load_dotenv(override=False)
    names=['PREMIUM_TEST_RECIPIENT','SENDING_ACCOUNT','SENDING_PASSWORD','SERVER']
    config={name:os.environ.get(name,'').strip() for name in names}
    if not all(config.values()):parser.error('test recipient or SMTP configuration missing; values are never printed')
    try:
        if not args.send:
            prepare(args.data,args.issue,config[names[0]],config[names[1]])
            print('test_message_prepared_not_sent');return
        receipt=send_once(args.data,args.issue,config[names[0]],config[names[1]],config[names[2]],config[names[3]])
        print(json.dumps(receipt,ensure_ascii=False))
    except (ValueError,OSError):parser.exit(1,'test_delivery_configuration_invalid\n')

if __name__=='__main__':main()
