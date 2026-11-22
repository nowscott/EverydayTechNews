import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dashboardCompose = readFileSync(join(import.meta.dirname, '..', '..', '..', 'deploy/dashboard/compose.yaml'), 'utf8');
const ordinaryCompose = readFileSync(join(import.meta.dirname, '..', '..', '..', 'deploy/ordinary/compose.yaml'), 'utf8');
const installer = readFileSync(join(import.meta.dirname, '..', '..', '..', 'deploy/dashboard/install.ts'), 'utf8');

// 命名规范见 NAMING.md：项目短名、常驻服务固定 container_name、不出现叠词。
test('compose 项目名使用短名', () => {
  assert.equal(ordinaryCompose.split('\n')[0], 'name: etn-ordinary');
  assert.equal(dashboardCompose.split('\n')[0], 'name: etn-dashboard');
  for (const text of [ordinaryCompose, dashboardCompose]) {
    assert.ok(!text.includes('everyday-tech-news-ordinary\nservices'));
    assert.ok(!text.includes('everyday-tech-news-dashboard\nservices'));
  }
});

test('常驻服务固定 container_name 且不叠词', () => {
  assert.match(ordinaryCompose, /container_name: etn-ordinary-scheduler/);
  assert.match(dashboardCompose, /container_name: etn-dashboard-web/);
  assert.ok(!dashboardCompose.includes('etn-dashboard-collector'), '采集已并入 web，不再单独起容器');
  for (const text of [ordinaryCompose, dashboardCompose]) assert.ok(!/container_name: .*-[a-z]+-[a-z]+-[a-z]+-/.test(text));
});

test('一次性服务不设 container_name', () => {
  const ordinaryService = ordinaryCompose.split('  ordinary:\n')[1].split('  scheduler:\n')[0];
  assert.ok(!ordinaryService.includes('container_name'));
});

test('看板占用保护覆盖新旧项目名与固定容器名', () => {
  assert.match(installer, /'etn-dashboard'/, 'etn-dashboard');
  assert.match(installer, /'everyday-tech-news-dashboard'/, '旧项目名仍需拦截');
  assert.match(installer, /'etn-dashboard-web'/);
  assert.match(installer, /'etn-dashboard-collector'/);
  assert.match(installer, /dashboard_container_in_use/);
});
