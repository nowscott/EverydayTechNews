"""Independent persistent stages for the internal morning newsletter.

Run `pool.py --help`. Never imports subscriber/production delivery code.
"""
import argparse
from collections import Counter
from datetime import date, datetime, timedelta
import fcntl
import html
import json
import os
from pathlib import Path
import shutil
import sys

import brief as b
from durable import Store, atomic, restore_artifact, acknowledge_artifact
from ranking import preferences, choose, VERSION as RANKING_VERSION


def initialize(store):
    path=store.root/'trial.json'
    if path.exists():return json.loads(path.read_text())
    start=b.now().date()+timedelta(days=1)
    config=dict(schema_version=1,mode='internal_test',enabled=False,start=start.isoformat(),days=7,
                expires_at=datetime.combine(start+timedelta(days=7),datetime.min.time(),b.SH).isoformat(),
                allowed_recipient='nowscott@qq.com',daily_budget_cny=2.0,
                model_enabled=False,delivery_enabled=False,production_enabled=False,
                authorization='User-approved finite internal trial; no production subscribers')
    atomic(path,config)
    atomic(store.root/'test-delivery-config.json',dict(allowed_recipient=config['allowed_recipient']))
    store.checkpoint();return config


def trial(store):
    config=json.loads((store.root/'trial.json').read_text())
    if config.get('schema_version')!=1 or config.get('mode')!='internal_test' or config.get('production_enabled'):
        raise ValueError('unsupported_or_production_trial')
    if config.get('days')!=7 or config.get('allowed_recipient')!='nowscott@qq.com':raise ValueError('invalid_trial_boundary')
    start=date.fromisoformat(config['start'])
    expected=datetime.combine(start+timedelta(days=7),datetime.min.time(),b.SH)
    if datetime.fromisoformat(config['expires_at'])!=expected:raise ValueError('trial_expiry_mismatch')
    return config


def active(config,current):
    return bool(config['enabled'] and date.fromisoformat(config['start'])<=current.astimezone(b.SH).date()
                and current<datetime.fromisoformat(config['expires_at']))


def rows(store,cutoff=None):
    result=[json.loads(r[0]) for r in store.db.execute('SELECT data FROM articles')]
    last={}
    for row in store.db.execute('SELECT id,fingerprint,MAX(observed_at) FROM observations WHERE observed_at<=? GROUP BY id,fingerprint',((cutoff or b.now()).isoformat(),)):
        last[(row[0],row[1])]=row[2]
    for a in result:a['_last_observed_at']=last.get((a['id'],a['content_fingerprint']),a['fetched_at'])
    return result


def sent_articles(store):
    used=[]
    for receipt in (store.root/'deliveries').glob('*.json'):
        record=json.loads(receipt.read_text())
        if record.get('status')!='smtp_accepted':continue
        path=store.root/'issues'/record['issue']/'edition.json'
        if path.exists():used.extend(json.loads(path.read_text())['articles'])
    return used


def candidates(store,cutoff,target=32,publication_floor=None):
    articles=[];reasons=[];prior=sent_articles(store)
    for a in rows(store,cutoff):
        if publication_floor and datetime.fromisoformat(a['published_at'])<publication_floor:
            reasons.append(dict(id=a['id'],reason='expires_before_next_edition'));continue
        if a.get('evidence_expired_or_missing'):
            reasons.append(dict(id=a['id'],reason='evidence_expired_or_missing'));continue
        if not a.get('original_article_published_at') and a.get('published_time_kind') in ['hn_submission','atom_update_not_publication','discovery_time_not_publication']:
            reasons.append(dict(id=a['id'],reason='article_publication_unconfirmed'));continue
        matches=[x for x in prior if b.duplicate(a,x)]
        if any(a['content_fingerprint']==x['content_fingerprint'] for x in matches):
            reasons.append(dict(id=a['id'],reason='already_sent_unchanged'));continue
        if matches:
            # Retain updates for review; changed bytes alone do not establish new facts.
            a['prior_versions']=[dict(url=x['url'],fingerprint=x['content_fingerprint']) for x in matches]
            a['update_review_required']=True
        a['output_schema']='dual-1'
        articles.append(a)
    chosen,rejected=b.select(articles,cutoff,target=target)
    # Updates need explicit editorial approval of the factual delta before reuse.
    approved=[]
    for a in chosen:
        approval=store.root/'durable/update-approvals'/(a['content_fingerprint']+'.json')
        if a.get('update_review_required'):
            try:
                record=json.loads(approval.read_text())
                facts=record['new_facts']
                valid=(record['fingerprint']==a['content_fingerprint'] and record['reviewed_by'] and record['reviewed_at']
                       and isinstance(facts,list) and facts and all(isinstance(f,dict) and f.get('fact') and isinstance(f.get('evidence'),str)
                           and len(f['evidence'])>=8 and f['evidence'] in a['text'] for f in facts))
            except (OSError,ValueError,KeyError,TypeError):valid=False
            if not valid:
                rejected.append(dict(id=a['id'],reason='update_delta_pending_review',prior_versions=a['prior_versions']));continue
            a['confirmed_update_facts']=facts
        approved.append(a)
    return approved,reasons+rejected


