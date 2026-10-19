"""Prepare a disabled private checkout. Does not push or enable scheduling."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import brief as b
from durable import Store,atomic


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine-ref',required=True)
    parser.add_argument('--source',type=Path,default=Path('premium_data/pool'))
    parser.add_argument('--checkout',type=Path,default=Path('premium_data/private-checkout'))
    args=parser.parse_args()
    if not re.fullmatch('[0-9a-f]{40}',args.engine_ref):parser.error('Use a full reviewed Git SHA')
    if args.checkout.exists():parser.error('Destination exists; do not overwrite private state')
    metadata=json.loads(subprocess.run(['gh','repo','view','nowscott/EverydayTechNews-data','--json','visibility'],capture_output=True,text=True,check=True).stdout)
    if metadata['visibility']!='PRIVATE':parser.error('Data repository must be private')
    subprocess.run(['gh','repo','clone','nowscott/EverydayTechNews-data',str(args.checkout)],check=True)
    store=Store(args.source);archive=store.archive();store.db.close()
    for directory in ['durable','archive-manifests','issues','deliveries']:
        if (args.source/directory).exists():shutil.copytree(args.source/directory,args.checkout/directory,dirs_exist_ok=True)
    for file in ['trial.json','test-delivery-config.json','status.json','trial-report.json']:
        if (args.source/file).exists():shutil.copy2(args.source/file,args.checkout/file)
    config=json.loads((args.checkout/'trial.json').read_text())
    config.update(enabled=False,model_enabled=False,delivery_enabled=False,production_enabled=False)
    atomic(args.checkout/'trial.json',config)
    (args.checkout/'.gitignore').write_text(Path(__file__).with_name('private.gitignore').read_text())
    workflow=args.checkout/'.github/workflows/premium-pool.yml';workflow.parent.mkdir(parents=True,exist_ok=True)
    workflow.write_text(Path(__file__).with_name('private-workflow.yml.template').read_text().replace('__ENGINE_SHA__',args.engine_ref))
    (args.checkout/'README.md').write_text('# Private internal newsletter state\n\nProduction disabled. See public engine experiments/premium/README.md.\n\nEngine SHA: '+args.engine_ref+'\nFull text is in expiring private Actions artifacts; SQLite is rebuilt.\n')
    tag='premium-migration-'+b.now().strftime('%Y%m%d%H%M%S')
    atomic(args.checkout/'archive-manifests/latest.json',dict(kind='migration_release',release_tag=tag,at=b.stamp(),
        note='Temporary private transfer bridge; removed after successful Actions artifact upload; no fulltext in Git'))
    print(json.dumps(dict(checkout=str(args.checkout),migration_archive=str(archive),migration_release_tag=tag,
        enabled=False,next='Commit/push private checkout; upload private migration release; run maintenance_only bootstrap'),ensure_ascii=False,indent=2))


if __name__=='__main__':main()
