#!/usr/bin/env python3
"""Install/run a NAS-local premium health check without depending on a laptop."""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess


def controller(root):
    root=Path(root).resolve();spec=importlib.util.spec_from_file_location('health_controller',root/'manage.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    return m,m.Controller(root)


def install(root):
    os.umask(0o077);m,c=controller(root)
    with m.lock(c.root/'update.lock'),m.lock(c.root/'health.lock'):
        current=c.state()['active'];v=re.fullmatch(r'news-engine-v(\d+)\.(\d+)\.(\d+)',current['tag'])
        if not v or tuple(map(int,v.groups()))<(0,6,1):raise RuntimeError('health_requires_engine_0_6_1')
        target=c.root/'health-check.py';temp=target.with_suffix('.tmp');shutil.copyfile(Path(__file__).resolve(),temp);os.chmod(temp,0o600);os.replace(temp,target)
        existing=subprocess.run(['crontab','-l'],capture_output=True,text=True).stdout
        backup=c.root/('crontab-before-health-'+dt.datetime.now().strftime('%Y%m%dT%H%M%S')+'.txt');backup.write_text(existing)
        lines=[line for line in existing.splitlines() if str(target) not in line]
        lines.append('10 9-23 * * * /usr/bin/python3 '+str(target)+' --root '+str(c.root)+' check >> '+str(c.root/'health.log')+' 2>&1')
        subprocess.run(['crontab','-'],input='\n'.join(lines)+'\n',text=True,check=True)
        m.atomic(c.root/'health-controller.json',{'source_sha':current['sha'],'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'schedule':'hourly 09:10-23:10 Asia/Shanghai','normal_notifications':False})
    return {'status':'health_installed_on_nas','normal_notifications':False}


def check(root):
    os.umask(0o077);m,c=controller(root)
    with m.lock(c.root/'health.lock',blocking=False) as acquired:
        if not acquired:return {'status':'health_busy'}
        current=c.state()['active'];source=Path(current['source'])
        if c.command(['git','rev-parse','HEAD'],cwd=source)!=current['sha'] or c.command(['git','status','--porcelain','--untracked-files=all'],cwd=source):raise RuntimeError('health_release_source_modified')
        env={**os.environ,'NAS_IMAGE':current['image'],'NAS_DATA_DIR':str(c.data),'NAS_ENV_FILE':c.config['env_file'],'NAS_UID':str(os.getuid()),'NAS_GID':str(os.getgid())}
        output=c.command(['docker','compose','--env-file',c.config['env_file'],'-f',str(source/'deploy/nas/compose.managed.yaml'),'-f',str(source/'deploy/nas/compose.proxy.yaml'),
            'run','--rm','-e','NEWS_HEALTH_AUTHORITY=nas','--entrypoint','node','premium','packages/news-engine/src/health.ts','/data'],env=env)
        return json.loads(output)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',required=True);p.add_argument('operation',choices=['install','check']);a=p.parse_args()
    print(json.dumps(install(a.root) if a.operation=='install' else check(a.root)))
