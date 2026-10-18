"""Offline oracle for full engine compatibility. Never calls external services."""
from datetime import datetime
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'experiments/premium'))
import brief as b
import adapters


def execute(case):
    op = case['op']
    if op == 'clean': return b.clean(case['text'])
    if op == 'canonical': return b.canonical(case['url'])
    if op == 'feed': return b.parse_feed(case['raw'], case['source'], case['fetched'])
    if op == 'atom': return adapters.parse_atom(case['raw'], case['fetched'])
    if op == 'tesla': return adapters.parse_tesla(case['raw'], case['fetched'])
    if op == 'hn': return b.parse_hn_item(case['item'], case['fetched'], case['rank'])
    if op == 'topic': return b.topic(case['article'])
    if op == 'duplicate': return b.duplicate(case['a'], case['b'])
    if op == 'ratio': return b.difflib.SequenceMatcher(None, case['a'], case['b']).ratio()
    if op == 'select':
        selected,rejected=b.select(case['articles'], datetime.fromisoformat(case['cutoff']),case.get('sample',False),case.get('target'))
        return dict(selected=selected,rejected=rejected)
    if op == 'cache': return b.cache_key(case['article'],case['policy'])
    if op == 'validate':
        try: return dict(ok=True,result=b.validate(case['result'],case['article']))
        except ValueError as error: return dict(ok=False,error=str(error))
    if op == 'cost': return b.cost(case['usage'],case['policy'],case.get('multiplier',1))
    if op == 'gate': return b.gate(case['policy'],datetime.fromisoformat(case['now']),case['verified'],case.get('permit'))
    raise ValueError('unknown_offline_operation')


if __name__=='__main__':
    print(json.dumps([execute(case) for case in json.load(sys.stdin)],ensure_ascii=False))
