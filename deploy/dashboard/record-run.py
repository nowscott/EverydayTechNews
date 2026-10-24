#!/usr/bin/env python3
"""Observe an existing scheduler invocation. Never invoke business commands by itself."""
import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid


def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    with temp.open('x') as stream:
        os.chmod(temp, 0o600)
        json.dump(value, stream, ensure_ascii=False)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


def stamp():
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat()


def record(root, component, command, deployment=None):
    directory = Path(root) / 'runtime' / component
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (directory / 'observer.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        if deployment:
            # Only expose release identity, never the controller config or environment.
            try:
                active = json.loads(Path(deployment).read_text())['active']
                atomic(Path(root) / 'deployment' / component / 'deployment.json',
                       {'active': {k: active.get(k) for k in ['tag', 'sha', 'deployed_at']}})
            except (OSError, ValueError, KeyError, TypeError):
                atomic(Path(root) / 'deployment' / component / 'deployment.json', {'active': None})
        started = stamp()
        value = {'run_id': started + '-' + uuid.uuid4().hex[:8], 'component': component,
                 'started_at': started, 'finished_at': None, 'state': 'running', 'exit_code': None}
        path = directory / (value['run_id'].replace(':', '-') + '.json')
        atomic(path, value)
        atomic(directory / 'latest.json', value)
        code = 127
        try:
            code = subprocess.run(command, check=False).returncode
        finally:
            value.update(finished_at=stamp(), state='completed', exit_code=code)
            atomic(path, value)
            atomic(directory / 'latest.json', value)
        return code if code >= 0 else 128 - code


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('--component', choices=['ordinary', 'premium'], required=True)
    parser.add_argument('--deployment')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        parser.error('existing scheduler command required')
    sys.exit(record(args.root, args.component, command, args.deployment))
