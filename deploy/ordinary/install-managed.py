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


NODE_CANDIDATES = ['/vol3/1000/Docker/everydaytechnews-runtime/bin/node']


def find_node():
    """宿主机 Node：优先固定运行时目录，其次 PATH；找不到就退回 Python 控制器。"""
    override = os.environ.get('ETN_NODE')
    if override and Path(override).is_file(): return override
    for candidate in NODE_CANDIDATES:
        if Path(candidate).is_file(): return candidate
    return shutil.which('node')


def controller_runner(managed):
    node = find_node()
    if not node: return '/usr/bin/python3 ' + str(managed / 'manage.py') + ' --root ' + str(managed)
    return node + ' --disable-warning=ExperimentalWarning ' + str(managed / 'manage.ts') + ' --root ' + str(managed)


def write_ts_controller(managed, source):
    """部署 TS 控制器；managed 目录里导入同目录的 base-manage.ts。"""
    if not (source / 'manage.ts').exists() or not (source.parent / 'nas/base-manage.ts').exists(): return
    ordinary = (source / 'manage.ts').read_text().replace("from '../nas/base-manage.ts'", "from './base-manage.ts'")
    for name, content in [('base-manage.ts', (source.parent / 'nas/base-manage.ts').read_text()), ('manage.ts', ordinary)]:
        temp = managed / (name + '.install')
        temp.write_text(content); os.chmod(temp, 0o700); os.replace(temp, managed / name)


def upgrade_controller(root, tag):
    os.umask(0o077)
    root = Path(root).resolve(); managed = root / 'managed'; source = Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location('ordinary_upgrade_controller', source / 'manage.py')
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    c = m.Controller(managed)
    if m.base.protected(): raise RuntimeError('controller_upgrade_deferred_morning_window')
    with m.base.lock(managed / 'update.lock'):
        if not m.base.version(tag): raise RuntimeError('controller_release_invalid')
        release = c.api('releases/tags/' + tag)
        if release.get('draft') or release.get('prerelease') or not release.get('published_at'):
            raise RuntimeError('controller_release_invalid')
        sha, verified = c.source(tag)
        with m.base.lock(Path(c.config['scheduler_lock'])):
            with m.base.lock(managed / 'sync.lock'):
                if m.base.protected(): raise RuntimeError('controller_upgrade_deferred_morning_window')
                saved = managed / 'controller-backups' / tag
                saved.mkdir(parents=True, exist_ok=False)
                files = [('manage.py', verified / 'deploy/ordinary/manage.py'),
                         ('base-manage.py', verified / 'deploy/nas/manage.py'),
                         ('verify-state.ts', verified / 'deploy/ordinary/verify-state.ts')]
                for name, _ in files:
                    shutil.copyfile(managed / name, saved / name)
                for name in ['manage.ts', 'base-manage.ts']:
                    if (managed / name).exists(): shutil.copyfile(managed / name, saved / name)
                if (managed / 'controller.json').exists(): shutil.copyfile(managed / 'controller.json', saved / 'controller.json')
                try:
                    for name, candidate in files:
                        temp = managed / (name + '.install')
                        shutil.copyfile(candidate, temp); os.replace(temp, managed / name)
                    write_ts_controller(managed, verified / 'deploy/ordinary')
                    m.base.atomic(managed / 'controller.json', {'source_sha': sha,
                        'manage_sha256': m.hashlib.sha256((managed / 'manage.py').read_bytes()).hexdigest(),
                        'base_sha256': m.hashlib.sha256((managed / 'base-manage.py').read_bytes()).hexdigest()})
                except Exception:
                    for name, _ in files: shutil.copyfile(saved / name, managed / name)
                    for name in ['manage.ts', 'base-manage.ts']:
                        if (saved / name).exists(): shutil.copyfile(saved / name, managed / name)
                    raise
    return {'status': 'controller_upgraded', 'tag': tag, 'sha': sha}


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
    write_ts_controller(managed, source)
    spec = importlib.util.spec_from_file_location('ordinary_installer_controller', managed / 'manage.py')
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    m.base.atomic(managed / 'config.json', {'component': 'ordinary-news', 'manifest': 'deploy/ordinary/release.json', 'dockerfile': 'deploy/ordinary/Dockerfile',
        'workflow': 'ordinary-news.yml', 'image_repository': 'everyday-tech-news-ordinary', 'data': str(data), 'env_file': str(root / 'ordinary.env'),
        'scheduler_lock': str(root / 'scheduler.lock'), 'state_lock': 'runtime.lock', 'resident_scheduler': True,
        'node': find_node() or ''})
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
    runner = controller_runner(managed)
    # 出刊调度已迁到镜像内常驻进程；crontab 只保留看门狗与更新/归档。
    kept = [line for line in existing.splitlines() if not ((str(managed / 'manage.py') in line or str(managed / 'manage.ts') in line) and ' run ' in line)]
    lines = '\n'.join(kept).rstrip('\n') + '\n# EverydayTechNews ordinary shadow; separate from premium\n'
    lines += '*/10 * * * * ' + runner + ' scheduler-up >/dev/null 2>&1\n'
    lines += '17 * * * * ' + runner + ' update >> ' + str(managed / 'updater.log') + ' 2>&1\n'
    lines += '40 6,8,12,20 * * * ' + runner + ' sync 1>/dev/null 2>> ' + str(managed / 'logs' / 'sync.err') + '\n'
    lines += '30 4 * * 0 /home/nowscott/bin/etn-logrotate.sh ' + str(managed / 'logs') + ' >/dev/null 2>&1\n'
    rotate_source = Path(__file__).resolve().parent / 'rotate-logs.sh'
    bin_dir = Path.home() / 'bin'
    bin_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    (bin_dir / 'etn-logrotate.sh').write_text(rotate_source.read_text())
    (bin_dir / 'etn-logrotate.sh').chmod(0o755)
    subprocess.run(['crontab', '-'], input=lines, text=True, check=True)
    m.base.atomic(managed / 'controller.json', {'source_sha': sha, 'manage_sha256': m.hashlib.sha256((managed / 'manage.py').read_bytes()).hexdigest(),
        'base_sha256': m.hashlib.sha256((managed / 'base-manage.py').read_bytes()).hexdigest()})
    return {'status': 'installed_shadow', 'tag': tag, 'sha': sha, 'ordinary_legacy_actions_unchanged': True}

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--root', required=True); p.add_argument('--tag', required=True); p.add_argument('--upgrade-controller', action='store_true'); a = p.parse_args()
    print(json.dumps(upgrade_controller(a.root, a.tag) if a.upgrade_controller else install(a.root, a.tag)))