def writing_window(current):
    end=current.replace(hour=6,minute=0,second=0,microsecond=0)
    if current>=end+timedelta(minutes=15):end+=timedelta(days=1)
    return min(current,end),end-timedelta(hours=24)


def assess(store,cutoff=None):
    cutoff=cutoff or b.now();config=preferences();p=b.load_policy()
    inputs,floor=writing_window(cutoff)
    selected,rejected=candidates(store,inputs,config['new_versions_per_day'],floor)
    for a in selected:
        key=b.cache_key(a,p);a['job_key']=key;a['queued_at']=b.stamp()
        a['generation_policy']=dict(p)
        with store.db:
            store.db.execute('INSERT OR IGNORE INTO jobs(key,article,status) VALUES (?,?,?)',(key,json.dumps(a,ensure_ascii=False),'queued'))
    report=dict(at=cutoff.isoformat(),ranking_version=RANKING_VERSION,config=config,
                selected=[dict(id=a['id'],fingerprint=a['content_fingerprint'],title=a['title'],ranking=a['ranking']) for a in selected],
                rejections=rejected,funnel=dict(total_versions=len(rows(store)),selected=len(selected),excluded=dict(Counter(x['reason'] for x in rejected))))
    atomic(store.root/'durable/assessments'/(cutoff.strftime('%Y%m%dT%H%M%S%f')+'.json'),report)
    store.checkpoint();return report


def enrich(store):
    config=trial(store)
    if not active(config,b.now()) or not config['model_enabled']:return dict(status='trial_or_model_disabled_or_expired',calls=0)
    p=b.load_policy();p['daily_budget_cny']=min(p['daily_budget_cny'],config['daily_budget_cny'])
    permit=dict(mode='internal_test_anytime',issue_id='test-pool-'+config['start'],expires_at=config['expires_at'])
    blocked=b.gate(p,b.now(),True,permit)
    if blocked:return dict(status=blocked,calls=0)
    if not os.environ.get('DEEPSEEK_API_KEY'):return dict(status='missing_api_key',calls=0)
    inputs,floor=writing_window(b.now())
    candidates_now,_=candidates(store,inputs,preferences()['new_versions_per_day'],floor)
    eligible={b.cache_key(a,p) for a in candidates_now}
    current_day=b.now().date().isoformat()
    attempted={r[0] for r in store.db.execute('SELECT DISTINCT job FROM calls WHERE day=?',(current_day,))}
    invoked=0;statuses=[]
    jobs=[dict(r) for r in store.db.execute('SELECT * FROM jobs WHERE result IS NULL')]
    jobs.sort(key=lambda j:json.loads(j['article']).get('ranking',{}).get('score',0),reverse=True)
    for job in jobs:
        if invoked>=preferences()['batch_size']:break
        if job['key'] not in eligible:continue
        a=json.loads(job['article'])
        if job['key'] not in attempted and len(attempted)>=preferences()['new_versions_per_day']:break
        if a.get('evidence_expired_or_missing') or not a.get('text'):continue
        if job['status']=='failed_validation_review':
            known=store.db.execute("SELECT id FROM calls WHERE job=? AND status='invalid_response' AND cost IS NOT NULL",(job['key'],)).fetchone()
            if not known or job['attempts']>=p['max_attempts']:continue
            with store.db:store.db.execute("UPDATE jobs SET status='queued' WHERE key=?",(job['key'],))
        before=store.db.execute('SELECT COUNT(*) FROM calls').fetchone()[0]
        blocked=b.paid_request(store.db,job['key'],a,p,permit,checkpoint=store.checkpoint)
        after=store.db.execute('SELECT COUNT(*) FROM calls').fetchone()[0]
        invoked+=after-before
        if after>before:attempted.add(job['key'])
        statuses.append(dict(job=job['key'],status=blocked or store.db.execute('SELECT status FROM jobs WHERE key=?',(job['key'],)).fetchone()[0]))
        if blocked in ['budget_exhausted','missing_api_key','official_rules_unconfirmed','rules_expired_or_future','test_permit_expired']:break
    store.checkpoint();return dict(status='processed_or_pending',calls=invoked,jobs=statuses)


