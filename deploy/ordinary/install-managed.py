#!/usr/bin/env python3
"""Install an isolated, shadow-only ordinary runtime from a verified release."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def install(root, tag):
    os.umask(0o077)
    root = Path(root).resolve(); source = Path(__file__).resolve().parent
    if (root / 'managed/deployment.json').exists(): raise RuntimeError('ordinary_already_managed')
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    for filename in ['ordinary.env', 'archive.env']:
        p = root / filename
        if not p.exists(): p.write_text('')
        os.chmod(p, 0o600)
    data = root / 'data'; data.mkdir(mode=0o700, exist_ok=True)
    for directory in ['news_archive', 'archive-sync']: (data / directory).mkdir(mode=0o700, exist_ok=True)
    managed = root / 'managed'; managed.mkdir(mode=0o700, exist_ok=True)
    shutil.copyfile(source / 'manage.py', managed / 'manage.py')
    shutil.copyfile(source.parent / 'nas/manage.py', managed / 'base-manage.py')
    shutil.copyfile(source / 'verify-state.ts', managed / 'verify-state.ts')
    spec = importlib.util.spec_from_file_location('ordinary_installer_controller', managed / 'manage.py')
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    m.base.atomic(managed / 'config.json', {'component': 'ordinary-news', 'manifest': 'deploy/ordinary/release.json', 'dockerfile': 'deploy/ordinary/Dockerfile',
        'workflow': 'ordinary-news.yml', 'image_repository': 'everyday-tech-news-ordinary', 'data': str(data), 'env_file': str(root / 'ordinary.env'),
        'scheduler_lock': str(root / 'scheduler.lock'), 'state_lock': 'runtime.lock'})
    c = m.Controller(managed); sha, directory = c.source(tag); candidate = c.build(tag, sha, directory)
    # Bootstrap without credentials or network. Existing state is never reinitialized.
    c.command(['docker', 'run', '--rm', '--network', 'none', '--user', str(os.getuid()) + ':' + str(os.getgid()),
        '-v', str(data) + ':/data', candidate['image'], 'init', '--data', '/data'])
    result = c.activate(candidate)
    if result.get('status') != 'deployed': raise RuntimeError('ordinary_install_activation_incomplete')
    m.base.atomic(data / '.ordinary-authority.json', {'kind': 'ordinary_nas', 'schema_version': 1, 'installed_sha': sha})
    if m.base.read(data / 'config.json')['mode'] != 'shadow': raise RuntimeError('ordinary_install_requires_shadow')
    # Initial public archive snapshot is for comparison only; no writers are stopped during shadow.
    public = managed / 'initial-archive-source'
    c.command(['git', 'clone', '--depth', '1', 'https://github.com/' + m.base.REPO + '.git', str(public)])
    shutil.copytree(public / 'news_archive', data / 'news_archive', dirs_exist_ok=True)
    shutil.copyfile(public / 'notifications.ini', data / 'notifications.ini')
    tree = c.command(['git', 'ls-tree', '-r', 'HEAD', '--', 'news_archive'], cwd=public)
    m.base.atomic(data / 'archive-sync/baseline.json', {'files': {line.split('\t', 1)[1]: line.split()[2] for line in tree.splitlines()}})
    existing = subprocess.run(['crontab', '-l'], capture_output=True, text=True).stdout
    (root / 'crontab-before.txt').write_text(existing)
    runner = '/usr/bin/python3 ' + str(managed / 'manage.py') + ' --root ' + str(managed)
    lines = existing.rstrip('\n') + '\n# EverydayTechNews ordinary shadow; separate from premium\n'
    lines += '* * * * * ' + runner + ' run >> ' + str(managed / 'scheduler.log') + ' 2>&1\n'
    lines += '*/15 * * * * ' + runner + ' update >> ' + str(managed / 'updater.log') + ' 2>&1\n'
    lines += '7,37 * * * * ' + runner + ' sync >> ' + str(managed / 'archive.log') + ' 2>&1\n'
    subprocess.run(['crontab', '-'], input=lines, text=True, check=True)
    m.base.atomic(managed / 'controller.json', {'source_sha': sha, 'manage_sha256': m.hashlib.sha256((managed / 'manage.py').read_bytes()).hexdigest(),
        'base_sha256': m.hashlib.sha256((managed / 'base-manage.py').read_bytes()).hexdigest()})
    return {'status': 'installed_shadow', 'tag': tag, 'sha': sha, 'ordinary_legacy_actions_unchanged': True}

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--root', required=True); p.add_argument('--tag', required=True); a = p.parse_args()
    print(json.dumps(install(a.root, a.tag)))
