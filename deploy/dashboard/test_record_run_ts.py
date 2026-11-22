"""record-run 的 TS 实现与 Python 实现对照。"""
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO = pathlib.Path(__file__).resolve().parents[2]
NODE = shutil.which('node')
PY = pathlib.Path(__file__).with_name('record-run.py')
TS = pathlib.Path(__file__).with_name('record-run.ts')


@unittest.skipUnless(NODE, 'node 未安装')
class RecordRunParity(unittest.TestCase):
    def run_tool(self, tool, root, code):
        command = [sys.executable, '-c', 'raise SystemExit(%d)' % code]
        argv = [sys.executable, str(PY)] if tool == 'py' else [NODE, '--disable-warning=ExperimentalWarning', str(TS)]
        result = subprocess.run(argv + ['--root', root, '--component', 'ordinary', '--'] + command, capture_output=True, text=True)
        latest = json.loads((pathlib.Path(root) / 'runtime/ordinary/latest.json').read_text())
        return result.returncode, latest

    def test_exit_codes_and_state_match(self):
        for code in [0, 7]:
            roots = {}
            with tempfile.TemporaryDirectory() as temp:
                for tool in ['py', 'ts']:
                    root = pathlib.Path(temp) / tool
                    root.mkdir()
                    roots[tool] = self.run_tool(tool, str(root), code)
                py_code, py_latest = roots['py']
                ts_code, ts_latest = roots['ts']
                self.assertEqual(py_code, code)
                self.assertEqual(ts_code, code)
                for key in ['component', 'state', 'exit_code']:
                    self.assertEqual(py_latest[key], ts_latest[key], key)
                self.assertEqual(py_latest['finished_at'] is not None, ts_latest['finished_at'] is not None)
                self.assertRegex(ts_latest['run_id'], r'\+08:00-[0-9a-f]{8}$')

    def test_start_failure_records_127(self):
        with tempfile.TemporaryDirectory() as temp:
            result = subprocess.run([NODE, '--disable-warning=ExperimentalWarning', str(TS), '--root', temp,
                                     '--component', 'premium', '--', '/does-not-exist'], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            latest = json.loads((pathlib.Path(temp) / 'runtime/premium/latest.json').read_text())
            self.assertEqual(latest['exit_code'], 127)


if __name__ == '__main__':
    unittest.main()
