#!/usr/bin/env python3
"""Install the independent dashboard from a prepared NAS source tree and pinned image."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import secrets
import shlex
import shutil
import socket
import subprocess
import importlib.util
spec = importlib.util.spec_from_file_location("observer", Path(__file__).with_name("record-run.py"))
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


def run(*args, **kwargs):
    return subprocess.run(*args, check=True, text=True, **kwargs)


def install(args):
    os.umask(0o077)
    root = Path(args.root).resolve()
    if root.exists():
        raise SystemExit('dashboard root exists; use documented update procedure')
    if not args.image.startswith('sha256:'):
        raise SystemExit('use a built, verified image digest')
    premium_managed = Path(args.premium_managed).resolve()
    ordinary_managed = Path(args.ordinary_managed).resolve()
    configs = [json.loads((p / 'config.json').read_text()) for p in [ordinary_managed, premium_managed]]
    data = [Path(c['data']).resolve() for c in configs]
    for p in data:
        if not (p / 'state.sqlite3').is_file():
            raise SystemExit('business data unavailable')
    with socket.socket() as sock:
        sock.bind((args.bind, args.port))
    cron = subprocess.run(['crontab', '-l'], text=True, capture_output=True).stdout
    commands = [f'/usr/bin/python3 {p}/manage.py --root {p} run' for p in [ordinary_managed, premium_managed]]
    for command in commands:
        if not any(command + ' >> ' in line for line in cron.splitlines()):
            raise SystemExit('expected scheduler command not found; no changes made')
    root.mkdir(mode=0o700)
    for name in ['auth','runtime/ordinary','runtime/premium','deployment/ordinary','deployment/premium','bodies']:
        (root / name).mkdir(parents=True, mode=0o700)
    source = Path(__file__).resolve().parent
    for name in ['compose.yaml', 'record-run.py']:
        shutil.copyfile(source / name, root / name)
    password = secrets.token_urlsafe(18)
    salt = secrets.token_bytes(16).hex()
    password_hash = 'scrypt:' + salt + ':' + hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=64).hex()
    (root / 'dashboard.env').write_text('DASHBOARD_PASSWORD_HASH=' + password_hash + '\n')
    (root / 'initial-password.txt').write_text(password + '\n')
    values = {'DASHBOARD_IMAGE': args.image, 'DASHBOARD_ROOT': str(root), 'DASHBOARD_BIND_IP':args.bind,
              'DASHBOARD_PORT':str(args.port), 'DASHBOARD_ORDINARY_DATA':str(data[0]), 'DASHBOARD_PREMIUM_DATA':str(data[1]),
              'DASHBOARD_UID':str(os.getuid()), 'DASHBOARD_GID':str(os.getgid())}
    (root / 'compose.env').write_text(''.join(k+'='+v+'\n' for k,v in values.items()))
    (root / 'crontab-before.txt').write_text(cron)
    for component, managed in [('ordinary',ordinary_managed),('premium',premium_managed)]:
        active = json.loads((managed / 'deployment.json').read_text())['active']
        observer.atomic(root / 'deployment' / component / 'deployment.json', {'active':{k:active.get(k) for k in ['tag','sha','deployed_at']}})
    for path in root.rglob('*'):
        os.chmod(path, 0o700 if path.is_dir() else 0o600)
    compose = ['docker','compose','--env-file',str(root/'compose.env'),'-f',str(root/'compose.yaml')]
    run(compose+['config','--quiet'])
    run(compose+['up','-d','--wait','--wait-timeout','90'])
    patched = cron
    for component,command,managed in zip(['ordinary','premium'],commands,[ordinary_managed,premium_managed]):
        prefix = shlex.join(['/usr/bin/python3',str(root/'record-run.py'),'--root',str(root),'--component',component,'--deployment',str(managed/'deployment.json'),'--'])
        patched = patched.replace(command+' >> ',prefix+' '+command+' >> ')
    latest = subprocess.run(['crontab', '-l'], text=True, capture_output=True).stdout
    if latest != cron:
        raise SystemExit('crontab changed during installation; dashboard running, observer not installed; review current crontab')
    run(['crontab','-'], input=patched)
    observer.atomic(root/'installation.json',{'version':'1.3.1','installed_at':dt.datetime.now(dt.timezone.utc).isoformat(),'image':args.image,'url':f'http://{args.bind}:{args.port}','source_commit':args.source_commit})
    print(json.dumps({'url':f'http://{args.bind}:{args.port}','password_file':str(root/'initial-password.txt'),'cron_backup':str(root/'crontab-before.txt')}))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',required=True)
    parser.add_argument('--image',required=True)
    parser.add_argument('--bind',required=True)
    parser.add_argument('--port',type=int,default=3080)
    parser.add_argument('--ordinary-managed',default='/vol3/1000/Docker/everydaytechnews-ordinary/managed')
    parser.add_argument('--premium-managed',default='/vol3/1000/Docker/everydaytechnews-managed')
    parser.add_argument('--source-commit',required=True)
    install(parser.parse_args())
