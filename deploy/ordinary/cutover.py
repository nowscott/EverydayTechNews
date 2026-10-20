#!/usr/bin/env python3
"""Operator-side guarded cutover. Default is read-only; --apply requires all shadow gates."""
import argparse
import datetime as dt
import json
from pathlib import Path
import subprocess

REPO='nowscott/EverydayTechNews'
HOST='nowscott@192.168.31.10'
ROOT='/vol3/1000/Docker/everydaytechnews-ordinary'
WORKFLOWS=['technews.yml','news-sorter.yml','run-selenium-script.yml']

def command(args,**kw):return subprocess.check_output(args,text=True,**kw).strip()
def remote(code):return json.loads(command(['ssh','-i',str(Path.home()/'.ssh/everydaytechnews_nas'),'-o','BatchMode=yes',HOST,'python3 -'],input=code))
def api(path):return json.loads(command(['gh','api','repos/'+REPO+'/'+path]))

def cutover(apply=False):
    now=dt.datetime.now(dt.timezone(dt.timedelta(hours=8)))
    if now.hour<9:return {'status':'outside_cutover_window'}
    probe=remote(f'''from pathlib import Path
import json,subprocess,os
r=Path({ROOT!r});s=json.loads((r/'managed/deployment.json').read_text())['active']
config=json.loads((r/'data/config.json').read_text())
if config['mode']=='production':print(json.dumps({{'already_production':True,'first_production_date':config['first_production_date']}}))
else:
 cmd=['docker','run','--rm','--network','none','--user',str(os.getuid())+':'+str(os.getgid()),'-v',str(r/'data')+':/data',s['image'],'gate','--data','/data']
 v=json.loads(subprocess.check_output(cmd,text=True));v['archive_credential_present']='ARCHIVE_GITHUB_TOKEN=' in (r/'archive.env').read_text() and bool((r/'archive.env').read_text().split('ARCHIVE_GITHUB_TOKEN=',1)[1].strip());print(json.dumps(v))
''')
    if probe.get('already_production'):return {'status':'already_production',**probe}
    if not probe.get('passed'):return {'status':'shadow_gate_pending',**probe}
    if not probe.get('archive_credential_present'):return {'status':'archive_credential_required_before_cutover'}
    if not apply:return {'status':'ready_for_cutover','dates':probe['dates']}
    # Verify archive write permission with an unreferenced public-content blob before stopping legacy jobs.
    ready=remote(f'''from pathlib import Path
import json,urllib.request
r=Path({ROOT!r});values={{}}
for line in (r/'archive.env').read_text().splitlines():
 if '=' in line and not line.startswith('#'):k,v=line.split('=',1);values[k]=v.strip().strip('"').strip("'")
req=urllib.request.Request('https://api.github.com/repos/{REPO}/git/blobs',data=json.dumps({{'content':'ordinary-archive-permission-probe','encoding':'utf-8'}}).encode(),headers={{'Authorization':'Bearer '+values['ARCHIVE_GITHUB_TOKEN'],'Accept':'application/vnd.github+json','Content-Type':'application/json'}},method='POST')
try:
 with urllib.request.urlopen(req,timeout=30) as response:print(json.dumps({{'verified':response.status==201}}))
except Exception:print(json.dumps({{'verified':False}}))
''')
    if not ready.get('verified'):return {'status':'archive_write_permission_not_verified'}
    subprocess.run(['gh','variable','set','ORDINARY_NAS_PRODUCTION_ENABLED','--body','true','-R',REPO],check=True)
    ids=[]
    for wf in WORKFLOWS:
        ids.append(api('actions/workflows/'+wf)['id']);subprocess.run(['gh','workflow','disable',wf,'-R',REPO],check=True)
    if any(api('actions/workflows/'+wf)['state']!='disabled_manually' for wf in WORKFLOWS):return {'status':'legacy_disable_unconfirmed'}
    runs=api('actions/runs?per_page=100')['workflow_runs']
    active=[r['id'] for r in runs if r['workflow_id'] in ids and r['status']!='completed']
    if active:return {'status':'waiting_for_legacy_jobs','runs':active}
    first=(now.date()+dt.timedelta(days=1)).isoformat()
    return remote(f'''from pathlib import Path
import json,os,subprocess,shutil,datetime,fcntl
r=Path({ROOT!r});data=r/'data';managed=r/'managed';source=managed/'initial-archive-source'
locks=[]
for p in [r/'scheduler.lock',managed/'sync.lock',data/'runtime.lock']:
 h=p.open('a');fcntl.flock(h,fcntl.LOCK_EX);locks.append(h)
def atomic(p,v):
 t=p.with_suffix('.tmp');t.write_text(json.dumps(v,ensure_ascii=False,indent=2));os.chmod(t,0o600);os.replace(t,p)
config=json.loads((data/'config.json').read_text())
if config['mode']=='production':print(json.dumps({{'status':'already_production'}}));raise SystemExit
subprocess.run(['git','pull','--ff-only'],cwd=source,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
stamp=datetime.datetime.now().strftime('%Y%m%dT%H%M%S');backup=r/'cutover-backups'/stamp;backup.mkdir(parents=True,mode=0o700)
shutil.copyfile(data/'config.json',backup/'config.json');shutil.copyfile(r/'ordinary.env',backup/'ordinary.env')
staged=data/'news_archive.next';shutil.copytree(source/'news_archive',staged,dirs_exist_ok=True)
os.rename(data/'news_archive',backup/'news_archive');os.rename(staged,data/'news_archive')
shutil.copyfile(source/'notifications.ini',data/'notifications.ini')
tree=subprocess.check_output(['git','ls-tree','-r','HEAD','--','news_archive'],cwd=source,text=True)
atomic(data/'archive-sync/baseline.json',{{'files':{{line.split('\\t',1)[1]:line.split()[2] for line in tree.splitlines()}}}})
if (data/'archive-sync/published.json').exists():os.rename(data/'archive-sync/published.json',backup/'published.json')
atomic(data/'cutover.json',{{'legacy_workflows_disabled':True,'legacy_guard_enabled':True,'shadow_gate_passed':True,'shadow_dates':{probe['dates']!r},'first_production_date':{first!r},'cutover_at':datetime.datetime.now().isoformat(),'backup':str(backup)}})
lines=(r/'ordinary.env').read_text().splitlines();lines=[line for line in lines if not line.startswith('ORDINARY_PRODUCTION_ENABLED=')];lines.append('ORDINARY_PRODUCTION_ENABLED=true');t=r/'ordinary.env.tmp';t.write_text('\\n'.join(lines)+'\\n');os.chmod(t,0o600);os.replace(t,r/'ordinary.env')
config.update(mode='production',first_production_date={first!r},archive_sync_enabled=True);atomic(data/'config.json',config)
print(json.dumps({{'status':'cutover_scheduled','first_production_date':{first!r},'shadow_dates':{probe['dates']!r}}}))
''')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--apply',action='store_true');a=p.parse_args()
    print(json.dumps(cutover(a.apply)))
