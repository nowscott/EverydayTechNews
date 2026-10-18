"""Read-only performance experiment: no model, SMTP, subscriber or pool mutation.

Replay uses real archived RSS with explicitly simulated network delay. --live
instead fetches six public RSS feeds twice, in disposable isolated databases.
"""
import argparse
from contextlib import nullcontext
import cProfile
import io
import json
from pathlib import Path
import platform
import pstats
import statistics
import tarfile
import tempfile
import time
from unittest.mock import Mock, patch

import brief as b

LIVE_SOURCES=('ithome','nvidia','github','cloudflare','microsoft_foundry','macrumors')


def archived_feeds(path):
    feeds={}
    with tarfile.open(path) as archive:
        for member in archive.getmembers():
            source=Path(member.name).parent.name
            if member.isfile() and '/feeds/' in member.name and member.name.endswith('.xml') and source in b.SOURCES and source!='apple':
                if member.size>20_000_000:raise ValueError('oversized_feed')
                feeds[source]=archive.extractfile(member).read()
    if not feeds:raise ValueError('no_rss_snapshots')
    return feeds


def run(archive=None,live=False,delay=.2,repeats=3):
    feeds=archived_feeds(archive) if archive else {}
    sources={k:b.SOURCES[k] for k in (LIVE_SOURCES if live else sorted(feeds))}
    by_url={v[1]:k for k,v in sources.items()}

    def replay_get(url,**kwargs):
        time.sleep(delay)
        return Mock(content=feeds[by_url[url]],status_code=200,url=url)

    report=dict(at=b.stamp(),python=platform.python_version(),platform=platform.platform(),
                mode='live_network' if live else 'archived_rss_simulated_network',
                simulated_delay_seconds=None if live else delay,sources=list(sources),
                caveat='Local measurements; live network/cache/contents may vary. Not an end-to-end AI speedup.',runs=[])
    fingerprints=[]
    with tempfile.TemporaryDirectory() as temp,patch.object(b,'SOURCES',sources):
        for repeat in range(repeats):
            # Alternate order to reduce simple warm-cache/order bias.
            for workers in ((1,4) if repeat%2==0 else (4,1)):
                folder=Path(temp)/f'{repeat}-{workers}';db=b.connect(folder)
                try:
                    with nullcontext() if live else patch.object(b.requests,'get',side_effect=replay_get):
                        health=b.collect(db,folder,max_workers=workers)
                    perf=json.loads((folder/'source-health.json').read_text())['performance']
                    identities=sorted(tuple(r) for r in db.execute('SELECT id,fingerprint FROM articles'))
                    fingerprints.append(identities)
                    report['runs'].append(dict(repeat=repeat,workers=workers,articles=len(identities),
                        performance=perf,sources=[{k:x.get(k) for k in ('source','ok','count','seconds','http_status')} for x in health]))
                finally:db.close()
    report['identical_article_versions']=all(x==fingerprints[0] for x in fingerprints)
    medians={str(w):statistics.median(r['performance']['wall_seconds'] for r in report['runs'] if r['workers']==w) for w in (1,4)}
    report.update(median_wall_seconds=medians,median_speedup=medians['1']/medians['4'])
    if feeds:
        profile=cProfile.Profile();profile.enable();started=time.perf_counter();count=0
        for source,raw in sorted(feeds.items()):count+=len(b.parse_feed(raw,source,'2026-10-18T12:00:00+08:00'))
        elapsed=time.perf_counter()-started;profile.disable()
        stream=io.StringIO();pstats.Stats(profile,stream=stream).sort_stats('cumulative').print_stats(12)
        report['parse_profile']=dict(articles=count,seconds=elapsed,top=stream.getvalue())
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    mode=parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--archive',type=Path);mode.add_argument('--live',action='store_true')
    parser.add_argument('--delay',type=float,default=.2)
    parser.add_argument('--repeats',type=int,default=3)
    parser.add_argument('--output',type=Path,default=Path('premium_data/performance/benchmark.json'))
    args=parser.parse_args()
    if not 1<=args.repeats<=10 or not 0<=args.delay<=2:parser.error('repeats 1..10; delay 0..2 seconds')
    report=run(args.archive,args.live,args.delay,args.repeats)
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in {'runs','parse_profile'}},ensure_ascii=False))


if __name__=='__main__':main()
