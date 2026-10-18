import copy
from datetime import datetime,timedelta
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch,Mock,MagicMock

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'experiments/premium'))
import brief as b
import pool
from durable import Store,atomic
from ranking import evaluate,preferences
from schedule import due
from adapters import parse_atom,parse_tesla
from test_delivery import send_once

CLOCK=datetime.fromisoformat('2026-10-18T06:35:00+08:00')


def article(i=0):
    text=f'证据段落编号{i}：公司计划在中国测试芯片，性能数字为公司自述，尚未独立验证。'+'这是一段实际获取的正文证据。'*30
    return dict(id=str(i),title=f'AI研究编号{i}新进展',url=f'https://www.ithome.com/a/{i}',
        source='ithome',source_name='IT之家',published_at='2026-10-18T04:00:00+08:00',
        original_article_published_at='2026-10-18T04:00:00+08:00',published_time_kind='rss_article_publication',
        fetched_at='2026-10-18T05:45:00+08:00',text=text,content_fingerprint=b.digest(text),
        content_status='usable_excerpt',content_origin='rss_description',topic='AI',event_time=None,output_schema='dual-1')


def generated(a):
    return dict(title='芯片计划在中国测试',summary='公司计划在中国测试芯片，性能数据来自公司自述。',
        short_summary='公司计划在中国测试芯片，性能数据尚未独立验证。',points=[],why='',uncertainties=[],
        claims=[dict(claim='计划测试',evidence='公司计划在中国测试芯片')],generated_at='2026-10-18T06:10:00+08:00')


class PoolTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.time=patch.object(b,'now',return_value=CLOCK);self.time.start()
        self.s=Store(self.root);pool.initialize(self.s)
        config=json.loads((self.root/'trial.json').read_text())
        config.update(start='2026-10-18',expires_at='2026-10-25T00:00:00+08:00',enabled=True,model_enabled=True,delivery_enabled=True)
        atomic(self.root/'trial.json',config)
    def tearDown(self):
        self.s.db.close();self.time.stop();self.temp.cleanup()
    def insert(self,a,ready=False):
        key=b.cache_key(a,b.load_policy())
        with self.s.db:
            self.s.db.execute('INSERT INTO articles VALUES (?,?,?)',(a['id'],a['content_fingerprint'],json.dumps(a)))
            if ready:self.s.db.execute('INSERT INTO jobs(key,article,status,result) VALUES (?,?,?,?)',(key,json.dumps(a),'pending_human_review',json.dumps(generated(a))))
        return key
    def restart(self):
        self.s.checkpoint();self.s.db.close();self.s=Store(self.root)
    def test_roundtrip_without_sqlite_keeps_jobs_and_original_body_out_of_git(self):
        a=article();self.insert(a,True);self.s.checkpoint()
        saved=(self.root/'durable/state.json').read_text()
        self.assertNotIn(a['text'],saved);self.assertIn('公司计划在中国测试芯片',saved)
        self.s.db.close();(self.root/'state.sqlite3').unlink();self.s=Store(self.root)
        self.assertEqual(pool.rows(self.s)[0]['text'],a['text'])
        self.assertEqual(self.s.db.execute('SELECT COUNT(*) FROM jobs WHERE result IS NOT NULL').fetchone()[0],1)
    def test_evidence_expiry_preserves_results_but_prevents_new_generation(self):
        self.insert(article(),True);self.s.checkpoint()
        for entry in self.s.objects.values():entry['expires_at']='2026-10-17T00:00:00+08:00'
        self.s.expire();self.s.db.close();self.s=Store(self.root)
        self.assertEqual(pool.rows(self.s)[0]['text'],'')
        self.assertTrue(pool.rows(self.s)[0]['evidence_expired_or_missing'])
        self.assertIsNotNone(self.s.db.execute('SELECT result FROM jobs').fetchone()[0])
        self.assertEqual(pool.candidates(self.s,CLOCK)[0],[])
    def test_evidence_hash_tampering_fails_closed(self):
        self.insert(article());self.s.checkpoint()
        next((self.root/'transient/bodies').glob('*.json')).write_text('tampered')
        self.s.db.close()
        with self.assertRaisesRegex(ValueError,'integrity'):self.s=Store(self.root)
    def test_rescoring_is_independent_and_does_not_duplicate_jobs(self):
        self.insert(article());pool.assess(self.s);pool.assess(self.s)
        self.assertEqual(self.s.db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],1)
        self.assertEqual(self.s.db.execute('SELECT COUNT(*) FROM issues').fetchone()[0],0)
    def test_dual_output_schema_changes_cache_without_relabelling_legacy(self):
        a=article();old=copy.deepcopy(a);old.pop('output_schema')
        self.assertNotEqual(b.cache_key(a,b.load_policy()),b.cache_key(old,b.load_policy()))
        result=generated(a);del result['short_summary']
        with self.assertRaises(ValueError):b.validate(result,a)
        b.validate(result,old)
    def test_interests_have_equal_non_cumulative_bonus(self):
        bonuses=[]
        for title in ['AI new release','Apple new release','NVIDIA new release','Tesla new release','SpaceX new release','NVIDIA AI new release']:
            a=article();a['title']=title
            bonuses.append(evaluate(a,CLOCK)['breakdown']['interest_bonus'])
        self.assertEqual(bonuses,[12]*6)
    def test_same_brand_distinct_events_are_not_merged(self):
        a=article();c=article(1)
        a['title']='NVIDIA RTX Spark arrives globally';c['title']='NVIDIA RTX Spark security vulnerability affects Linux driver'
        self.assertFalse(b.duplicate(a,c))
    def test_fifteen_ready_articles_form_five_leads_ten_briefs(self):
        for i in range(15):self.insert(article(i),True)
        # Distinct fixtures intentionally bypass textual clustering; test only edition lifecycle.
        with patch.object(b,'duplicate',return_value=False):issue=pool.compose(self.s)
        self.assertEqual(issue['kind'],'newsletter');self.assertEqual(len(issue['articles']),15)
        doc=(self.root/'issues/test-2026-10-18/email.html').read_text()
        self.assertIn('今日重点',doc);self.assertIn('精编短讯',doc)
        self.assertEqual(doc.count('阅读原文 ↗'),15)
        self.assertNotIn(article()['text'],(self.root/'issues/test-2026-10-18/comparison.json').read_text())
    def test_shortage_is_diagnostic_and_preserves_draft(self):
        self.insert(article(),True);issue=pool.compose(self.s)
        self.assertEqual(issue['kind'],'diagnostic');self.assertEqual(issue['shortfall'],14)
        self.assertIn('异常诊断',(self.root/'issues/test-2026-10-18/email.html').read_text())
        self.assertTrue((self.root/'transient/drafts/test-2026-10-18/email.html').exists())
    def test_composition_never_mutates_frozen_edition_or_calls_model(self):
        self.insert(article(),True)
        with patch.object(b.requests,'post') as request:
            before=pool.compose(self.s);self.insert(article(2),True);after=pool.compose(self.s)
            self.assertEqual(before,after);request.assert_not_called()
    def test_post_cutoff_article_and_post_deadline_ai_are_excluded(self):
        a=article();a['fetched_at']='2026-10-18T06:01:00+08:00';self.insert(a,True)
        c=article(2);key=self.insert(c,True);g=generated(c);g['generated_at']='2026-10-18T06:16:00+08:00'
        with self.s.db:self.s.db.execute('UPDATE jobs SET result=? WHERE key=?',(json.dumps(g),key))
        issue=pool.compose(self.s)
        self.assertEqual(len(issue['articles']),0)
        self.assertIn('generated_after_deadline',[r['reason'] for r in issue['rejected']])
    def test_failed_draft_does_not_consume_article(self):
        self.insert(article(),True);pool.compose(self.s)
        self.assertEqual(len(pool.candidates(self.s,CLOCK)[0]),1)
    def test_recovery_holds_inflight_and_keeps_reserved_budget(self):
        key=self.insert(article())
        with self.s.db:
            self.s.db.execute('INSERT INTO jobs(key,article,status) VALUES (?,?,?)',(key,json.dumps(article()),'inflight'))
            self.s.db.execute('INSERT INTO calls(day,job,reserved,status) VALUES (?,?,?,?)',('2026-10-18',key,.1,'reserved'))
        pool.reconcile(self.s)
        self.assertEqual(self.s.db.execute('SELECT status FROM jobs').fetchone()[0],'uncertain_requires_review')
        self.assertIsNone(self.s.db.execute('SELECT cost FROM calls').fetchone()[0])
    def test_remote_checkpoint_failure_stops_paid_transport(self):
        a=article();key=self.insert(a)
        with self.s.db:self.s.db.execute('INSERT INTO jobs(key,article,status) VALUES (?,?,?)',(key,json.dumps(a),'queued'))
        permit=dict(mode='internal_test_anytime',issue_id='test-pool',expires_at='2026-10-25T00:00:00+08:00')
        with patch.object(b,'verify_rules',return_value=True),patch.dict(os.environ,{'DEEPSEEK_API_KEY':'fake'}),patch.object(b.requests,'post') as transport:
            with self.assertRaises(OSError):b.paid_request(self.s.db,key,a,b.load_policy(),permit,checkpoint=Mock(side_effect=OSError('unavailable')))
            transport.assert_not_called()
    def test_daily_unique_version_limit_and_completed_cache(self):
        a=article();key=self.insert(a,True)
        for i in range(32):
            with self.s.db:self.s.db.execute('INSERT INTO calls(day,job,reserved,cost,status) VALUES (?,?,?,?,?)',('2026-10-18','used'+str(i),0,0,'ok'))
        c=article(1);self.insert(c);pool.assess(self.s)
        with patch.dict(os.environ,{'DEEPSEEK_API_KEY':'fake'}),patch.object(b,'paid_request') as request,patch.object(b,'duplicate',return_value=False):pool.enrich(self.s)
        request.assert_not_called()
    def test_missing_key_does_not_fabricate_usage(self):
        self.insert(article());pool.assess(self.s)
        with patch.dict(os.environ,{'DEEPSEEK_API_KEY':''}):self.assertEqual(pool.enrich(self.s)['status'],'missing_api_key')
        self.assertEqual(self.s.db.execute('SELECT COUNT(*) FROM calls').fetchone()[0],0)
    def test_trial_expiry_blocks_manual_enrich_and_delivery(self):
        with patch.object(b,'now',return_value=datetime.fromisoformat('2026-10-25T06:35:00+08:00')),patch.object(b.requests,'post') as request:
            self.assertIn('expired',pool.enrich(self.s)['status']);self.assertIn('expired',pool.deliver(self.s)['status']);request.assert_not_called()
    def test_delayed_scheduler_composes_then_delivers_and_never_enriches_late(self):
        flags=due(self.root,CLOCK)
        self.assertTrue(flags['compose']);self.assertTrue(flags['deliver']);self.assertFalse(flags['enrich'])
        late=due(self.root,CLOCK.replace(hour=7,minute=1))
        self.assertFalse(late['deliver'])
        early=due(self.root,CLOCK.replace(hour=5,minute=55))
        self.assertTrue(early['collect']);self.assertTrue(early['enrich'])
    def test_smtp_checkpoint_failure_prevents_connection(self):
        self.insert(article(),True);pool.compose(self.s);factory=MagicMock()
        with self.assertRaises(RuntimeError):send_once(self.root,'test-2026-10-18','nowscott@qq.com','sender@example.com','fake','smtp.example',smtp_factory=factory,checkpoint=Mock(side_effect=RuntimeError('remote failed')))
        factory.assert_not_called()
    def test_delivery_is_held_after_content_edit(self):
        self.insert(article(),True);pool.compose(self.s);factory=MagicMock();factory.return_value.__enter__.return_value.send_message.return_value={}
        send_once(self.root,'test-2026-10-18','nowscott@qq.com','sender@example.com','fake','smtp.example',smtp_factory=factory)
        path=self.root/'issues/test-2026-10-18/email.txt';path.write_text(path.read_text()+' corrected')
        r=send_once(self.root,'test-2026-10-18','nowscott@qq.com','sender@example.com','fake','smtp.example',smtp_factory=factory)
        self.assertTrue(r['reused']);self.assertEqual(factory.call_count,1)
    def test_atom_updated_is_not_original_publication(self):
        raw='<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Apple release</title><link href="https://www.apple.com/newsroom/2026/10/new/"/><updated>2026-10-18T01:00:00Z</updated><content>short</content></entry></feed>'
        a=parse_atom(raw,CLOCK.isoformat())[0]
        self.assertEqual(a['content_status'],'discovery_only');self.assertIsNone(a['original_article_published_at'])
        self.assertEqual(a['published_time_kind'],'atom_update_not_publication')
    def test_tesla_listing_without_article_timestamp_is_discovery(self):
        a=parse_tesla('<a href="/press-release/new-product">New product</a>',CLOCK.isoformat())[0]
        self.assertIsNone(a['original_article_published_at']);self.assertEqual(a['content_status'],'discovery_only')
    def test_seven_day_report_does_not_count_diagnostic_as_completed_newsletter(self):
        self.insert(article(),True);pool.compose(self.s)
        report=pool.report_trial(self.s)
        self.assertEqual(report['completed_normal_editions'],0);self.assertEqual(len(report['days']),7)


if __name__=='__main__':unittest.main()
