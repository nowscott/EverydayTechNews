"""迁移窗口保护：update.inprogress 存在时看门狗不得重建调度容器。

背景：2.7.10 迁移时旧项目容器已 down、新版本尚未激活，10 分钟一次的
scheduler-up 看门狗按旧 active 重建了旧调度容器，与新调度同时 tick（重复出刊）。
"""
import json
import pathlib
import shutil
import subprocess
import tempfile
import unittest

REPO = pathlib.Path(__file__).resolve().parents[3]
NODE = shutil.which('node')


@unittest.skipUnless(NODE, 'node 未安装')
class UpdateMarker(unittest.TestCase):
    def setUp(self):
        self.temp = pathlib.Path(tempfile.mkdtemp(prefix='etn-update-marker-'))
        self.root = self.temp / 'managed'
        self.root.mkdir(parents=True)
        self.data = self.temp / 'data'
        self.data.mkdir()
        (self.root / 'config.json').write_text(json.dumps({"component": "ordinary-news", "data": str(self.data),
            "env_file": str(self.temp / 'ordinary.env'), "scheduler_lock": str(self.temp / 'scheduler.lock'),
            "state_lock": "runtime.lock", "manifest": "deploy/ordinary/release.json"}))

    def tearDown(self):
        shutil.rmtree(self.temp, ignore_errors=True)

    def controller(self, operation):
        result = subprocess.run([NODE, '--disable-warning=ExperimentalWarning', str(REPO / 'deploy/ordinary/manage.ts'),
                                 '--root', str(self.root), operation], capture_output=True, text=True)
        return result, (json.loads(result.stdout) if result.stdout.strip() else None)

    def test_marker_blocks_scheduler_up(self):
        (self.root / 'deployment.json').write_text(json.dumps({"active": {"tag": "ordinary-news-v2.7.9"}, "history": [],
            "blocked": {}, "high_water": [0, 0, 0]}))
        (self.root / 'update.inprogress').write_text(json.dumps({"at": "2026-11-22T16:10:00+08:00", "pid": 1}))
        result, payload = self.controller('scheduler-up')
        self.assertEqual(payload, {"status": "update_in_progress"})
        self.assertEqual(result.returncode, 0)

    def test_no_marker_requires_active_release(self):
        # 没有标记时走正常路径，缺 active 直接报错而不是静默通过。
        (self.root / 'deployment.json').write_text(json.dumps({"active": None, "history": [], "blocked": {}, "high_water": [0, 0, 0]}))
        result, _ = self.controller('scheduler-up')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('no_active_ordinary_release', result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
