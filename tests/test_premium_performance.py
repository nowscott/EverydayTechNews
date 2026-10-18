"""Collector concurrency keeps one database writer and isolates source failures."""
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'experiments/premium'))
import brief as b


class CollectionConcurrencyTests(unittest.TestCase):
    def test_parallel_matches_serial_with_bounded_workers_and_failed_source(self):
        sources={k:b.SOURCES[k] for k in ('ithome','nvidia','github','cloudflare','microsoft_foundry','macrumors')}
        lock=threading.Lock();active=peak=0

        def get(url, **kwargs):
            nonlocal active,peak
            with lock:active+=1;peak=max(peak,active)
            try:
                time.sleep(.01)
                source=next(k for k,v in sources.items() if v[1]==url)
                if source=='github':raise requests.Timeout()
                body='公司计划测试产品，尚未正式发布。'*30
                xml=f'''<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item>
                <title>产品更新</title><link>https://{sources[source][2]}/test</link>
                <pubDate>Sun, 18 Oct 2026 04:00:00 +0800</pubDate>
                <description>{body}</description><content:encoded>{body}</content:encoded>
                </item></channel></rss>'''.encode()
                return Mock(content=xml,status_code=200,url=url)
            finally:
                with lock:active-=1

        outputs=[]
        with tempfile.TemporaryDirectory() as temp, patch.object(b,'SOURCES',sources), patch.object(b.requests,'get',side_effect=get), patch.object(b.requests,'post') as paid, patch.object(b,'stamp',return_value='2026-10-18T05:00:00+08:00'):
            for workers in (1,4):
                root=Path(temp)/str(workers);db=b.connect(root)
                try:
                    health=b.collect(db,root,max_workers=workers)
                    records=[json.loads(r[0]) for r in db.execute('SELECT data FROM articles ORDER BY id')]
                    for r in records:r.pop('feed_snapshot')
                    outputs.append(records)
                    self.assertEqual([x['source'] for x in health],list(sources))
                    self.assertEqual([x['source'] for x in health if not x['ok']],['github'])
                    self.assertEqual(db.execute('SELECT count(*) FROM observations').fetchone()[0],5)
                    self.assertEqual(db.execute('SELECT count(*) FROM calls').fetchone()[0],0)
                    self.assertEqual(json.loads((root/'source-health.json').read_text())['performance']['collection_workers'],workers)
                finally:db.close()
            paid.assert_not_called()
        self.assertEqual(outputs[0],outputs[1]);self.assertGreater(peak,1);self.assertLessEqual(peak,4)

    def test_invalid_concurrency_and_storage_failure_do_not_pass_as_healthy(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);db=b.connect(root)
            try:
                for workers in (0,5,True,'4'):
                    with self.assertRaises(ValueError):b.collect(db,root,max_workers=workers)
                with patch.object(b,'fetch_source',side_effect=OSError('disk full')),patch.object(b.requests,'post') as paid:
                    with self.assertRaises(OSError):b.collect(db,root)
                    paid.assert_not_called()
                self.assertFalse((root/'source-health.json').exists())
            finally:db.close()
