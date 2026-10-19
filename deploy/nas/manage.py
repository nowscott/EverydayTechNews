#!/usr/bin/env python3
"""NAS release controller. Python stdlib only; never restores old live ledgers."""
import argparse
import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import urllib.error

REPO = 'nowscott/EverydayTechNews'
PREFIX = 'news-engine-v'
SHANGHAI = dt.timezone(dt.timedelta(hours=8))


def version(tag):
    match = re.fullmatch(r'news-engine-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', tag or '')
    return tuple(map(int, match.groups())) if match else None


def protected(now=None):
    return 4 <= (now or dt.datetime.now(SHANGHAI)).astimezone(SHANGHAI).hour < 9


def choose(releases, floor):
    valid = [r for r in releases if not r.get('draft') and not r.get('prerelease')
             and r.get('published_at') and version(r.get('tag_name'))
             and version(r['tag_name']) > floor]
    return max(valid, key=lambda r: version(r['tag_name']), default=None)


def read(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    with open(temp, 'w', encoding='utf-8') as out:
        os.chmod(temp, 0o600)
        json.dump(value, out, ensure_ascii=False, indent=2)
        out.write('\n'); out.flush(); os.fsync(out.fileno())
    os.replace(temp, path)
    fd = os.open(path.parent, os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)


@contextlib.contextmanager
def lock(path, blocking=True):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'a') as handle:
        try: fcntl.flock(handle, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        except BlockingIOError:
            yield False
            return
        try: yield True
        finally: fcntl.flock(handle, fcntl.LOCK_UN)


def ledger(data):
    state = read(data / 'durable/state.json')
    payload = {'calls': state['tables']['calls'], 'issues': state['tables']['issues'],
               'deliveries': {str(p.relative_to(data)): hashlib.sha256(p.read_bytes()).hexdigest()
                              for p in sorted((data / 'deliveries').rglob('*')) if p.is_file()}}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def compatible(manifest, schema):
    return (manifest.get('component') == 'news-engine' and manifest.get('state_schema') == schema
            and manifest.get('controller_protocol') == 1 and manifest.get('automatic_deployment') is True)


class Controller:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.config = read(self.root / 'config.json')
        if not self.config: raise RuntimeError('controller_not_configured')
        self.data = Path(self.config['data']).resolve()
        self.state_path = self.root / 'deployment.json'
        self.logs = self.root / 'logs'
        self.logs.mkdir(parents=True, exist_ok=True)

    def command(self, args, cwd=None, capture=True, env=None, timeout=1800):
        # Child output stays in the NAS private log; exceptions never print env/credentials.
        with open(self.logs / 'commands.log', 'a') as log:
            result = subprocess.run(args, cwd=cwd, env=env, text=True,
                                    stdout=subprocess.PIPE if capture else log, stderr=log, timeout=timeout)
        if result.returncode: raise RuntimeError('command_failed:' + args[0])
        return result.stdout.strip() if capture else ''

    def api(self, endpoint):
        request = urllib.request.Request('https://api.github.com/repos/' + REPO + '/' + endpoint,
                  headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'EverydayTechNews-NAS/1'})
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)

    def state(self):
        return read(self.state_path, {'active': None, 'history': [], 'blocked': {}, 'high_water': [0, 0, 0]})

    def event(self, status, **fields):
        value = {'at': dt.datetime.now(SHANGHAI).isoformat(), 'status': status, **fields}
        atomic(self.root / 'status.json', value)
        with open(self.logs / 'deployments.jsonl', 'a') as log: log.write(json.dumps(value) + '\n')
        return value

    def source(self, tag):
        repo = self.root / 'repository.git'
        if not repo.exists():
            self.command(['git', 'clone', '--bare', 'https://github.com/' + REPO + '.git', str(repo)])
        self.command(['git', '--git-dir', str(repo), 'fetch', 'origin',
                      '+refs/heads/main:refs/heads/main', 'refs/tags/' + tag + ':refs/tags/' + tag])
        sha = self.command(['git', '--git-dir', str(repo), 'rev-parse', tag + '^{commit}'])
        self.command(['git', '--git-dir', str(repo), 'merge-base', '--is-ancestor', sha, 'refs/heads/main'])
        runs = self.api('actions/workflows/news-engine.yml/runs?head_sha=' + sha + '&event=push&per_page=100')
        if not any(r['head_sha'] == sha and r.get('head_branch') == 'main'
                   and r.get('event') == 'push' and r.get('status') == 'completed'
                   and r.get('conclusion') == 'success' for r in runs.get('workflow_runs', [])):
            raise RuntimeError('release_main_checks_not_passed')
        directory = self.root / 'releases' / (tag + '-' + sha[:12])
        if not directory.exists():
            directory.parent.mkdir(parents=True, exist_ok=True)
            self.command(['git', '--git-dir', str(repo), 'worktree', 'add', '--detach', str(directory), sha])
        if self.command(['git', 'status', '--porcelain', '--untracked-files=all'], cwd=directory):
            raise RuntimeError('release_worktree_modified')
        manifest = read(directory / 'deploy/nas/release.json', {})
        schema = read(self.data / 'durable/state.json')['schema_version']
        if not compatible(manifest, schema) or PREFIX + manifest.get('version', '') != tag:
            raise RuntimeError('release_requires_manual_data_migration')
        return sha, directory

    def build(self, tag, sha, directory):
        image = 'everyday-tech-news-test:' + tag
        self.command(['docker', 'build', '-f', 'deploy/nas/Dockerfile', '--build-arg', 'NEWS_VERSION=' + tag,
                      '--build-arg', 'NEWS_REVISION=' + sha, '-t', image,
                      '-t', 'everyday-tech-news-test:git-' + sha, '.'], cwd=directory, capture=False)
        info = json.loads(self.command(['docker', 'image', 'inspect', image]))[0]
        labels = info['Config'].get('Labels') or {}
        if labels.get('org.opencontainers.image.revision') != sha or labels.get('org.opencontainers.image.version') != tag:
            raise RuntimeError('image_provenance_mismatch')
        return {'tag': tag, 'sha': sha, 'source': str(directory), 'image': info['Id'], 'image_tag': image,
                'schema': 1, 'deployed_at': dt.datetime.now(SHANGHAI).isoformat()}

    def startup(self, candidate, snapshot):
        source = Path(candidate['source']) / 'deploy/nas' if not candidate.get('legacy') else self.root
        with tempfile.TemporaryDirectory(prefix='startup-', dir=self.root) as temp:
            empty = Path(temp) / 'empty.env'; empty.write_text('')
            network = Path(temp) / 'network.yaml'
            network.write_text('services:\n  premium:\n    network_mode: none\n')
            env = {**os.environ, 'NAS_IMAGE': candidate['image'], 'NAS_ENV_FILE': str(empty),
                   'NAS_DATA_DIR': str(snapshot), 'NAS_UID': str(os.getuid()), 'NAS_GID': str(os.getgid())}
            self.command(['docker', 'compose', '--env-file', str(empty),
                          '-f', str(source / 'compose.managed.yaml'), '-f', str(source / 'compose.proxy.yaml'),
                          '-f', str(network), 'run', '--rm', '--entrypoint', 'node', 'premium', '--version'], env=env)

    def validate(self, candidate, snapshot):
        self.startup(candidate, snapshot)
        self.command(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                      '--security-opt', 'no-new-privileges:true', '--user', str(os.getuid()) + ':' + str(os.getgid()),
                      '--tmpfs', '/tmp:rw,size=128m,mode=1777', '-v', str(snapshot) + ':/data',
                      '-v', str(self.root / 'verify-state.ts') + ':/app/verify-state.ts:ro',
                      '--entrypoint', 'node', candidate['image'], '/app/verify-state.ts'])

    def activate(self, candidate, rollback=False):
        # Same lock as the former scheduler: even a wakeup already waiting on it is safe.
        with lock(Path(self.config['scheduler_lock'])):
            if protected(): return self.event('deferred_morning_window', pending=candidate['tag'])
            with lock(self.data / 'pool.lock'):
                state = self.state()
                before = ledger(self.data)
                identifier = dt.datetime.now(SHANGHAI).strftime('%Y%m%dT%H%M%S%f')
                backup = self.root / 'backups' / identifier
                backup.mkdir(parents=True, mode=0o700)
                with tempfile.TemporaryDirectory(prefix='validate-', dir=self.root) as temp:
                    snapshot = Path(temp) / 'data'
                    shutil.copytree(self.data, snapshot, ignore=shutil.ignore_patterns('pool.lock', 'state.sqlite3*'))
                    os.chmod(snapshot, 0o700)
                    with tarfile.open(backup / 'state.tar.gz', 'w:gz') as archive:
                        archive.add(snapshot, arcname='data')
                    self.validate(candidate, snapshot)
                    # Rollback must remain able to read the next checkpoint too.
                    previous = state.get('active')
                    if previous and previous.get('runtime_failed'):
                        previous = next((h for h in state['history'] if not h.get('runtime_failed')), None)
                    if previous:
                        self.validate(previous, snapshot)
                if before != ledger(self.data): raise RuntimeError('live_ledger_changed_during_validation')
                if protected(): return self.event('deferred_morning_window', pending=candidate['tag'])
                candidate = {**candidate, 'checks': 'offline_state_and_ledger_passed', 'backup': str(backup),
                             'deployed_at': dt.datetime.now(SHANGHAI).isoformat()}
                history = [candidate] + [h for h in state['history'] if h['image'] != candidate['image'] and not h.get('runtime_failed')]
                state.update(active=candidate, history=history[:3],
                             high_water=list(max(tuple(state['high_water']), version(candidate['tag']) or (0, 0, 0))))
                atomic(self.state_path, state)  # Single source of truth for every new scheduler invocation.
                try:
                    self.prune(state)
                except Exception:
                    self.event('cleanup_deferred', active=candidate)
                return self.event('rolled_back' if rollback else 'deployed', active=candidate)

    def prune(self, state):
        # Only controller-owned release worktrees/images/backups; never shared runtime data.
        keep = {h['source'] for h in state['history']}
        repo = self.root / 'repository.git'
        for path in (self.root / 'releases').glob('*'):
            if str(path) not in keep:
                self.command(['git', '--git-dir', str(repo), 'worktree', 'remove', str(path)])
        # Images are removed by exact IDs only when no retained deployment references them.
        known = read(self.root / 'image-history.json', [])
        retained = {h['image'] for h in state['history']}
        for item in known:
            if item['image'] not in retained and not item.get('legacy'):
                self.command(['docker', 'image', 'rm', item['image_tag'], 'everyday-tech-news-test:git-' + item['sha']])
        atomic(self.root / 'image-history.json', state['history'])
        backups = sorted((self.root / 'backups').glob('*'), reverse=True)
        for path in backups[3:]: shutil.rmtree(path)

    def update(self):
        with lock(self.root / 'update.lock', blocking=False) as acquired:
            if not acquired: return {'status': 'update_already_running'}
            try:
                state = self.state()
                release = choose(self.api('releases?per_page=100'), tuple(state['high_water']))
                if not release: return self.event('up_to_date', active=state['active'])
                tag = release['tag_name']
                if tag in state['blocked']: return self.event('blocked_release', pending=tag, reason=state['blocked'][tag])
                if protected(): return self.event('deferred_morning_window', pending=tag)
                try:
                    sha, directory = self.source(tag)
                    candidate = self.build(tag, sha, directory)
                    return self.activate(candidate)
                except (urllib.error.URLError, TimeoutError):
                    return self.event('release_check_failed', pending=tag, reason='github_api_unavailable')
                except Exception as error:
                    # Record only sanitized error categories, never child stderr or env.
                    reason = str(error) if isinstance(error, RuntimeError) else type(error).__name__
                    state = self.state(); state['blocked'][tag] = reason; atomic(self.state_path, state)
                    return self.event('deployment_failed', pending=tag, reason=reason, active=state['active'])
            except Exception as error:
                return self.event('release_check_failed', reason=type(error).__name__)

    def run(self):
        with lock(Path(self.config['scheduler_lock']), blocking=False) as acquired:
            if not acquired: return {'status': 'scheduler_busy'}
            current = self.state()['active']
            if not current: raise RuntimeError('no_active_release')
            env = {**os.environ, 'NAS_IMAGE': current['image'], 'NAS_DATA_DIR': str(self.data),
                   'NAS_ENV_FILE': self.config['env_file'], 'NAS_UID': str(os.getuid()), 'NAS_GID': str(os.getgid())}
            source = Path(current['source']) if not current.get('legacy') else self.root
            if not current.get('legacy') and (self.command(['git', 'rev-parse', 'HEAD'], cwd=source) != current['sha'] or self.command(['git', 'status', '--porcelain', '--untracked-files=all'], cwd=source)):
                raise RuntimeError('active_release_worktree_modified')
            return self.command(['docker', 'compose', '--env-file', self.config['env_file'],
                 '-f', str(source / ('deploy/nas/compose.managed.yaml' if not current.get('legacy') else 'compose.managed.yaml')),
                 '-f', str(source / ('deploy/nas/compose.proxy.yaml' if not current.get('legacy') else 'compose.proxy.yaml')), 'run', '--rm',
                 '--name', 'etn-premium-scheduled', 'premium', 'run'], env=env, capture=False, timeout=None)

    def rollback(self, tag):
        with lock(self.root / 'update.lock'):
            state = self.state()
            if tag in state['blocked']:
                raise RuntimeError('release_is_quarantined')
            candidate = next((h for h in state['history'] if h['tag'] == tag), None)
            if not candidate: raise RuntimeError('version_not_retained')
            return self.activate(candidate, rollback=True)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('operation', choices=['update', 'status', 'run', 'rollback'])
    parser.add_argument('version', nargs='?')
    args = parser.parse_args()
    controller = Controller(args.root)
    if args.operation == 'status': result = {'deployment': controller.state(), 'last_check': read(controller.root / 'status.json')}
    elif args.operation == 'rollback': result = controller.rollback(args.version)
    else: result = getattr(controller, args.operation)()
    if result: print(json.dumps(result, ensure_ascii=False))
    if isinstance(result, dict) and result.get('status') in ['deployment_failed', 'release_check_failed', 'blocked_release']:
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
