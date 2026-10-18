"""Offline reference only: imports ranking, never the paid/pool/delivery engines."""
import argparse
import copy
from datetime import datetime
import json
from pathlib import Path
import resource
import statistics
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'experiments/premium'))
import ranking


def execute(value, cached=False):
    cutoff = datetime.fromisoformat(value['cutoff'])
    config = value.get('config')
    original_preferences = ranking.preferences
    if config is not None or cached:
        loaded = config if config is not None else ranking.preferences()
        ranking.preferences = lambda: loaded
    try:
        if value.get('operation') == 'evaluate':
            return dict(rankings=[ranking.evaluate(a, cutoff) for a in value['articles']])
        selected, rejected = ranking.choose(value['articles'], cutoff, value.get('sample', False), value.get('target'))
        return dict(selected=selected, rejected=rejected)
    finally:
        ranking.preferences = original_preferences


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--bench', type=Path)
    parser.add_argument('--cached', action='store_true')
    parser.add_argument('--repeats', type=int, default=5)
    args = parser.parse_args()
    if args.bench:
        value = json.loads(args.bench.read_text())
        # Load config once outside the timer for the cached comparison.
        if args.cached:
            value['config'] = value.get('config') or ranking.preferences()
        execute(copy.deepcopy(value), args.cached)  # Untimed warm-up.
        timings = []
        for _ in range(args.repeats):
            data = copy.deepcopy(value)  # Input duplication excluded in both runtimes.
            start = time.perf_counter()
            execute(data, args.cached)
            timings.append(time.perf_counter() - start)
        # ru_maxrss is bytes on Darwin, KiB on Linux.
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        print(json.dumps(dict(seconds=timings, median_seconds=statistics.median(timings),
                              peak_rss_bytes=peak if sys.platform == 'darwin' else peak * 1024)))
    else:
        value = json.load(sys.stdin)
        output = [execute(x) for x in value] if isinstance(value, list) else execute(value)
        print(json.dumps(output, ensure_ascii=False))
