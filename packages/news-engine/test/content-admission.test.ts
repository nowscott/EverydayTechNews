import test from 'node:test';
import assert from 'node:assert/strict';
import { contentAdmission } from '../src/content-admission.ts';
import { select } from '../src/editor.ts';
import { article, cutoff } from './fixtures.ts';

const long = '公司计划在中国测试这一人工智能模型，尚未独立验证。'.repeat(20);

test('正文准入按实际正文判定，不只信 content_status', () => {
  assert.equal(contentAdmission({ ...article(), content_status: 'usable_excerpt', text: '' }), 'insufficient_content');
  assert.equal(contentAdmission({ ...article(), content_status: 'usable_excerpt', text: '短正文' }), 'insufficient_content');
  assert.equal(contentAdmission({ ...article(), content_status: 'usable_excerpt', text: long + '…' }), 'insufficient_content');
  assert.equal(contentAdmission({ ...article(), content_status: 'discovery_only', text: long }), 'insufficient_content');
  assert.equal(contentAdmission({ ...article(), source: 'electrek_tesla', content_origin: 'rss_description', text: long }), 'media_article_body_unverified');
  assert.equal(contentAdmission({ ...article(), evidence_expired_or_missing: true, text: long }), 'evidence_expired_or_missing');
  assert.equal(contentAdmission({ ...article(), text: long }), null);
});

test('选稿阶段就排除空正文，不让它占位', () => {
  const bad = { ...article(), id: 'bad', title: 'AI 大模型正式发布', text: '', content_status: 'usable_excerpt', fetched_at: cutoff };
  const good = { ...article(), id: 'good', title: 'NVIDIA 芯片更新', text: long, content_status: 'usable_excerpt', fetched_at: cutoff };
  const [chosen, rejected] = select([bad, good], cutoff, false, 32);
  assert.equal(chosen.length, 1); assert.equal(chosen[0].id, 'good');
  assert.ok(rejected.some((r: any) => r.id === 'bad' && r.reason === 'insufficient_content'));
});
