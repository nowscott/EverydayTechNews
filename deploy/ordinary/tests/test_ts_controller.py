"""TS 控制器与 Python 控制器的行为对照（status / ledger）。"""
import json
import os
import pathlib
import shutil
import sqlite3
import subprocess
import tempfile
import unittest

REPO = pathlib.Path(__file__).resolve().parents[3]
NODE = shutil.which('node')


def fixture(root):
    root.mkdir(parents=True)
    data = root.parent / 'data'
    data.mkdir(exist_ok=True)
    (root / 'config.json').write_text(json.dumps({"component": "ordinary-news", "data": str(data),
        "env_file": str(root.parent / 'ordinary.env'), "scheduler_lock": str(root.parent / 'scheduler.lock'),
        "state_lock": "runtime.lock", "manifest": "deploy/ordinary/release.json"}))
    (root / 'deployment.json').write_text(json.dumps({"active": None, "history": [], "blocked": {}, "high_water": [0, 0, 0]}))
    (root / 'status.json').write_text(json.dumps({"at": "2026-11-22T12:00:00+08:00", "status": "up_to_date"}))
    return data


@unittest.skipUnless(NODE, 'node 未安装')
class ControllerParity(unittest.TestCase):
    def setUp(self):
        self.temp = pathlib.Path(tempfile.mkdtemp(prefix='etn-ts-parity-'))
        self.root = self.temp / 'managed'
        self.data = fixture(self.root)

    def tearDown(self):
        shutil.rmtree(self.temp, ignore_errors=True)

    def status(self, command):
        result = subprocess.run(command + ['status'], capture_output=True, text=True, check=True)
        return json.loads(result.stdout)

    def test_status_matches_python(self):
        python = self.status(['python3', str(REPO / 'deploy/ordinary/manage.py'), '--root', str(self.root)])
        ts = self.status([NODE, '--disable-warning=ExperimentalWarning', str(REPO / 'deploy/ordinary/manage.ts'), '--root', str(self.root)])
        self.assertEqual(python, ts)

    def test_ledger_matches_python(self):
        db = sqlite3.connect(self.data / 'state.sqlite3')
        db.executescript("""
            CREATE TABLE issues (id INTEGER PRIMARY KEY, url TEXT, title TEXT, score REAL, delivered INTEGER);
            CREATE TABLE deliveries (id INTEGER PRIMARY KEY, issue_id INTEGER, to_addr TEXT, note TEXT);
        """)
        db.execute("INSERT INTO issues VALUES (1, 'https://example.com/a', '中文标题 \"引号\"', 7.5, 1)")
        db.execute("INSERT INTO deliveries VALUES (1, 1, 'a@example.com', NULL)")
        db.commit(); db.close()
        ts = subprocess.run([NODE, '--disable-warning=ExperimentalWarning', str(REPO / 'deploy/ordinary/manage.ts'),
                             '--root', str(self.root), 'ledger'], capture_output=True, text=True, check=True).stdout.strip()
        from importlib.util import module_from_spec, spec_from_file_location
        spec = spec_from_file_location('ordinary_controller', REPO / 'deploy/ordinary/manage.py')
        module = module_from_spec(spec); spec.loader.exec_module(module)
        controller = module.Controller(str(self.root))
        self.assertEqual(controller.ledger(), ts)


if __name__ == '__main__':
    unittest.main()
