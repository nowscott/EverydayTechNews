import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import urllib.error
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('nas_manage', Path(__file__).parents[1] / 'manage.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.data = self.root / 'data'
        (self.data / 'durable').mkdir(parents=True)
        (self.data / 'deliveries').mkdir()
        m.atomic(self.data / 'durable/state.json', {'schema_version': 1, 'tables': {'calls': [{'id': 1, 'cost': .1}], 'issues': []}})
        (self.data / 'deliveries/a.json').write_text('{"status":"smtp_accepted"}')
        self.config = {'data': str(self.data), 'scheduler_lock': str(self.root / 'scheduler.lock'), 'env_file': str(self.root / '.env')}
        m.atomic(self.root / 'config.json', self.config)
        self.c = m.Controller(self.root)
        self.old = {'tag': 'news-engine-v0.4.0', 'image': 'sha256:old', 'sha': 'a' * 40, 'source': str(self.root / 'old')}
        self.new = {'tag': 'news-engine-v0.4.1', 'image': 'sha256:new', 'sha': 'b' * 40, 'source': str(self.root / 'new')}
        m.atomic(self.c.state_path, {'active': self.old, 'history': [self.old], 'blocked': {}, 'high_water': [0, 4, 0]})

    def tearDown(self): self.temp.cleanup()

    def test_release_filter(self):
        def release(tag, **kw): return {'tag_name': tag, 'published_at': '2026-10-19', **kw}
        rows = [release('v3.0.0'), release('news-engine-v0.4.2', draft=True), release('news-engine-v0.4.3', prerelease=True),
                release('news-engine-v0.4.1'), release('news-engine-v0.5.0-rc1')]
        self.assertEqual(m.choose(rows, (0, 4, 0))['tag_name'], 'news-engine-v0.4.1')
        self.assertIsNone(m.choose(rows, (0, 4, 1)))
        self.assertIsNone(m.version('news-engine-v00.4.0'))

    def test_private_controller_proxy_is_used_without_logging_credentials(self):
        proxy = self.root / 'proxy.env'
        proxy.write_text('HTTPS_PROXY=http://user:password@127.0.0.1:7893\nNO_PROXY=localhost\n')
        proxy.chmod(0o600)
        with patch.dict(os.environ, {}, clear=True):
            c = m.Controller(self.root)
            self.assertEqual(os.environ['https_proxy'], 'http://user:password@127.0.0.1:7893')
            with patch.object(m.subprocess, 'run') as run:
                run.return_value.returncode = 1
                with self.assertRaisesRegex(RuntimeError, 'command_failed:git'): c.command(['git', 'fetch'])
                self.assertEqual(run.call_args.kwargs['stderr'], m.subprocess.DEVNULL)
            self.assertNotIn('password', (self.root / 'logs/commands.log').read_text())
        proxy.chmod(0o644)
        with self.assertRaisesRegex(RuntimeError, 'proxy_config_permissions_invalid'): m.Controller(self.root)

    def test_shanghai_window_boundaries(self):
        for hour, expected in [(3, False), (4, True), (8, True), (9, False)]:
            self.assertEqual(m.protected(dt.datetime(2026, 10, 19, hour, tzinfo=m.SHANGHAI)), expected)

    def test_schema_and_manual_migration_gate(self):
        value = {'component': 'news-engine', 'state_schema': 1, 'controller_protocol': 1, 'automatic_deployment': True}
        self.assertTrue(m.compatible(value, 1)); self.assertFalse(m.compatible(value, 2))
        self.assertFalse(m.compatible({**value, 'automatic_deployment': False}, 1))

    def test_lock_excludes_overlapping_scheduler(self):
        with m.lock(Path(self.config['scheduler_lock'])):
            with m.lock(Path(self.config['scheduler_lock']), blocking=False) as acquired:
                self.assertFalse(acquired)
            self.assertEqual(self.c.run()['status'], 'scheduler_busy')

    def test_morning_defers_without_build(self):
        with patch.object(self.c, 'api', return_value=[{'tag_name': self.new['tag'], 'published_at': 'now'}]), patch.object(m, 'protected', return_value=True), patch.object(self.c, 'build') as build:
            self.assertEqual(self.c.update()['status'], 'deferred_morning_window'); build.assert_not_called()
        self.assertEqual(self.c.state()['active'], self.old)

    def test_build_failure_keeps_old_and_blocks_retry(self):
        with patch.object(self.c, 'api', return_value=[{'tag_name': self.new['tag'], 'published_at': 'now'}]), patch.object(m, 'protected', return_value=False), patch.object(self.c, 'source', return_value=('b' * 40, self.root)), patch.object(self.c, 'build', side_effect=RuntimeError('build_failed')) as build:
            self.assertEqual(self.c.update()['status'], 'deployment_failed')
            self.assertEqual(self.c.update()['status'], 'blocked_release'); self.assertEqual(build.call_count, 1)
        self.assertEqual(self.c.state()['active'], self.old)

    def test_validation_failure_preserves_live_state_and_active(self):
        before = m.ledger(self.data)
        with patch.object(m, 'protected', return_value=False), patch.object(self.c, 'validate', side_effect=RuntimeError('bad_snapshot')):
            with self.assertRaisesRegex(RuntimeError, 'bad_snapshot'): self.c.activate(self.new)
        self.assertEqual(self.c.state()['active'], self.old); self.assertEqual(m.ledger(self.data), before)
        self.assertEqual(len(list((self.root / 'backups').glob('*/state.tar.gz'))), 1)

    def test_activate_and_rollback_preserve_new_billing(self):
        before = m.ledger(self.data)
        with patch.object(m, 'protected', return_value=False), patch.object(self.c, 'validate'), patch.object(self.c, 'prune'):
            self.assertEqual(self.c.activate(self.new)['status'], 'deployed')
            self.assertEqual(m.ledger(self.data), before)
            state = m.read(self.data / 'durable/state.json'); state['tables']['calls'].append({'id': 2, 'cost': .2})
            m.atomic(self.data / 'durable/state.json', state)
            updated = m.ledger(self.data)
            self.assertEqual(self.c.rollback(self.old['tag'])['status'], 'rolled_back')
        self.assertEqual(m.ledger(self.data), updated)
        self.assertEqual(self.c.state()['high_water'], [0, 4, 1])
        self.assertEqual(self.c.state()['active']['image'], 'sha256:old')

    def test_changed_live_ledger_prevents_switch(self):
        def change(*_):
            state = m.read(self.data / 'durable/state.json'); state['tables']['calls'].append({'id': 99})
            m.atomic(self.data / 'durable/state.json', state)
        with patch.object(m, 'protected', return_value=False), patch.object(self.c, 'validate', side_effect=change):
            with self.assertRaisesRegex(RuntimeError, 'live_ledger_changed'): self.c.activate(self.new)
        self.assertEqual(self.c.state()['active'], self.old)

    def test_window_rechecked_after_validation(self):
        with patch.object(m, 'protected', side_effect=[False, True]), patch.object(self.c, 'validate'):
            self.assertEqual(self.c.activate(self.new)['status'], 'deferred_morning_window')
        self.assertEqual(self.c.state()['active'], self.old)

    def test_cleanup_failure_does_not_revert_successful_activation(self):
        with patch.object(m, 'protected', return_value=False), patch.object(self.c, 'validate'), patch.object(self.c, 'prune', side_effect=RuntimeError('cleanup')):
            self.assertEqual(self.c.activate(self.new)['status'], 'deployed')
        self.assertEqual(self.c.state()['active']['image'], self.new['image'])

    def test_switch_waits_for_running_news_task(self):
        checked = threading.Event()
        def validate(*_): checked.set()
        outcome = []
        with patch.object(m, 'protected', return_value=False), patch.object(self.c, 'validate', side_effect=validate), patch.object(self.c, 'prune'):
            with m.lock(Path(self.config['scheduler_lock'])):
                thread = threading.Thread(target=lambda: outcome.append(self.c.activate(self.new)))
                thread.start()
                self.assertFalse(checked.wait(.05))
                self.assertEqual(self.c.state()['active'], self.old)
            thread.join(timeout=3)
        self.assertFalse(thread.is_alive())
        self.assertEqual(outcome[0]['status'], 'deployed')

    def test_transient_github_api_error_does_not_block_release(self):
        with patch.object(self.c, 'api', return_value=[{'tag_name': self.new['tag'], 'published_at': 'now'}]), patch.object(m, 'protected', return_value=False), patch.object(self.c, 'source', side_effect=urllib.error.URLError('offline')):
            self.assertEqual(self.c.update()['status'], 'release_check_failed')
        self.assertEqual(self.c.state()['blocked'], {})
        self.assertEqual(self.c.state()['active'], self.old)

    def test_news_runner_has_no_short_control_command_timeout(self):
        def command(args, **kwargs):
            if args[:3] == ['git', 'rev-parse', 'HEAD']: return self.old['sha']
            if args[0] == 'git': return ''
            self.assertEqual(args[0:2], ['docker', 'compose'])
            self.assertIsNone(kwargs['timeout'])
            self.assertEqual(kwargs['env']['NAS_IMAGE'], self.old['image'])
            return ''
        with patch.object(self.c, 'command', side_effect=command) as run:
            self.c.run()
        self.assertEqual(run.call_count, 3)

    def test_failed_runtime_release_is_excluded_from_rollback_history(self):
        state = self.c.state()
        state['history'][0]['runtime_failed'] = True
        state['blocked'][self.old['tag']] = 'runtime_startup_invalid'
        m.atomic(self.c.state_path, state)
        with self.assertRaisesRegex(RuntimeError, 'quarantined'): self.c.rollback(self.old['tag'])
        with patch.object(m, 'protected', return_value=False), patch.object(self.c, 'validate'), patch.object(self.c, 'prune'):
            self.c.activate(self.new)
        self.assertEqual([h['tag'] for h in self.c.state()['history']], [self.new['tag']])

    def test_startup_uses_empty_credentials_and_disabled_network(self):
        def command(args, **kwargs):
            self.assertEqual(args[:2], ['docker', 'compose'])
            self.assertEqual(Path(kwargs['env']['NAS_ENV_FILE']).read_text(), '')
            self.assertEqual(kwargs['env']['NAS_IMAGE'], self.new['image'])
            overlay = Path(args[args.index('run') - 1])
            self.assertIn('network_mode: none', overlay.read_text())
            self.assertEqual(args[-4:], ['--entrypoint', 'node', 'premium', '--version'])
            return 'v24'
        with patch.object(self.c, 'command', side_effect=command): self.c.startup(self.new, self.data)

    def test_release_must_pass_main_ci(self):
        def command(args, **_):
            if 'rev-parse' in args: return 'b' * 40
            return ''
        with patch.object(self.c, 'command', side_effect=command), patch.object(self.c, 'api', return_value={'workflow_runs': [{'head_sha': 'b' * 40, 'head_branch': 'main', 'event': 'push', 'status': 'completed', 'conclusion': 'failure'}]}):
            with self.assertRaisesRegex(RuntimeError, 'checks_not_passed'): self.c.source(self.new['tag'])


if __name__ == '__main__': unittest.main()
