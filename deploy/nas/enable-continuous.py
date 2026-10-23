#!/usr/bin/env python3
"""Apply the user's explicit continuous internal-test authorization; never reset ledgers."""
import argparse
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil


def enable(root):
    os.umask(0o077)
    root = Path(root).resolve()
    spec = importlib.util.spec_from_file_location('managed_continuous_controller', root / 'manage.py')
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    c = m.Controller(root)
    with m.lock(root / 'update.lock'), m.lock(Path(c.config['scheduler_lock'])), m.lock(c.data / 'pool.lock'):
        active = c.state()['active']
        match = re.fullmatch(r'news-engine-v(\d+)\.(\d+)\.(\d+)', active['tag'])
        if not match or tuple(map(int, match.groups())) < (0, 6, 0): raise RuntimeError('continuous_requires_engine_0_6_0')
        if not (c.data / '.nas-authority.json').exists(): raise RuntimeError('nas_authority_required')
        path = c.data / 'trial.json'; old = m.read(path)
        if old.get('testing_period') == 'continuous': return {'status': 'already_continuous'}
        if old.get('allowed_recipient') != 'nowscott@qq.com' or old.get('production_enabled') is not False or old.get('daily_budget_cny') != 2:
            raise RuntimeError('unexpected_existing_trial_boundary')
        ledger = (lambda: c.ledger()) if hasattr(c, 'ledger') else (lambda: m.ledger(c.data))
        before = ledger()
        stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        backup = root / 'continuous-config-backups' / stamp
        backup.mkdir(parents=True, mode=0o700)
        shutil.copyfile(path, backup / 'trial.json')
        new = {**old, 'testing_period': 'continuous', 'days': None, 'expires_at': None,
               'authorization': 'User-authorized continuous internal test from 2026-10-23; one test mailbox; production disabled',
               'continuous_authorization': {'by': 'user', 'on': '2026-10-23',
                    'basis': '用户在本聊天明确要求高级版改为长期测试', 'previous_expiry': old.get('expires_at'), 'previous_authorization': old.get('authorization')}}
        m.atomic(path, new)
        try:
            code = "import {trial} from './packages/news-engine/src/core.ts'; const t=trial('/data'); if(t.testing_period!=='continuous')throw Error('invalid'); console.log('continuous_config_validated');"
            c.command(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--user', str(os.getuid())+':'+str(os.getgid()),
                '-v', str(c.data)+':/data:ro', '--entrypoint', 'node', active['image'], '--input-type=module', '-e', code])
            if ledger() != before: raise RuntimeError('ledger_changed_during_configuration')
        except Exception:
            m.atomic(path, old)
            raise
        return {'status': 'continuous_enabled', 'recipient_count': 1, 'daily_budget_cny': new['daily_budget_cny'],
                'model_enabled': new['model_enabled'], 'delivery_enabled': new['delivery_enabled'],
                'production_enabled': False, 'previous_expiry': old.get('expires_at'), 'expires_at': None,
                'ledger_unchanged': True, 'backup': str(backup)}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    args = parser.parse_args()
    print(json.dumps(enable(args.root), ensure_ascii=False))
