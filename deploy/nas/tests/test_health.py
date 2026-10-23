import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('health_check',Path(__file__).parents[1]/'health-check.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class HealthInstallTests(unittest.TestCase):
 def test_install_preserves_news_cron_and_deduplicates_only_its_own_line(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp).resolve();shutil.copyfile(Path(__file__).parents[1]/'manage.py',root/'manage.py')
   (root/'config.json').write_text(json.dumps({'data':str(root/'data')}));(root/'deployment.json').write_text(json.dumps({'active':{'tag':'news-engine-v0.6.1','sha':'a'*40}}))
   old='7,37 * * * * premium-news-run\n* * * * * ordinary-news-run\n10 9-23 * * * python '+str(root/'health-check.py')+' check\n';written=[]
   def command(args,**kwargs):
    self.assertEqual(args[0],'crontab')
    if args[-1]=='-l':return subprocess.CompletedProcess(args,0,stdout=old)
    written.append(kwargs['input']);return subprocess.CompletedProcess(args,0,stdout='')
   with patch('subprocess.run',side_effect=command):result=m.install(root)
   self.assertEqual(result['status'],'health_installed_on_nas');self.assertIn('premium-news-run',written[0]);self.assertIn('ordinary-news-run',written[0]);self.assertEqual(written[0].count(str(root/'health-check.py')),1)
