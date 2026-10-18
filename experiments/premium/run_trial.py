"""Local wrapper for independent pool stages; never installs a scheduler."""
import argparse
from pathlib import Path
import subprocess
import sys
import brief as b
from schedule import due


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['init','tick','report'])
    parser.add_argument('--data',type=Path,default=Path('premium_data/pool'))
    parser.add_argument('--sync-git',action='store_true')
    args=parser.parse_args()
    base=[sys.executable,str(Path(__file__).with_name('pool.py'))]
    def run(stage):
        subprocess.run(base+[stage,'--data',str(args.data)]+(['--sync-git'] if args.sync_git else []),check=True)
    if args.command in ['init','report']:run(args.command);return
    flags=due(args.data,b.now())
    for stage in ['compose','deliver','collect','enrich']:
        if flags[stage]:run(stage)
    run('report')


if __name__=='__main__':main()
