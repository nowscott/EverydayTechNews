#!/usr/bin/env python3
"""Offline Python/TS comparison on the operator computer; remote news processing stays TS."""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import subprocess
import sys

HOST='nowscott@192.168.31.10'
ROOT='/vol3/1000/Docker/everydaytechnews-ordinary/data'
SSH=['ssh','-i',str(Path.home()/'.ssh/everydaytechnews_nas'),'-o','BatchMode=yes',HOST,'python3 -']

def remote(code):
    r=subprocess.run(SSH,input=code,text=True,capture_output=True,check=True)
    return json.loads(r.stdout)

def verify(date):
    payload=remote(f'''from pathlib import Path
import json
r=Path({ROOT!r});date={date!r};issue=r/'issues'/('shadow-'+date+'.json')
if not issue.exists():print(json.dumps({{'status':'shadow_issue_missing'}}))
else:
 i=json.loads(issue.read_text());p=r/'rank-evidence'/(i['news_day']+'.json')
 print(json.dumps({{'issue':i,'rank':json.loads(p.read_text()) if p.exists() else None}}))
''')
    if 'issue' not in payload:return payload
    i=payload['issue'];e=payload['rank']
    if not e:return {'status':'rank_evidence_missing','date':date}
    sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'src'))
    import news_sorter as sorter
    import newsletter
    scores={}
    for row in e['grades']:
        if row['status']=='valid':score=sorter.calculate_score(*json.loads(row['data'])['votes'])
        elif row['status']=='filtered':score=sorter.FILTERED_SCORE
        else:score=sorter.FAILED_SCORE
        if score!=row['score']:return {'status':'score_formula_mismatch','date':date}
        scores[row['url']]=score
    items=sorter.sort_news_by_value(sorter.parse_news(e['before']),scores)
    markdown=f"# 今日新闻 - {i['news_day'].replace('-', '年',1).replace('-', '月',1)}日(sorted)\n"+sorter.format_news_to_md(items)
    expected=newsletter.format_news(markdown)
    if expected!=i['body']:return {'status':'render_or_selection_mismatch','date':date}
    if hashlib.sha256(markdown.encode()).hexdigest()!=i['archive_sha256']:return {'status':'frozen_input_mismatch','date':date}
    result={'status':'passed','date':date,'issue':i['id'],'input_sha256':e['input_sha256'],'frozen_archive_sha256':i['archive_sha256'],
            'method':'legacy Python oracle, same captured candidates and vote evidence, no network or mail', 'checked_at':dt.datetime.now(dt.timezone.utc).isoformat()}
    literal=repr(result)
    remote(f'''from pathlib import Path
import json,os
r=Path({ROOT!r});value={literal};p=r/'shadow'/({date!r}+'-parity.json');p.parent.mkdir(mode=0o700,exist_ok=True)
t=p.with_suffix('.tmp');t.write_text(json.dumps(value,ensure_ascii=False,indent=2));os.chmod(t,0o600);os.replace(t,p)
p=r/'reports'/({date!r}+'.json')
if p.exists():
 v=json.loads(p.read_text());v['parity']=value;t=p.with_suffix('.tmp');t.write_text(json.dumps(v,ensure_ascii=False,indent=2));os.chmod(t,0o600);os.replace(t,p)
print(json.dumps({{'saved':True}}))
''')
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--date',default=dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date().isoformat());a=p.parse_args()
    print(json.dumps(verify(a.date)))
