#!/usr/bin/env python3
"""Independent ordinary NAS controller, using the tested Python release controller."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile

local = Path(__file__).resolve().parent
base_path = local / 'base-manage.py'
if not base_path.exists(): base_path = local.parent / 'nas/manage.py'
spec = importlib.util.spec_from_file_location('ordinary_release_base', base_path)
base = importlib.util.module_from_spec(spec); spec.loader.exec_module(base)
base.PREFIX = 'ordinary-news-v'

class Controller(base.Controller):
    def schema(self): return 1

    def ledger(self):
        path = self.data / 'state.sqlite3'
        if not path.exists(): return hashlib.sha256(b'empty').hexdigest()
        digest = hashlib.sha256()
        with sqlite3.connect('file:' + str(path) + '?mode=ro', uri=True) as db:
            for table in ['issues', 'deliveries']:
                digest.update((table + '\0').encode())
                for row in db.execute('SELECT * FROM ' + table + ' ORDER BY id'):
                    digest.update((json.dumps(row, separators=(',', ':')) + '\n').encode())
        return digest.hexdigest()

    def snapshot(self, destination):
        shutil.copytree(self.data, destination, ignore=shutil.ignore_patterns('runtime.lock', 'state.sqlite3*'))
        with sqlite3.connect('file:' + str(self.data / 'state.sqlite3') + '?mode=ro', uri=True) as source:
            with sqlite3.connect(destination / 'state.sqlite3') as target: source.backup(target)

    def startup(self, candidate, snapshot):
        with tempfile.TemporaryDirectory(prefix='startup-', dir=self.root) as temp:
            empty = Path(temp); (empty / 'ordinary.env').write_text(''); (empty / 'archive.env').write_text(''); (empty / 'data').mkdir()
            overlay = empty / 'network.yaml'; overlay.write_text('services:\n  ordinary:\n    network_mode: none\n')
            env = {**os.environ, 'ORDINARY_IMAGE': candidate['image'], 'ORDINARY_ROOT': str(empty),
                   'ORDINARY_UID': str(os.getuid()), 'ORDINARY_GID': str(os.getgid())}
            self.command(['docker', 'compose', '--env-file', str(empty / 'ordinary.env'), '-f', str(Path(candidate['source']) / 'deploy/ordinary/compose.yaml'),
                          '-f', str(overlay), 'run', '--rm', '--entrypoint', 'node', 'ordinary', '--version'], env=env)

    def resident(self):
        return bool(self.config.get('resident_scheduler', True))

    def compose(self, source, current):
        env = {**os.environ, 'ORDINARY_IMAGE': current['image'], 'ORDINARY_ROOT': str(self.root.parent),
               'ORDINARY_UID': str(os.getuid()), 'ORDINARY_GID': str(os.getgid())}
        return env, ['docker', 'compose', '--env-file', self.config['env_file'], '-f', str(Path(source) / 'deploy/ordinary/compose.yaml')]

    def has_scheduler(self, source):
        try: return 'scheduler:' in (Path(source) / 'deploy/ordinary/compose.yaml').read_text()
        except OSError: return False

    def scheduler_running(self, current):
        if not self.resident() or not self.has_scheduler(current['source']): return False
        env, prefix = self.compose(current['source'], current)
        try: return bool(self.command(prefix + ['ps', '-q', 'scheduler'], env=env))
        except RuntimeError: return False

    def scheduler_control(self, current, action):
        env, prefix = self.compose(current['source'], current)
        tail = ['up', '-d', '--no-deps', 'scheduler'] if action == 'up' else ['stop', 'scheduler']
        return self.command(prefix + tail, env=env, capture=False, timeout=None)

    def after_change(self, state):
        # 部署/回滚后让常驻调度跟着新镜像重启；旧版本没有该服务则保持 crontab 兼容。
        if not self.resident(): return None
        current = state.get('active')
        if not current or not self.has_scheduler(current.get('source', '')): return None
        try: self.scheduler_control(current, 'up')
        except Exception as error:
            with open(self.logs / 'deployments.jsonl', 'a') as log:
                log.write(json.dumps({'at': base.dt.datetime.now(base.SHANGHAI).isoformat(), 'status': 'scheduler_start_failed',
                                      'error': str(error) if isinstance(error, RuntimeError) else type(error).__name__}) + '\n')
        return None

    def scheduler_status(self):
        current = self.state().get('active')
        if not current: return {'status': 'no_active_release'}
        path = self.data / 'scheduler/status.json'
        return {'status': 'running' if self.scheduler_running(current) else 'stopped', 'active': current['tag'],
                'last': base.read(path)}

    def validate(self, candidate, snapshot):
        # 普通版必须用普通版的验证脚本：高级版 verify-state 依赖 news-engine 的模块，普通镜像里没有。
        self.startup(candidate, snapshot)
        verifier = Path(candidate['source']) / 'deploy/ordinary/verify-state.ts'
        self.command(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                      '--security-opt', 'no-new-privileges:true', '--user', str(os.getuid()) + ':' + str(os.getgid()),
                      '--tmpfs', '/tmp:rw,size=128m,mode=1777', '-v', str(snapshot) + ':/data',
                      '-v', str(verifier) + ':/app/verify-state.ts:ro',
                      '--entrypoint', 'node', candidate['image'], '/app/verify-state.ts'], capture=False)

    def run(self):
        with base.lock(Path(self.config['scheduler_lock']), blocking=False) as acquired:
            if not acquired: return {'status': 'scheduler_busy'}
            current = self.state()['active']
            if not current: raise RuntimeError('no_active_ordinary_release')
            source = Path(current['source'])
            if self.command(['git', 'rev-parse', 'HEAD'], cwd=source) != current['sha'] or self.command(['git', 'status', '--porcelain', '--untracked-files=all'], cwd=source):
                raise RuntimeError('ordinary_release_worktree_modified')
            env, prefix = self.compose(source, current)
            # 常驻调度独占同一份数据：手动 tick 前先停调度，跑完再拉起，避免并发写。
            resident = self.scheduler_running(current)
            if resident: self.scheduler_control(current, 'down')
            try:
                return self.command(prefix + ['run', '--rm', 'ordinary', 'run', '--data', '/data'],
                                    env=env, capture=False, timeout=None)
            finally:
                if resident:
                    try: self.scheduler_control(current, 'up')
                    except Exception as error:
                        with open(self.logs / 'deployments.jsonl', 'a') as log:
                            log.write(json.dumps({'at': base.dt.datetime.now(base.SHANGHAI).isoformat(), 'status': 'scheduler_restart_failed',
                                                  'error': str(error) if isinstance(error, RuntimeError) else type(error).__name__}) + '\n')

    def sync(self):
        with base.lock(self.root / 'sync.lock', blocking=False) as acquired:
            if not acquired: return {'status': 'archive_sync_busy'}
            current = self.state()['active']
            with tempfile.TemporaryDirectory(prefix='archive-', dir=self.root) as temp:
                snapshot = Path(temp)
                with base.lock(self.data / 'runtime.lock'):
                    if (self.data / 'archive-journal.json').exists(): return {'status': 'archive_recovery_pending'}
                    shutil.copytree(self.data / 'news_archive', snapshot / 'archive')
                    shutil.copyfile(self.data / 'config.json', snapshot / 'config.json')
                return self.command(['docker', 'run', '--rm', '--read-only', '--cap-drop', 'ALL',
                    '--security-opt', 'no-new-privileges:true', '--memory', '256m', '--cpus', '0.5',
                    '--user', str(os.getuid()) + ':' + str(os.getgid()), '--env-file', str(self.root.parent / 'archive.env'),
                    '-e', 'NODE_USE_ENV_PROXY=1',
                    '-v', str(snapshot / 'archive') + ':/archive:ro', '-v', str(snapshot / 'config.json') + ':/control/config.json:ro',
                    '-v', str(self.data / 'archive-sync') + ':/sync', '--entrypoint', 'node', current['image'],
                    'packages/ordinary-news/src/sync.ts', '/archive', '/sync', '/control/config.json'], capture=False, timeout=1800)


def main():
    os.umask(0o077)
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--root', required=True)
    p.add_argument('operation', choices=['status', 'run', 'update', 'rollback', 'sync', 'scheduler-up', 'scheduler-down']); p.add_argument('version', nargs='?'); args = p.parse_args()
    c = Controller(args.root)
    if args.operation == 'status': result = {'deployment': c.state(), 'last_check': base.read(c.root / 'status.json'), 'scheduler': c.scheduler_status()}
    elif args.operation == 'rollback': result = c.rollback(args.version)
    elif args.operation.startswith('scheduler-'):
        current = c.state().get('active')
        if not current: raise RuntimeError('no_active_ordinary_release')
        c.scheduler_control(current, 'up' if args.operation == 'scheduler-up' else 'down')
        result = {'status': 'scheduler_up' if args.operation == 'scheduler-up' else 'scheduler_down', 'active': current['tag']}
    else: result = getattr(c, args.operation)()
    if result: print(json.dumps(result))
    return 1 if isinstance(result, dict) and result.get('status') in ['deployment_failed', 'release_check_failed', 'blocked_release'] else 0

if __name__ == '__main__': sys.exit(main())
