"""Read a frozen private edition and its unexpired bodies, without opening Store/SQLite.

Output contains private text. Keep it outside Git, e.g. premium_data/performance/.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--state-root', type=Path, required=True)
parser.add_argument('--issue', required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
root = args.state_root.resolve()
edition_path = (root / 'issues' / args.issue / 'edition.json').resolve()
if not edition_path.is_relative_to(root / 'issues'):
    raise ValueError('invalid_issue_path')
edition = json.loads(edition_path.read_text())
manifest = json.loads((root / 'archive-manifests/objects.json').read_text())
articles = []
for original in edition['articles']:
    ref = original['_body_ref']
    path = (root / 'transient' / ref).resolve()
    if not path.is_relative_to(root / 'transient'):
        raise ValueError('invalid_body_path')
    entry = manifest[ref]
    if datetime.now(timezone.utc) >= datetime.fromisoformat(entry['expires_at']):
        raise ValueError('body_expired')
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != entry['sha256']:
        raise ValueError('body_integrity_failed')
    body = json.loads(raw)['text']
    if original.get('content_status') != 'usable_excerpt' or not body:
        raise ValueError('body_not_usable')
    article = {key: original[key] for key in ['id', 'title', 'source', 'published_at', 'content_status', 'topic']}
    article['text'] = body
    articles.append(article)
payload = dict(articles=articles, cutoff=edition['collection_cutoff'], target=32)
if args.output.resolve().is_relative_to(root):
    raise ValueError('output_must_be_outside_authoritative_state_directory')
# Create with private permissions; do not log source text.
with os.fdopen(os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as handle:
    json.dump(payload, handle, ensure_ascii=False)
print(json.dumps(dict(articles=len(articles), bodies_verified=True, source='frozen_preprocessed_edition')))
