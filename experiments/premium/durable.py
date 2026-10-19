"""Private Git is authoritative; SQLite is a rebuildable working index.

Bulk evidence is a cumulative, expiring Actions artifact, never Git history.
External side effects must call checkpoint before and after transport.
"""
from datetime import datetime, timedelta
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile

import brief as b

TABLES=('articles','observations','jobs','issues','calls','meta')


def atomic(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_suffix(path.suffix+'.tmp')
    with temporary.open('w') as f:
        json.dump(value,f,ensure_ascii=False,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    temporary.replace(path)


class Store:
    def __init__(self,root,sync_git=False):
        self.root=Path(root).resolve();self.sync_git=sync_git
        self.root.mkdir(parents=True,exist_ok=True)
        if sync_git:
            result=subprocess.run(['gh','repo','view','--json','nameWithOwner,visibility'],cwd=self.root,
                                  check=True,capture_output=True,text=True)
            repo=json.loads(result.stdout)
            if repo!={'nameWithOwner':'nowscott/EverydayTechNews-data','visibility':'PRIVATE'}:
                raise ValueError('only_designated_private_state_repository_allowed')
        self.db=b.connect(self.root)
        self.path=self.root/'durable/state.json'
        self.manifest_path=self.root/'archive-manifests/objects.json'
        self.objects=json.loads(self.manifest_path.read_text()) if self.manifest_path.exists() else {}
        self.missing=[]
        if self.path.exists():
            try:self.restore()
            except Exception:
                self.db.close();raise

    def put_bulk(self,relative,payload,captured=None):
        if relative in self.objects:
            item=self.objects[relative]
            if b.now()>=datetime.fromisoformat(item['expires_at']):return
            # A newly copied object must not extend the original retention period.
        else:
            clock=datetime.fromisoformat(captured) if captured else b.now()
            self.objects[relative]=dict(sha256=hashlib.sha256(payload).hexdigest(),bytes=len(payload),
                captured_at=clock.isoformat(),expires_at=(clock+timedelta(days=90)).isoformat())
        path=self.root/'transient'/relative;path.parent.mkdir(parents=True,exist_ok=True)
        if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest()!=self.objects[relative]['sha256']:
            raise ValueError('evidence_hash_conflict')
        path.write_bytes(payload)

    def shrink(self,value):
        if isinstance(value,list):return [self.shrink(x) for x in value]
        if not isinstance(value,dict):return value
        obj=dict(value)
        if 'text' in obj:
            payload=json.dumps(dict(text=obj.pop('text'),description_clean=obj.pop('description_clean','')),ensure_ascii=False).encode()
            relative='bodies/'+hashlib.sha256(payload).hexdigest()+'.json'
            if not obj.get('evidence_expired_or_missing'):
                self.put_bulk(relative,payload,obj.get('fetched_at'))
                obj['_body_ref']=relative
            obj.pop('offline_excerpt',None)
        obj.pop('failed_model_responses',None)
        for field in ['feed_snapshot','body_snapshot']:
            if field in obj:obj[field]=str(obj[field]).split('/feeds/')[-1]
        return {k:self.shrink(v) for k,v in obj.items()}

    def expand(self,value):
        if isinstance(value,list):return [self.expand(x) for x in value]
        if not isinstance(value,dict):return value
        obj={k:self.expand(v) for k,v in value.items()}
        if '_body_ref' in obj:
            ref=obj['_body_ref'];path=self.root/'transient'/ref;entry=self.objects.get(ref,{})
            if path.exists() and entry and b.now()<datetime.fromisoformat(entry['expires_at']):
                if hashlib.sha256(path.read_bytes()).hexdigest()!=entry['sha256']:raise ValueError('evidence_integrity_failed')
                obj.update(json.loads(path.read_text()))
                obj.pop('evidence_expired_or_missing',None)
            else:
                obj.update(text='',description_clean='',evidence_expired_or_missing=True)
                self.missing.append(ref)
        return obj

    def restore(self):
        document=json.loads(self.path.read_text())
        if document.get('schema_version')!=1:raise ValueError('unsupported_state_version')
        with self.db:
            for table in TABLES+('responses',):self.db.execute('DELETE FROM '+table)
            for table,rows in document['tables'].items():
                if table not in TABLES:raise ValueError('unknown_state_table')
                columns={r[1] for r in self.db.execute('PRAGMA table_info('+table+')')}
                for row in rows:
                    if not set(row)<=columns:raise ValueError('unknown_state_column')
                    row=dict(row)
                    for field in ['data','article','result']:
                        if row.get(field):row[field]=json.dumps(self.expand(json.loads(row[field])),ensure_ascii=False)
                    names=list(row)
                    self.db.execute('INSERT INTO '+table+' ('+','.join(names)+') VALUES ('+','.join('?' for _ in names)+')',[row[k] for k in names])
        # Only raw completions that have not expired can be restored for offline revalidation.
        for path in (self.root/'transient/responses').glob('*.json'):
            relative=str(path.relative_to(self.root/'transient'))
            entry=self.objects.get(relative)
            if not entry or b.now()>=datetime.fromisoformat(entry['expires_at']):continue
            if hashlib.sha256(path.read_bytes()).hexdigest()!=entry['sha256']:raise ValueError('response_integrity_failed')
            row=json.loads(path.read_text())
            with self.db:self.db.execute('INSERT OR REPLACE INTO responses VALUES (?,?,?)',(row['call_id'],row['data'],row['validation_error']))
        health=self.db.execute("SELECT data FROM meta WHERE key='health'").fetchone()
        if health:atomic(self.root/'source-health.json',json.loads(health[0]))

    def checkpoint(self):
        self.db.commit()
        tables={}
        for table in TABLES:
            rows=[]
            for raw in self.db.execute('SELECT * FROM '+table+' ORDER BY rowid'):
                row=dict(raw)
                for field in ['data','article','result']:
                    if row.get(field):row[field]=json.dumps(self.shrink(json.loads(row[field])),ensure_ascii=False,sort_keys=True)
                rows.append(row)
            tables[table]=rows
        for row in self.db.execute('SELECT * FROM responses'):
            self.put_bulk('responses/'+str(row['call_id'])+'.json',json.dumps(dict(row),ensure_ascii=False).encode())
        for path in (self.root/'feeds').glob('*/*'):
            self.put_bulk('raw/feeds/'+str(path.relative_to(self.root/'feeds')),path.read_bytes())
            path.unlink()
        atomic(self.manifest_path,self.objects)
        atomic(self.path,dict(schema_version=1,tables=tables))
        if self.sync_git:self.push()

    def push(self):
        # Never commit SQLite, fulltext, env files, review tables or archives.
        if not (self.root/'.git').exists():raise ValueError('private_git_checkout_required')
        run=lambda args:subprocess.run(args,cwd=self.root,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        paths=[p for p in ['durable','archive-manifests','issues','deliveries','trial.json','test-delivery-config.json','status.json','trial-report.json'] if (self.root/p).exists()]
        run(['git','add','--',*paths])
        result=subprocess.run(['git','diff','--cached','--quiet'],cwd=self.root)
        if result.returncode not in (0,1):raise RuntimeError('git_state_check_failed')
        if result.returncode==1:run(['git','commit','-m','Persist internal newsletter state'])
        # No pull/rebase/replay: a remote conflict fails closed before transport.
        run(['git','push','origin','HEAD:main'])

    def archive(self,day=None):
        for directory in ['reviews','drafts']:
            for item in (self.root/'transient'/directory).rglob('*'):
                if item.is_file():self.put_bulk(str(item.relative_to(self.root/'transient')),item.read_bytes())
        self.checkpoint();self.expire()
        path=self.root/'.cache/evidence.tar.gz';path.parent.mkdir(parents=True,exist_ok=True)
        transient=self.root/'transient';transient.mkdir(exist_ok=True)
        with tarfile.open(path,'w:gz') as archive:
            for relative,entry in self.objects.items():
                source=transient/relative
                if source.exists() and entry.get('status')!='expired' and (not day or datetime.fromisoformat(entry['captured_at']).astimezone(b.SH).date().isoformat()==day):
                    archive.add(source,arcname='transient/'+relative)
        return path

    def expire(self):
        for relative,entry in self.objects.items():
            if b.now()>=datetime.fromisoformat(entry['expires_at']):
                (self.root/'transient'/relative).unlink(missing_ok=True)
                entry['status']='expired'
        atomic(self.manifest_path,self.objects)


def restore_artifact(root):
    root=Path(root);pointer=root/'archive-manifests/latest.json'
    if not pointer.exists():return
    data=json.loads(pointer.read_text())
    if data.get('kind')=='daily_buckets':
        days=json.loads((root/'archive-manifests/days.json').read_text())
        for day,entry in days.items():
            if b.now()>=datetime.fromisoformat(day+'T00:00:00+08:00')+timedelta(days=91):continue
            download_bucket(root,entry)
        return
    download_bucket(root,data)


def download_bucket(root,data):
    cache=root/'.cache/download';cache.mkdir(parents=True,exist_ok=True)
    if data.get('kind')=='migration_release':
        if not data['release_tag'].startswith('premium-migration-'):raise ValueError('invalid_migration_tag')
        command=['gh','release','download',data['release_tag'],'--repo',os.environ['GITHUB_REPOSITORY'],
                 '--pattern','evidence.tar.gz','--dir',str(cache),'--clobber']
    else:
        if b.now()>=datetime.fromisoformat(data['at'])+timedelta(days=90):return
        command=['gh','run','download',str(data['run_id']),'--repo',os.environ['GITHUB_REPOSITORY'],
                 '--name',data['artifact_name'],'--dir',str(cache)]
    subprocess.run(command,check=True,stdout=subprocess.DEVNULL)
    with tarfile.open(cache/'evidence.tar.gz','r:gz') as archive:
        # Data filter rejects traversal, absolute paths, device nodes and escaping links.
        archive.extractall(root,filter='data')
    shutil.rmtree(cache)


def acknowledge_artifact(store):
    """Replace only today's bucket, never extend old originals by rolling them forward."""
    root=store.root;run=os.environ['GITHUB_RUN_ID'];day=b.now().date().isoformat()
    pointer=root/'archive-manifests/latest.json'
    previous=json.loads(pointer.read_text()) if pointer.exists() else {}
    days_path=root/'archive-manifests/days.json'
    days=json.loads(days_path.read_text()) if days_path.exists() else {}
    name='pool-evidence-'+day+'-'+run
    days[day]=dict(run_id=run,artifact_name=name,at=b.stamp())
    atomic(days_path,days)
    atomic(pointer,dict(kind='daily_buckets',retention_days=90,at=b.stamp()))
    store.checkpoint()
    repository=os.environ['GITHUB_REPOSITORY']
    if previous.get('kind')=='migration_release':
        tag=previous['release_tag']
        if not tag.startswith('premium-migration-'):raise ValueError('invalid_migration_tag')
        subprocess.run(['gh','release','delete',tag,'--repo',repository,'--yes','--cleanup-tag'],check=True,stdout=subprocess.DEVNULL)
    # Keep one artifact per capture day. Orphan uploads are cleaned on the next ack.
    listing=subprocess.run(['gh','api','--paginate',f'repos/{repository}/actions/artifacts','--jq',
        '.artifacts[] | [.id,.name,.size_in_bytes] | @tsv'],check=True,capture_output=True,text=True).stdout
    retained={entry['artifact_name'] for capture_day,entry in days.items()
        if b.now()<datetime.fromisoformat(capture_day+'T00:00:00+08:00')+timedelta(days=91)}
    kept_bytes=0;kept_count=0
    for line in listing.splitlines():
        artifact_id,artifact_name,size=line.split('\t')
        if artifact_name.startswith('pool-evidence-') and artifact_name not in retained:
            subprocess.run(['gh','api','--method','DELETE',f'repos/{repository}/actions/artifacts/{artifact_id}'],check=True,stdout=subprocess.DEVNULL)
        elif artifact_name.startswith('pool-evidence-'):
            kept_bytes+=int(size);kept_count+=1
    with store.db:store.db.execute('INSERT OR REPLACE INTO meta VALUES (?,?)',('artifact_storage',json.dumps(dict(at=b.stamp(),bytes=kept_bytes,count=kept_count,quota_or_bill='not_verified'))))
    store.checkpoint()
