import importlib.util
import json
from pathlib import Path
import smtplib
import sys
import tempfile
import unittest
from unittest.mock import Mock, MagicMock, patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'experiments/premium'))
import brief as b
from email_layout import build_email
from test_delivery import prepare,send_once

class SourceAndDeliveryTests(unittest.TestCase):
    def test_hn_submission_is_not_article_publication_and_has_no_model_body(self):
        item=dict(id=123,type='story',title='AI model released',time=1792286330,url='https://example.org/article',score=50,text='<p>untrusted discussion</p>')
        a=b.parse_hn_item(item,'2026-10-18T10:00:00+08:00',1)
        self.assertEqual(a['content_status'],'discovery_only')
        self.assertEqual(a['published_time_kind'],'hn_submission')
        self.assertIsNone(a['original_article_published_at'])
        self.assertIn('?id=123',a['discussion_url'])
        self.assertFalse(b.select([a],b.now(),True)[0])
    def test_hn_deleted_jobs_and_non_technology_are_not_news(self):
        for item in [dict(id=1,type='job'),dict(id=1,type='story',deleted=True),dict(id=1,type='story',time=1792286330,title='A political protest')]:
            self.assertIsNone(b.parse_hn_item(item,b.stamp(),1))
    def test_foreign_description_is_discovery_even_when_long(self):
        for source,url in [('openai','https://openai.com/index/example'),('google_ai','https://blog.google/example'),('bloomberg','https://www.bloomberg.com/news/example'),('github','https://github.blog/changelog/example')]:
            xml=f'<rss><channel><item><title>News</title><link>{url}</link><pubDate>Sun, 18 Oct 2026 01:00:00 GMT</pubDate><description>'+('Summary. '*100)+'</description></item></channel></rss>'
            a=b.parse_feed(xml,source,b.stamp())[0]
            self.assertEqual(a['content_status'],'discovery_only',source)
    def test_github_full_encoded_body_is_usable(self):
        xml='<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>Release</title><link>https://github.blog/changelog/release</link><pubDate>Sun, 18 Oct 2026 01:00:00 GMT</pubDate><description>short</description><content:encoded><![CDATA[<p>'+('Body evidence. '*30)+'</p>]]></content:encoded></item></channel></rss>'
        a=b.parse_feed(xml,'github',b.stamp())[0]
        self.assertEqual(a['content_status'],'usable_excerpt')
        self.assertEqual(a['content_origin'],'rss_content_encoded')
    def test_layout_excludes_raw_audit_payload_and_has_test_notice(self):
        a=dict(title='Source headline',url='https://github.blog/test',source='github',source_name='GitHub',published_at='2026-10-16T12:00:00+08:00',text='Original text. '*30,topic='软件更新',language='en')
        issue=dict(collection_cutoff='2026-10-18T10:00:00+08:00',mode='historical_quality_sample')
        doc,plain=build_email(issue,[dict(article=a,result=None,status='queued')])
        for text in ['【测试】','今日速览','海外原文摘录','尚未调用 DeepSeek']:
            self.assertIn(text,doc)
        self.assertNotIn('content_fingerprint',doc);self.assertNotIn('<details>',doc)
        self.assertIn('【测试】',plain)
    def test_layout_hn_time_is_explicit(self):
        a=b.parse_hn_item(dict(id=123,type='story',title='AI release',time=1792286330),'2026-10-18T10:00:00+08:00',1)
        doc,_=build_email(dict(collection_cutoff='2026-10-18T10:00:00+08:00',mode='historical_quality_sample',discovery_leads=[a]),[])
        self.assertIn('原文时间未确认',doc);self.assertIn('不计入本期精选',doc)
    def setup_folder(self,folder):
        (folder/'test-delivery-config.json').write_text(json.dumps(dict(allowed_recipient='test@example.com')))
        out=folder/'issues/test';out.mkdir(parents=True)
        (out/'email.html').write_text('<html>【测试】offline</html>')
        (out/'email.txt').write_text('【测试】offline')
        return out
    def test_single_recipient_multipart_and_no_cc_bcc(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);self.setup_folder(folder)
            message,_=prepare(folder,'test','test@example.com','sender@example.com')
            self.assertEqual(message.get_content_type(),'multipart/alternative')
            self.assertIsNone(message['Cc']);self.assertIsNone(message['Bcc'])
            self.assertIn('【测试】',str(message['Subject']))
            for target in ['other@example.com','test@example.com,other@example.com','test@example.com\r\nBcc:x@ex.com']:
                with self.assertRaises(ValueError):prepare(folder,'test',target,'sender@example.com')
    def test_repeat_test_send_does_not_send_twice(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);self.setup_folder(folder);factory=MagicMock();smtp=factory.return_value.__enter__.return_value;smtp.send_message.return_value={}
            a=send_once(folder,'test','test@example.com','sender@example.com','fake-password','smtp.example.com',smtp_factory=factory)
            second=send_once(folder,'test','test@example.com','sender@example.com','fake-password','smtp.example.com',smtp_factory=factory)
            self.assertEqual(a['status'],'smtp_accepted');self.assertTrue(second['reused'])
            smtp.send_message.assert_called_once()
            self.assertEqual(smtp.send_message.call_args.kwargs['to_addrs'],['test@example.com'])
    def test_ambiguous_smtp_failure_is_held_without_retry(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);self.setup_folder(folder);factory=MagicMock();smtp=factory.return_value.__enter__.return_value;smtp.send_message.side_effect=smtplib.SMTPServerDisconnected('do not log raw transport data')
            receipt=send_once(folder,'test','test@example.com','sender@example.com','fake','smtp.example.com',smtp_factory=factory)
            self.assertEqual(receipt['status'],'unknown_do_not_retry')
            send_once(folder,'test','test@example.com','sender@example.com','fake','smtp.example.com',smtp_factory=factory)
            smtp.send_message.assert_called_once()
    def test_credential_like_text_is_not_emailed(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);out=self.setup_folder(folder)
            (out/'email.html').write_text('【测试】'+'sk-'+'x'*32)
            with self.assertRaises(ValueError):prepare(folder,'test','test@example.com','sender@example.com')
    def test_missing_test_label_blocks_delivery(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);out=self.setup_folder(folder);(out/'email.html').write_text('no test label')
            with self.assertRaises(ValueError):prepare(folder,'test','test@example.com','sender@example.com')
    def test_musk_article_slug_is_not_an_api_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);out=self.setup_folder(folder)
            (out/'email.html').write_text('【测试】https://example.com/elon-musk-space-technology-development-news')
            prepare(folder,'test','test@example.com','sender@example.com')

if __name__=='__main__':unittest.main()
