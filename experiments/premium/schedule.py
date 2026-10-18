"""Reconcile due work from Shanghai wall time, not from expected cron arrival."""
import json
import os
from pathlib import Path
import brief as b


def due(root,current):
    root=Path(root);plan=json.loads((root/'trial.json').read_text())
    from pool import active
    enabled=active(plan,current)
    morning=current.hour==6
    frozen=(root/'issues'/('test-'+current.date().isoformat())/'edition.json').exists()
    health=root/'source-health.json'
    observed=json.loads(health.read_text()).get('at') if health.exists() else None
    collect=not observed or (current-b.datetime.fromisoformat(observed)).total_seconds()>=1800
    # Before cutoff, add one final collection around 05:55.
    if current.hour==5 and current.minute>=55 and (not observed or b.datetime.fromisoformat(observed).minute<50):collect=True
    return dict(compose=enabled and morning and current.minute>=15 and not frozen,
                deliver=enabled and morning and current.minute>=30,
                collect=collect and not (morning and current.minute>=15),
                enrich=enabled and plan['model_enabled'] and not (morning and current.minute>=12),
                maintain=True)


if __name__=='__main__':
    flags=due(Path(os.environ.get('PREMIUM_DATA','state')),b.now())
    with open(os.environ['GITHUB_OUTPUT'],'a') as f:
        for key,value in flags.items():f.write(key+'='+str(value).lower()+'\n')