def verify_api(store):
    """Explicit one-article acceptance test, separate from the seven-day trial.

    The first invocation fixes the job and a 30-minute expiry. Reruns cannot
    extend authorization or select a new article, and reuse completed results.
    """
    if not store.sync_git:raise ValueError('acceptance_requires_authoritative_private_git')
    path=store.root/'durable/acceptance.json';p=b.load_policy()
    if not path.exists():
        chosen,_=candidates(store,b.now(),1)
        if not chosen:return dict(status='no_eligible_acceptance_article')
        article=chosen[0];key=b.cache_key(article,p)
        with store.db:store.db.execute('INSERT OR IGNORE INTO jobs(key,article,status) VALUES (?,?,?)',(key,json.dumps(article,ensure_ascii=False),'queued'))
        atomic(path,dict(mode='internal_test_anytime',issue_id='test-api-acceptance-'+b.now().date().isoformat(),
            job_key=key,expires_at=min(b.now()+timedelta(minutes=30),datetime.fromisoformat(p['valid_until'])).isoformat(),
            purpose='Explicit user-authorized API verification; one article, no email, never counts as trial day'))
        store.checkpoint()
    permit=json.loads(path.read_text());job=store.db.execute('SELECT * FROM jobs WHERE key=?',(permit['job_key'],)).fetchone()
    if not job:return dict(status='acceptance_job_missing')
    if job['status']=='failed_validation_review' and job['attempts']<p['max_attempts']:
        known=store.db.execute("SELECT id FROM calls WHERE job=? AND status='invalid_response' AND cost IS NOT NULL",(job['key'],)).fetchone()
        if known:
            with store.db:store.db.execute("UPDATE jobs SET status='queued' WHERE key=?",(job['key'],))
    before=store.db.execute('SELECT COUNT(*) FROM calls').fetchone()[0]
    blocked=b.paid_request(store.db,job['key'],json.loads(job['article']),p,permit,checkpoint=store.checkpoint)
    row=store.db.execute('SELECT status,result FROM jobs WHERE key=?',(job['key'],)).fetchone()
    result=dict(status=blocked or row['status'],new_calls=store.db.execute('SELECT COUNT(*) FROM calls').fetchone()[0]-before,
                job_key=job['key'],article={k:json.loads(job['article']).get(k) for k in ['id','title','url','source_name','published_at','fetched_at','content_fingerprint']},output=json.loads(row['result']) if row['result'] else None,
                is_trial_day=False,mail_sent=False,accounting=status(store)['calls'])
    atomic(store.root/'durable/api-verification.json',result);store.checkpoint();return result


def reconcile(store):
    # Restart cannot establish whether an inflight external request was charged.
    with store.db:
        store.db.execute("UPDATE jobs SET status='uncertain_requires_review' WHERE status='inflight'")
        store.db.execute("UPDATE calls SET status='interrupted_usage_unknown' WHERE status='reserved'")
    store.expire();store.checkpoint()
    return status(store)


