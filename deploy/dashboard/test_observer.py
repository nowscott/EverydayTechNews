import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

script = Path(__file__).with_name('record-run.py')
spec = importlib.util.spec_from_file_location('observer', script)
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class ObserverTest(unittest.TestCase):
    def test_records_success_and_failure_without_touching_business_state(self):
        with tempfile.TemporaryDirectory() as temp:
            for code in [0, 7]:
                result = subprocess.run([sys.executable, str(script), '--root', temp, '--component', 'ordinary', '--', sys.executable, '-c', f'raise SystemExit({code})'])
                self.assertEqual(result.returncode, code)
                value = json.loads((Path(temp)/'runtime/ordinary/latest.json').read_text())
                self.assertEqual(value['exit_code'], code)
                self.assertEqual(value['state'], 'completed')
                self.assertTrue(value['finished_at'])
            self.assertEqual(len(list((Path(temp)/'runtime/ordinary').glob('202*.json'))), 2)

    def test_start_failure_is_recorded(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(FileNotFoundError):
                observer.record(temp, 'premium', ['/does-not-exist'])
            value=json.loads((Path(temp)/'runtime/premium/latest.json').read_text())
            self.assertEqual(value['exit_code'],127)


if __name__=='__main__':
    unittest.main()
