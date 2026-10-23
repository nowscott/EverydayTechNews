import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('enable_continuous', Path(__file__).parents[1] / 'enable-continuous.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

class ContinuousConfigurationTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.data=self.root/'data';self.data.mkdir();(self.data/'durable').mkdir();(self.data/'deliveries').mkdir()
  shutil.copyfile(Path(__file__).parents[1]/'manage.py',self.root/'manage.py')
  self.old={'mode':'internal_test','allowed_recipient':'nowscott@qq.com','production_enabled':False,'daily_budget_cny':2,'enabled':True,'model_enabled':True,'delivery_enabled':True,'days':7,'expires_at':'2026-10-26T00:00:00+08:00'}
  for p,v in [(self.root/'config.json',{'data':str(self.data),'scheduler_lock':str(self.root/'scheduler.lock')}),(self.root/'deployment.json',{'active':{'tag':'news-engine-v0.6.0','image':'fake'},'history':[]}),(self.data/'trial.json',self.old),(self.data/'.nas-authority.json',{}),(self.data/'durable/state.json',{'tables':{'calls':[{'cost':0.3}],'issues':[{'id':'frozen'}]}})]:p.write_text(json.dumps(v))
 def tearDown(self):self.tmp.cleanup()
 def test_only_configuration_changes_and_repeat_is_idempotent(self):
  before=(self.data/'durable/state.json').read_bytes()
  with patch('subprocess.run',return_value=subprocess.CompletedProcess([],0,stdout='continuous_config_validated')):r=m.enable(self.root)
  self.assertEqual(r['status'],'continuous_enabled');self.assertTrue(r['ledger_unchanged']);self.assertEqual((self.data/'durable/state.json').read_bytes(),before)
  v=json.loads((self.data/'trial.json').read_text());self.assertIsNone(v['expires_at']);self.assertFalse(v['production_enabled']);self.assertEqual(v['allowed_recipient'],self.old['allowed_recipient']);self.assertEqual(m.enable(self.root)['status'],'already_continuous')
 def test_old_engine_cannot_enable_continuous(self):
  (self.root/'deployment.json').write_text(json.dumps({'active':{'tag':'news-engine-v0.5.0','image':'fake'}}))
  with self.assertRaisesRegex(RuntimeError,'requires_engine'):m.enable(self.root)
  self.assertEqual(json.loads((self.data/'trial.json').read_text()),self.old)
 def test_failed_offline_validation_restores_only_configuration(self):
  with patch('subprocess.run',return_value=subprocess.CompletedProcess([],1,stdout='')):
   with self.assertRaisesRegex(RuntimeError,'command_failed'):m.enable(self.root)
  self.assertEqual(json.loads((self.data/'trial.json').read_text()),self.old)

if __name__=='__main__':unittest.main()
