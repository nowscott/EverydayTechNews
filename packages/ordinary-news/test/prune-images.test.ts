import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, type Image } from '../../../deploy/nas/prune-images.ts';

const image = (repository: string, tag: string, id: string, created: string): Image => ({ repository, tag, id, created });

test('每个仓库只保留最近 N 个 image id', () => {
  const list = [
    image('everyday-tech-news-ordinary', 'ordinary-news-v2.7.11', 'c', '2026-11-22T16:27:00+08:00'),
    image('everyday-tech-news-ordinary', 'ordinary-news-v2.7.10', 'b', '2026-11-22T16:10:00+08:00'),
    image('everyday-tech-news-ordinary', 'ordinary-news-v2.7.9', 'a', '2026-11-22T15:22:00+08:00'),
  ];
  const removals = plan(list, 2, []);
  assert.deepEqual(removals.map((v) => v.tag), ['ordinary-news-v2.7.9']);
});

test('被引用的镜像即使超出保留名额也不删', () => {
  const list = [
    image('everyday-tech-news-ordinary', 'ordinary-news-v2.7.11', 'c', '2026-11-22T16:27:00+08:00'),
    image('everyday-tech-news-ordinary', 'ordinary-news-v2.7.10', 'b', '2026-11-22T16:10:00+08:00'),
    image('everyday-tech-news-ordinary', 'git-15852a1', 'z', '2026-11-22T16:00:00+08:00'),
  ];
  const removals = plan(list, 1, ['z']);
  assert.deepEqual(removals.map((v) => v.tag), ['ordinary-news-v2.7.10']);
});

test('同一 image id 的多个 tag 共用一个保留名额', () => {
  const list = [
    image('everyday-tech-news-dashboard', 'nas-dashboard-v2.7.11', 'd', '2026-11-22T16:30:00+08:00'),
    image('everyday-tech-news-dashboard', 'latest', 'd', '2026-11-22T16:30:00+08:00'),
    image('everyday-tech-news-dashboard', 'nas-dashboard-v2.7.10', 'e', '2026-11-22T16:00:00+08:00'),
  ];
  assert.deepEqual(plan(list, 2, []), []);
});

test('非本项目镜像不动', () => {
  assert.deepEqual(plan([image('mihomo', 'local', 'x', '2026-11-01T00:00:00+08:00')], 0, []), []);
});

test('legacy 镜像不参与删除', () => {
  const list = [
    image('everyday-tech-news-test', 'legacy-20261019', 'l', '2026-10-19T00:00:00+08:00'),
    image('everyday-tech-news-test', 'legacy-v1', 'm', '2026-09-01T00:00:00+08:00'),
  ];
  assert.deepEqual(plan(list, 0, []), []);
});

test('高级版改名后的 etn-premium 仓库也纳入清理', () => {
  const list = [
    image('etn-premium', 'news-engine-v2.7.11', 'p1', '2026-11-22T16:30:00+08:00'),
    image('etn-premium', 'news-engine-v2.7.10', 'p2', '2026-11-22T16:00:00+08:00'),
    image('etn-premium', 'news-engine-v2.7.9', 'p3', '2026-11-22T15:00:00+08:00'),
  ];
  assert.deepEqual(plan(list, 2, []).map((v) => v.tag), ['news-engine-v2.7.9']);
});