def status(store):
    ledger=[dict(r) for r in store.db.execute('SELECT day,COUNT(*) calls,SUM(cost) estimated_cny,SUM(CASE WHEN cost IS NULL THEN reserved ELSE 0 END) unknown_reserved_cny FROM calls GROUP BY day')]
    for day in ledger:
        usages=[json.loads(r[0]) for r in store.db.execute('SELECT usage FROM calls WHERE day=? AND usage IS NOT NULL',(day['day'],))]
        day['actual_api_tokens']={key:sum(u.get(key,0) for u in usages) for key in ['prompt_tokens','completion_tokens','prompt_cache_hit_tokens']}
        day['calls_with_usage']=len(usages)
    report=dict(at=b.stamp(),jobs=[dict(r) for r in store.db.execute('SELECT status,COUNT(*) count FROM jobs GROUP BY status')],
                calls=ledger,missing_or_expired_evidence=len(set(store.missing)),cost_is_estimate=True,
                sources=(json.loads(store.db.execute("SELECT data FROM meta WHERE key='health'").fetchone()[0]) if store.db.execute("SELECT data FROM meta WHERE key='health'").fetchone() else None),
                archive_bytes=sum(x['bytes'] for x in store.objects.values() if x.get('status')!='expired'),
                actual_artifact_storage=(json.loads(store.db.execute("SELECT data FROM meta WHERE key='artifact_storage'").fetchone()[0]) if store.db.execute("SELECT data FROM meta WHERE key='artifact_storage'").fetchone() else None),
                storage_quota='Check private Actions billing; storage is not assumed free or unlimited')
    atomic(store.root/'status.json',report)
    return report


