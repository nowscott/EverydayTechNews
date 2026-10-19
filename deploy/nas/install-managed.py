#!/usr/bin/env python3
"""Run once on NAS from the checked release source; keep original data in place."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--legacy', required=True)
parser.add_argument('--root', required=True)
parser.add_argument('--upgrade-controller', action='store_true', help='Explicitly install a checked controller update')
args = parser.parse_args()
os.umask(0o077)
root = Path(args.root).resolve()
legacy = Path(args.legacy).resolve()
source = Path(__file__).resolve().parent
existing = root.exists()
if existing and not args.upgrade_controller:
    raise SystemExit('Managed root exists; use --upgrade-controller for an explicit checked update.')
root.mkdir(mode=0o700, exist_ok=True)
private = legacy / 'deploy/nas'
for path in [private / 'data/durable/state.json', private / '.env']:
    if not path.exists(): raise SystemExit('Existing private state/environment required')
if not existing:
    for name in ['manage.py', 'verify-state.ts', 'compose.managed.yaml', 'compose.proxy.yaml']:
        shutil.copyfile(source / name, root / name)
spec = importlib.util.spec_from_file_location('nas_manage', root / 'manage.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
if existing:
    controller = m.Controller(root)
    if controller.config['data'] != str(private / 'data') or controller.config['env_file'] != str(private / '.env'):
        raise SystemExit('Existing private configuration differs; refusing to replace it')
    tag = m.PREFIX + m.read(source / 'release.json')['version']
    with m.lock(root / 'update.lock'):
        sha, verified = controller.source(tag)
        with m.lock(Path(controller.config['scheduler_lock'])):
            saved = root / 'controller-backups' / tag
            saved.mkdir(parents=True, exist_ok=True)
            for name in ['manage.py', 'verify-state.ts', 'compose.managed.yaml', 'compose.proxy.yaml']:
                shutil.copyfile(root / name, saved / name)
                temp = root / (name + '.install')
                shutil.copyfile(verified / 'deploy/nas' / name, temp)
                os.replace(temp, root / name)
            m.atomic(root / 'controller.json', {'version': tag, 'sha': sha,
                'manage_sha256': m.hashlib.sha256((root / 'manage.py').read_bytes()).hexdigest()})
    # Load the newly verified controller, not the old class retained by Python imports.
    spec = importlib.util.spec_from_file_location('nas_manage_updated', root / 'manage.py')
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    original = (root / 'crontab-before.txt').read_text()
else:
    image = subprocess.check_output(['docker', 'image', 'inspect', 'everyday-tech-news-test:local', '--format', '{{.Id}}'], text=True).strip()
    subprocess.run(['docker', 'tag', image, 'everyday-tech-news-test:legacy-20261019'], check=True)
    m.atomic(root / 'config.json', {'data': str(private / 'data'), 'env_file': str(private / '.env'),
                                   'scheduler_lock': str(private / '.scheduler.lock')})
    old = {'tag': 'legacy-20261019', 'image': image, 'image_tag': 'everyday-tech-news-test:legacy-20261019',
           'source': str(legacy), 'legacy': True, 'sha': None, 'schema': 1}
    m.atomic(root / 'deployment.json', {'active': old, 'history': [old], 'blocked': {}, 'high_water': [0, 0, 0]})
    original = subprocess.run(['crontab', '-l'], capture_output=True, text=True, check=False).stdout
    (root / 'crontab-before.txt').write_text(original)
controller = m.Controller(root)
result = controller.update()
if result.get('status') not in ['deployed', 'up_to_date']:
    print(json.dumps(result)); raise SystemExit('Deployment incomplete; original scheduler remains unchanged')
runner = '/usr/bin/python3 ' + str(root / 'manage.py') + ' --root ' + str(root)
present = subprocess.run(['crontab', '-l'], capture_output=True, text=True, check=False).stdout
lines = [line for line in present.splitlines() if str(private / 'run-scheduled.sh') not in line
         and str(root / 'manage.py') not in line and line != '# EverydayTechNews managed releases; local time Asia/Shanghai']
lines.extend([
    '# EverydayTechNews managed releases; local time Asia/Shanghai',
    '7,37 0-3,9-23 * * * ' + runner + ' run >> ' + str(root / 'logs/scheduler.log') + ' 2>&1',
    '7,22,37,52 4-8 * * * ' + runner + ' run >> ' + str(root / 'logs/scheduler.log') + ' 2>&1',
    '*/15 * * * * ' + runner + ' update >> ' + str(root / 'logs/updater.log') + ' 2>&1',
])
with m.lock(Path(controller.config['scheduler_lock'])):
    subprocess.run(['crontab', '-'], input='\n'.join(lines) + '\n', text=True, check=True)
print(json.dumps({'status': 'installed', 'active': controller.state()['active'], 'automatic_updates': True}))
