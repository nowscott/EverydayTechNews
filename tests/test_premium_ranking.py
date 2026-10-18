import copy
from datetime import datetime, timedelta
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch,Mock

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'experiments/premium'))
import brief as b
from ranking import evaluate,choose
from email_layout import build_email

CLOCK=datetime.fromisoformat('2026-10-18T10:00:00+08:00')
def article(source='ithome',title='大模型正式发布',id='one'):
    return dict(id=id,url='https://example.org/'+id,source=source,source_name=source,title=title,published_at='2026-10-18T04:00:00+08:00',fetched_at='2026-10-18T04:30:00+08:00',text='公司计划在中国测试这一人工智能模型，尚未独立验证。'*30,content_status='usable_excerpt',content_origin='rss_content_encoded',content_fingerprint=id,topic='AI')
def permit(issue='sample-unit'):
    return dict(mode='internal_test_anytime',issue_id=issue,expires_at='2026-10-18T23:59:59+08:00')

class EditorialTests(unittest.TestCase):
    def test_cross_source_score_uses_evidence_not_it_votes(self):
        a=article(source='github');score=evaluate(a,CLOCK)
        self.assertGreater(score['score'],58);self.assertIn('breakdown',score)
        a['it_votes']=999999
        self.assertEqual(score,evaluate(a,CLOCK))
    def test_cosmetic_gaming_is_below_core_ai(self):
        core=evaluate(article(),CLOCK)['score']
        low=evaluate(article(title='游戏皮肤拼写错误将修复'),CLOCK)['score']
        self.assertGreater(core,low+15)
    def test_quality_same_source_is_not_excluded_to_force_diversity(self):
        candidates=[article(id=str(i)) for i in range(10)]
        selected,rejected=choose(candidates,CLOCK)
        self.assertEqual(len(selected),10)
        self.assertNotIn('source_diversity_cap',[r['reason'] for r in rejected])
    def test_discovery_never_becomes_generatable_by_high_topic_score(self):
        a=article();a['content_status']='discovery_only'
        self.assertEqual(evaluate(a,CLOCK)['score'],0)
    def test_low_quality_does_not_fill_daily_quota(self):
        a=article(title='周末生活记录');a['text']='日常生活记录'*40
        selected,_=choose([a],CLOCK)
        self.assertEqual(selected,[])
    def test_old_story_scores_lower(self):
        a=article();old=copy.deepcopy(a);old['published_at']='2026-10-10T00:00:00+08:00'
        self.assertGreater(evaluate(a,CLOCK)['score'],evaluate(old,CLOCK)['score'])
    def test_test_permit_is_explicit_expiring_and_not_production(self):
        p=b.load_policy()
        self.assertIsNotNone(b.gate(p,CLOCK,True))
        self.assertIsNone(b.gate(p,CLOCK,True,permit()))
        self.assertIsNotNone(b.gate(p,CLOCK,False,permit()))
        self.assertIsNotNone(b.gate(p,CLOCK,True,permit('2026-10-18')))
        expired=permit();expired['expires_at']='2026-10-18T09:00:00+08:00'
        self.assertIsNotNone(b.gate(p,CLOCK,True,expired))
    def test_peak_estimate_doubles_cost_without_assuming_holiday(self):
        usage=dict(prompt_tokens=1000,completion_tokens=100)
        self.assertEqual(b.cost(usage,b.load_policy(),2),2*b.cost(usage,b.load_policy()))
    def test_daily_runner_has_no_time_override(self):
        root=Path(__file__).resolve().parents[1]
        self.assertNotIn('--test-anytime',(root/'experiments/premium/run_trial.py').read_text())
        for file in (root/'.github/workflows').glob('*.yml'):
            self.assertNotIn('--test-anytime',file.read_text())
    def test_excess_points_are_limited_without_another_paid_call(self):
        a=article()
        r=dict(title='模型发布',summary='模型计划在中国测试。',points=['一','二','三','四'],why='',uncertainties=[],claims=[dict(claim='测试',evidence='公司计划在中国测试这一人工智能模型')])
        out=b.validate(r,a)
        self.assertEqual(out['points'],['一','二','三'])
        self.assertEqual(out['program_edits'][0]['original_count'],4)
    def test_english_title_must_be_chinese_in_same_completion(self):
        a=article(title='New AI model')
        r=dict(title='New model',summary='模型已发布。',points=[],why='',uncertainties=[],claims=[dict(claim='测试',evidence='公司计划在中国测试这一人工智能模型')])
        with self.assertRaises(ValueError):b.validate(r,a)
        r['title']='新模型发布';b.validate(r,a)
    def test_evidence_line_wrapping_is_not_a_false_rewrite(self):
        a=article();a['text']='The new\nAI model\nhas been released.'
        r=dict(title='新 AI 模型发布',summary='模型已发布。',points=[],why='',uncertainties=[],claims=[dict(claim='模型发布',evidence='The new AI model has been released.')])
        self.assertEqual(b.validate(r,a),r)
    def test_ai_email_excludes_failed_or_untranslated_candidates_and_discovery(self):
        issue=dict(collection_cutoff=CLOCK.isoformat(),mode='historical_quality_sample',discovery_leads=[article(title='English discovery')])
        valid=dict(title='自然中文标题',summary='这是模型精编摘要。',points=[],why='')
        records=[dict(article=article(title='Untranslated failed item'),result=None,calls=[dict(id=1)]),dict(article=article(title='English source'),result=valid,calls=[dict(id=2)])]
        doc,plain=build_email(issue,records)
        self.assertIn('自然中文标题',doc)
        self.assertNotIn('Untranslated failed item',doc)
        self.assertNotIn('English discovery',doc)
        self.assertNotIn('海外选题雷达',doc)
        self.assertIn('本期 1 条',plain)

if __name__=='__main__':unittest.main()