def compose(store):
    config=trial(store);current=b.now()
    if not active(config,current):return dict(status='trial_disabled_or_expired')
    cutoff=current.replace(hour=6,minute=0,second=0,microsecond=0)
    deadline=current.replace(hour=6,minute=15,second=0,microsecond=0)
    if current<deadline:return dict(status='generation_deadline_not_reached')
    issue_id='test-'+current.date().isoformat();out=store.root/'issues'/issue_id
    if (out/'edition.json').exists():return json.loads((out/'edition.json').read_text())
    chosen,rejected=candidates(store,cutoff,preferences()['new_versions_per_day'])
    selected=[];records=[];p=b.load_policy()
    for a in chosen:
        key=b.cache_key(a,p);row=store.db.execute('SELECT * FROM jobs WHERE key=?',(key,)).fetchone()
        if not row or not row['result']:
            rejected.append(dict(id=a['id'],reason='ai_not_ready',job_status=row['status'] if row else 'not_queued'));continue
        result=json.loads(row['result'])
        if datetime.fromisoformat(result['generated_at'])>deadline:
            rejected.append(dict(id=a['id'],reason='generated_after_deadline'));continue
        try:b.validate(result,a)
        except ValueError:
            rejected.append(dict(id=a['id'],reason='saved_result_failed_current_validation'));continue
        a['job_key']=key
        calls=[dict(x) for x in store.db.execute('SELECT * FROM calls WHERE job=?',(key,))]
        records.append(dict(article=a,result=result,status=row['status'],calls=calls,human_review='not_started',
            critical_fact_errors=None,unsupported_claims=None,omissions=None,edits_needed=None))
        selected.append(a)
        if len(selected)>=preferences()['edition_maximum']:break
    health=status(store)['sources']
    issue=dict(id=issue_id,pool_edition=True,mode='daily_24h',collection_cutoff=cutoff.isoformat(),generation_cutoff=deadline.isoformat(),
        frozen_at=current.isoformat(),articles=selected,rejected=rejected,source_health=health,
        shortfall=max(0,preferences()['edition_minimum']-len(selected)),human_review='not_started',
        kind='newsletter' if len(selected)>=preferences()['edition_minimum'] else 'diagnostic',sendable_count=0)
    out.mkdir(parents=True,exist_ok=True)
    from email_layout import build_email
    doc,plain=build_email(issue,records)
    if issue['shortfall']:
        draft=store.root/'transient/drafts'/issue_id;draft.mkdir(parents=True,exist_ok=True)
        (draft/'email.html').write_text(doc);(draft/'email.txt').write_text(plain)
        funnel=dict(Counter(r['reason'] for r in rejected))
        plain='【测试】早报异常诊断\n未经逐条人工事实审阅。\n'+f'本期仅 {len(selected)} 条通过程序校验，未达到15条，不发送正常早报。\n采集截止：{cutoff.isoformat()}\n生成截止：{deadline.isoformat()}\n'+json.dumps(funnel,ensure_ascii=False,indent=2)+'\n来源健康：\n'+json.dumps(health,ensure_ascii=False,indent=2)+'\n请检查正文、时效、去重、评分、模型任务和预算；草稿已保留。'
        doc='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>【测试】早报异常诊断</title><body style="font:16px/1.8 system-ui;max-width:680px;margin:24px auto;padding:20px"><h1>【测试】早报异常诊断</h1><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+html.escape(plain)+'</pre></body></html>'
    (out/'email.html').write_text(doc);(out/'email.txt').write_text(plain)
    issue['html_sha256']=b.digest(doc);issue['text_sha256']=b.digest(plain)
    # Full original-vs-result review belongs in the 90-day evidence artifact.
    review=store.root/'transient/reviews'/issue_id;review.mkdir(parents=True,exist_ok=True)
    atomic(review/'comparison-full.json',dict(issue=issue,records=records))
    cells=''.join('<tr><td><a href="'+html.escape(r['article']['url'],quote=True)+'">'+html.escape(r['article']['title'])+'</a><pre>'+html.escape(r['article']['text'])+'</pre></td><td><pre>'+html.escape(json.dumps(r['result'],ensure_ascii=False,indent=2))+'</pre><p>关键事实错误 / 无依据陈述 / 遗漏 / 人工修改：待审</p></td></tr>' for r in records)
    (review/'review.html').write_text('<!doctype html><meta charset="utf-8"><title>原文对照审阅</title><style>body{font:15px/1.7 system-ui}table{width:100%;table-layout:fixed}td{vertical-align:top;border:1px solid #ddd;padding:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>未经逐条人工事实审阅</h1><table>'+cells+'</table>')
    import csv
    with (out/'review.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.writer(f);writer.writerow(['文章ID','中文标题','原文链接','关键事实错误','无依据陈述','遗漏','人工修改需求','人工审阅','处理秒','调用次数','估算费用元'])
        for r in records:
            values=[r['article']['id'],r['result']['title'],r['article']['url'],'待审','待审','待审','待审','未开始',sum(c['seconds'] or 0 for c in r['calls']),len(r['calls']),sum(c['cost'] or 0 for c in r['calls'])]
            writer.writerow(["'"+x if isinstance(x,str) and x.startswith(('=','+','-','@')) else x for x in values])
    atomic(out/'comparison.json',store.shrink(dict(issue=issue,records=records,sendable_count=0,cost_is_estimate=True)))
    atomic(out/'ranking.json',dict(version=RANKING_VERSION,selected=[dict(id=a['id'],ranking=a['ranking']) for a in selected],rejected=rejected))
    frozen=store.shrink(issue)
    atomic(out/'edition.json',frozen)
    with store.db:store.db.execute('INSERT OR IGNORE INTO issues VALUES (?,?)',(issue_id,json.dumps(issue,ensure_ascii=False)))
    store.checkpoint();return frozen


def deliver(store):
    config=trial(store);current=b.now()
    if not active(config,current) or not config['delivery_enabled']:return dict(status='trial_or_delivery_disabled_or_expired')
    if current.hour!=6 or current.minute<30:return dict(status='outside_0630_0700_delivery_window')
    issue_id='test-'+current.date().isoformat();out=store.root/'issues'/issue_id
    if not (out/'edition.json').exists():return dict(status='edition_missing_do_not_send')
    edition=json.loads((out/'edition.json').read_text())
    if b.digest((out/'email.html').read_text())!=edition['html_sha256'] or b.digest((out/'email.txt').read_text())!=edition['text_sha256']:
        return dict(status='frozen_content_changed_do_not_send')
    from test_delivery import send_once
    names=['SENDING_ACCOUNT','SENDING_PASSWORD','SERVER']
    if not all(os.environ.get(k) for k in names):return dict(status='missing_test_smtp_configuration')
    receipt=send_once(store.root,issue_id,config['allowed_recipient'],*(os.environ[k] for k in names),checkpoint=store.checkpoint)
    store.checkpoint();return receipt


def report_trial(store):
    config=trial(store);start=date.fromisoformat(config['start']);days=[]
    for offset in range(7):
        day=(start+timedelta(days=offset)).isoformat();path=store.root/'issues'/('test-'+day)/'edition.json'
        issue=json.loads(path.read_text()) if path.exists() else None
        receipts=[json.loads(p.read_text()) for p in (store.root/'deliveries').glob('*.json')]
        receipts=[r for r in receipts if r['issue']=='test-'+day]
        missed=(not issue and (day<b.now().date().isoformat() or (day==b.now().date().isoformat() and b.now().hour>=7)))
        days.append(dict(day=day,status='missing' if not issue else issue['kind'],reason='scheduler_missed_delivery_deadline' if missed else None,generated=0 if not issue else len(issue['articles']),
            delivery=[r['status'] for r in receipts],human_review='not_started',normal_edition=bool(issue and issue['kind']=='newsletter' and any(r['status']=='smtp_accepted' for r in receipts))))
    result=dict(days=days,completed_normal_editions=sum(d['normal_edition'] for d in days),accounting=status(store)['calls'],human_fact_review='not_completed',bill_paid='not_verified')
    atomic(store.root/'trial-report.json',result);store.checkpoint();return result


def import_legacy(store,source):
    if store.path.exists() and store.db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0]:raise ValueError('import_requires_empty_target')
    if not (source/'state.sqlite3').exists():raise ValueError('legacy_database_missing')
    import sqlite3
    original=sqlite3.connect('file:'+str((source/'state.sqlite3').resolve())+'?mode=ro',uri=True)
    original.row_factory=sqlite3.Row
    with store.db:
        for table in ('articles','observations','jobs','issues','calls','responses','meta'):
            for row in original.execute('SELECT * FROM '+table):
                names=list(row.keys())
                store.db.execute('INSERT OR IGNORE INTO '+table+' ('+','.join(names)+') VALUES ('+','.join('?' for _ in names)+')',tuple(row))
    original.close()
    for directory in ['feeds','deliveries']:
        if (source/directory).exists():shutil.copytree(source/directory,store.root/directory,dirs_exist_ok=True)
    for issue_dir in (source/'issues').iterdir():
        if not issue_dir.is_dir():continue
        destination=store.root/'issues'/issue_dir.name;destination.mkdir(parents=True,exist_ok=True)
        for name in ['email.html','email.txt','ranking.json']:
            if (issue_dir/name).exists():shutil.copy2(issue_dir/name,destination/name)
        if (issue_dir/'comparison.json').exists():
            data=json.loads((issue_dir/'comparison.json').read_text())
            data['migration_note']='Historical quality sample / prior experiment, never counted as seven-day trial; original generation metadata preserved, legacy versions may be unknown'
            atomic(destination/'comparison.json',store.shrink(data))
        for name in ['review.html','review.csv','comparison.json']:
            if (issue_dir/name).exists():
                store.put_bulk('legacy-reviews/'+issue_dir.name+'/'+name,(issue_dir/name).read_bytes())
    store.checkpoint();return dict(status='imported_without_api_or_smtp',calls=store.db.execute('SELECT COUNT(*) FROM calls').fetchone()[0])


