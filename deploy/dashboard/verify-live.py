#!/usr/bin/env python3
"""NAS-only acceptance: authenticated read-only HTTP and independent SQLite oracle.

Never runs a business command. Writes only the dashboard acceptance report.
"""
import argparse
import datetime as dt
import hashlib
import http.cookiejar
import json
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
import urllib.request


def snapshot(root):
    paths = [root/'state.sqlite3',root/'state.sqlite3-wal',root/'state.sqlite3-journal',root/'durable/state.json']
    paths += list((root/'deliveries').glob('*.json'))
    return {str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths if p.is_file()}


def rows(root, sql, values=()):
    # Independent oracle in private temp files; source SQLite never opens writable.
    with tempfile.TemporaryDirectory() as temp:
        before = snapshot(root)
        for suffix in ['', '-wal']:
            p = root/('state.sqlite3'+suffix)
            if p.exists(): shutil.copyfile(p, Path(temp)/p.name)
        if snapshot(root) != before: raise RuntimeError('business_write_during_oracle_capture')
        uri='file:'+str(Path(temp)/'state.sqlite3')+'?mode=ro'
        if not (Path(temp)/'state.sqlite3-wal').exists(): uri+='&immutable=1'
        with sqlite3.connect(uri,uri=True) as db:
            db.row_factory=sqlite3.Row
            return [dict(row) for row in db.execute(sql,values)]


def verify(root, base, ordinary, premium):
    password=(root/'initial-password.txt').read_text().strip()
    cookies=http.cookiejar.CookieJar()
    client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))
    client.open(urllib.request.Request(base+'/api/login',data=json.dumps({'password':password}).encode(),headers={'Content-Type':'application/json'}),timeout=15).close()
    get=lambda path:json.load(client.open(base+path,timeout=30))
    before={c:snapshot(p) for c,p in [('ordinary',ordinary),('premium',premium)]}
    overview=get('/api/overview')['data']
    today=dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date().isoformat()
    checks=[]
    for entry in overview:
        c=entry['component'];data=entry['data'];source=ordinary if c=='ordinary' else premium
        assert not any(e['source']=='state.sqlite3' and e['state']!='ok' for e in entry['evidence']),c+'_database_unreadable'
        if c=='premium':
            articles=rows(source,'SELECT id,data FROM articles')
            first={}
            for row in articles:
                a=json.loads(row['data']);key=(a['id'],a['content_fingerprint']);time=dt.datetime.fromisoformat(a['fetched_at']).astimezone(dt.timezone(dt.timedelta(hours=8)))
                first[key]=min(first.get(key,time),time)
            expected=sum(t.date().isoformat()==today for t in first.values())
            assert data['collected']==expected,(data['collected'],expected)
            calls=rows(source,'SELECT cost,reserved FROM calls WHERE day=?',(today,))
            assert data['calls']==len(calls)
            assert abs(data['estimated_cny']-sum(v['cost'] or 0 for v in calls))<1e-8
            checks.append({'component':c,'collected':expected,'model_calls':len(calls),'estimated_cny':data['estimated_cny']})
        else:
            p=source/'news_archive'/today[:7]/(today[8:]+'.md')
            expected=len(re.findall(r'^- \[.*?\]\(.*?\)',p.read_text(),re.M)) if p.exists() else 0
            assert data['collected']==expected
            assert data['calls'] is None
            checks.append({'component':c,'source_day_news':expected})
        params='?component='+c+'&from='+today+'&to='+today
        news=get('/api/news'+params)
        assert news['data']['total']==data['collected']
        if c=='premium':
            approved=get('/api/news'+params+'&stage=approved')
            if approved['data']['items']:
                detail=get('/api/news/'+approved['data']['items'][0]['id']+params)
                assert detail['data']['rewrite'].get('title')
                assert detail['data']['review']=='passed'
        issues=get('/api/issues'+params)
        for issue in issues['data']['items']:
            detail=get('/api/issues/'+issue['id']+params)
            assert 'preview_text' in detail['data']
            assert all(not re.search(r'(?<!\*)[A-Za-z0-9._%+-]+@',r.get('recipient') or '') for r in detail['data']['receipts'])
        assert get('/api/runs'+params)['data']['business']['component']==c
    after={c:snapshot(p) for c,p in [('ordinary',ordinary),('premium',premium)]}
    unchanged=before==after
    if not unchanged: raise RuntimeError('business_files_changed_during_read_test_rerun_in_idle_window')
    result={'status':'passed','checked_at':dt.datetime.now(dt.timezone.utc).isoformat(),'url':base,'checks':checks,'business_file_hashes_unchanged':unchanged,'business_files_verified':sum(len(v) for v in before.values()),'dashboard_version':get('/api/health')['version']}
    (root/'acceptance.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print(json.dumps(result,ensure_ascii=False))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',required=True);p.add_argument('--url',required=True);p.add_argument('--ordinary',required=True);p.add_argument('--premium',required=True);a=p.parse_args()
    verify(Path(a.root),a.url,Path(a.ordinary),Path(a.premium))
