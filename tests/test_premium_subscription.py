import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch, Mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from notion_client import fetch_notion_users

class PremiumRoutingTests(unittest.TestCase):
    def test_ordinary_exclusion_requires_production_switch(self):
        for enabled, expected in [('false', 2), ('true', 1)]:
            row = lambda email, checked: {'properties': {'Name': {'title': []}, 'Email': {'email': email}, '状态': {'select': {'name': '正常'}}, '高级订阅': {'checkbox': checked}}}
            get = Mock(status_code=200); get.json.return_value = {'data_sources': [{'id': 'data'}]}
            post = Mock(status_code=200); post.json.return_value = {'results': [row('a@example.org', True), row('b@example.org', False)], 'has_more': False}
            with patch.dict(os.environ, {'PREMIUM_PRODUCTION_ENABLED': enabled}), patch('notion_client.requests.get', return_value=get), patch('notion_client.requests.post', return_value=post):
                self.assertEqual(len(fetch_notion_users('test', 'data')), expected)