def preview_legacy(store):
    """Re-layout real saved AI results, without claiming a new dual-output API test."""
    from itertools import combinations
    from email_layout import build_email
    existing=store.root/'issues/sample-2026-10-18-pool-preview/comparison.json'
    if existing.exists():return dict(path=str(existing.parent),reused=True,new_model_calls=0,new_deliveries=0)
    source=store.db.execute("SELECT data FROM issues WHERE id='sample-2026-10-18-ai'").fetchone()
    if not source:raise ValueError('legacy_ai_sample_missing')
    old=json.loads(source[0]);records=[]
    for a in old['articles']:
        j=store.db.execute('SELECT * FROM jobs WHERE key=?',(a['job_key'],)).fetchone()
        if not j or not j['result']:continue
        result=json.loads(j['result'])
        # Pick existing complete AI-authored points. No invented summary or translation.
        options=[' '.join(xs) for n in (1,2,3) for xs in combinations(result.get('points',[]),n)]
        options=[x for x in options if 50<=len(x)<=80]
        short=min(options,key=lambda x:abs(len(x)-65)) if options else None
        records.append(dict(article=a,result=result,status='historical_pending_human_review',calls=[dict(c) for c in store.db.execute('SELECT * FROM calls WHERE job=?',(a['job_key'],))],short_option=short))
    leads=[r for r in records if len(r['result']['summary'])<=150][:5]
    briefs=[r for r in records if r not in leads and r['short_option']][:15]
    ordered=leads+briefs
    for r in briefs:
        r['result']['short_summary']=r['short_option']
        r['result'].setdefault('program_edits',[]).append(dict(action='reuse_complete_existing_ai_points',
            note='从历史DeepSeek生成要点选择完整句子用于短讯；未调用新版双长度提示词，尚待人工核对'))
    for r in ordered:r.pop('short_option',None)
    issue=dict(old,id='sample-2026-10-18-pool-preview',pool_edition=True,articles=[r['article'] for r in ordered],
               created_at=b.stamp(),preview_note='历史结果重排；5条重点+15条短讯；不是新版双长度API验证或今日24小时出刊')
    out=store.root/'issues'/issue['id'];out.mkdir(parents=True,exist_ok=True)
    doc,plain=build_email(issue,ordered)
    notice='历史结果重排：短讯选用已保存的DeepSeek完整要点。未新增模型调用，未验证新版双长度提示词；未经逐条人工事实审阅。'
    doc=doc.replace('</body>','<p style="max-width:680px;margin:20px auto;padding:16px;font:13px/1.8 system-ui">'+html.escape(notice)+'</p></body>')
    (out/'email.html').write_text(doc);(out/'email.txt').write_text(plain+'\n\n'+notice)
    atomic(out/'comparison.json',store.shrink(dict(issue=issue,records=ordered,new_model_calls=0,sendable_count=0,
        legacy_accounting=status(store)['calls'],human_review='not_started',note=notice)))
    review=store.root/'transient/reviews'/issue['id'];review.mkdir(parents=True,exist_ok=True)
    atomic(review/'comparison-full.json',dict(issue=issue,records=ordered))
    cells=''.join('<tr><td><h2>'+html.escape(r['article']['title'])+'</h2><pre>'+html.escape(r['article']['text'])+'</pre></td><td><pre>'+html.escape(json.dumps(r['result'],ensure_ascii=False,indent=2))+'</pre><p>事实错误 / 无依据陈述 / 遗漏 / 修改需求：待审</p></td></tr>' for r in ordered)
    (review/'review.html').write_text('<!doctype html><meta charset="utf-8"><title>历史AI结果与原文对照</title><style>body{font:15px/1.7 system-ui}table{width:100%;table-layout:fixed}td{vertical-align:top;border:1px solid #ddd;padding:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>'+html.escape(notice)+'</h1><table>'+cells+'</table>')
    store.checkpoint();return dict(path=str(out),leads=len(leads),briefs=len(briefs),new_model_calls=0,new_deliveries=0)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['init','collect','assess','enrich','verify-api','compose','deliver','reconcile','status','report','import-legacy','preview-legacy','archive','restore-artifact','ack-artifact'])
    parser.add_argument('--data',type=Path,default=Path('premium_data/pool'))
    parser.add_argument('--legacy',type=Path)
    parser.add_argument('--sync-git',action='store_true',help='Persist private Git checkpoints before external side effects')
    args=parser.parse_args();args.data.mkdir(parents=True,exist_ok=True)
    if args.command=='restore-artifact':restore_artifact(args.data);return
    with (args.data/'pool.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        store=Store(args.data,args.sync_git)
        if args.command=='init':result=initialize(store)
        elif args.command=='import-legacy':result=import_legacy(store,args.legacy or Path('premium_data'))
        elif args.command=='preview-legacy':result=preview_legacy(store)
        elif args.command=='collect':
            result=b.collect(store.db,store.root);store.checkpoint();assess(store)
        elif args.command=='assess':result=assess(store)
        elif args.command=='enrich':result=enrich(store)
        elif args.command=='verify-api':result=verify_api(store)
        elif args.command=='compose':result=compose(store)
        elif args.command=='deliver':result=deliver(store)
        elif args.command=='reconcile':result=reconcile(store)
        elif args.command=='status':result=status(store)
        elif args.command=='report':result=report_trial(store)
        elif args.command=='archive':
            remote=os.environ.get('GITHUB_ACTIONS')=='true'
            day=b.now().date().isoformat()
            result=dict(archive=str(store.archive(day if remote else None)))
            if remote:
                with open(os.environ['GITHUB_OUTPUT'],'a') as output:output.write('artifact_name=pool-evidence-'+day+'-'+os.environ['GITHUB_RUN_ID']+'\n')
        else:
            acknowledge_artifact(store);result=dict(status='artifact_pointer_saved')
        store.db.close()
        print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
