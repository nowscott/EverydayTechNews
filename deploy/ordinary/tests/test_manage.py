import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('ordinary_manage',Path(__file__).parents[1]/'manage.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class OrdinaryControllerTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.data=self.root/'data';self.data.mkdir(mode=0o700)
  with sqlite3.connect(self.data/'state.sqlite3') as db:
   db.execute('CREATE TABLE issues(id TEXT PRIMARY KEY,data TEXT)');db.execute('CREATE TABLE deliveries(id TEXT PRIMARY KEY,data TEXT)');db.execute('INSERT INTO deliveries VALUES (?,?)',('a','smtp_accepted'));db.commit()
  m.base.atomic(self.root/'config.json',{'data':str(self.data),'scheduler_lock':str(self.root/'scheduler.lock'),'env_file':str(self.root/'ordinary.env'),'component':'ordinary-news','state_lock':'runtime.lock'})
  self.c=m.Controller(self.root)
 def tearDown(self):self.temp.cleanup()
 def test_release_namespace_is_separate(self):
  self.assertIsNone(m.base.version('news-engine-v0.5.0'));self.assertEqual(m.base.version('ordinary-news-v1.0.0'),(1,0,0))
  self.assertFalse(m.base.compatible({'component':'news-engine','state_schema':1,'controller_protocol':1,'automatic_deployment':True},1,'ordinary-news'))
 def test_sqlite_backup_is_complete_and_ledger_unchanged(self):
  before=self.c.ledger();snapshot=self.root/'snapshot';self.c.snapshot(snapshot)
  with sqlite3.connect(snapshot/'state.sqlite3') as db:self.assertEqual(db.execute('SELECT data FROM deliveries').fetchone()[0],'smtp_accepted')
  self.assertEqual(self.c.ledger(),before)
 def test_state_mutation_during_validation_refuses_switch(self):
  candidate={'tag':'ordinary-news-v1.0.0','image':'test','sha':'a'*40,'source':str(self.root)}
  def change(*_):
   with sqlite3.connect(self.data/'state.sqlite3') as db:db.execute('INSERT INTO deliveries VALUES (?,?)',('b','unknown'));db.commit()
  with patch.object(m.base,'protected',return_value=False),patch.object(self.c,'validate',side_effect=change):
   with self.assertRaisesRegex(RuntimeError,'ledger_changed'):self.c.activate(candidate)
  self.assertIsNone(self.c.state()['active'])
 def test_scheduler_lock_is_independent(self):
  with m.base.lock(self.root/'scheduler.lock'):self.assertEqual(self.c.run()['status'],'scheduler_busy')
 def test_scheduler_passes_mounted_state_path(self):
  candidate={'tag':'ordinary-news-v1.0.3','image':'pinned','sha':'a'*40,'source':str(self.root)}
  m.base.atomic(self.c.state_path,{'active':candidate,'history':[candidate]})
  def command(args,**kwargs):
   if args[:2]==['git','rev-parse']:return candidate['sha']
   if args[:2]==['git','status']:return ''
   self.assertEqual(args[-4:],['ordinary','run','--data','/data'])
   self.assertEqual(kwargs['env']['ORDINARY_ROOT'],str(self.root.resolve().parent));return ''
  with patch.object(self.c,'command',side_effect=command):self.c.run()
 def test_startup_is_network_and_credential_free(self):
  def check(args,**kwargs):
   self.assertEqual(args[:2],['docker','compose'])
   self.assertEqual(Path(kwargs['env']['ORDINARY_ROOT'],'ordinary.env').read_text(),'')
   overlay=Path(args[args.index('run')-1]);self.assertIn('network_mode: none',overlay.read_text())
   self.assertEqual(args[-2:],['ordinary','--version']);return 'v24'
  with patch.object(self.c,'command',side_effect=check):self.c.startup({'image':'pinned','source':str(self.root)},self.data)

if __name__=='__main__':unittest.main()
