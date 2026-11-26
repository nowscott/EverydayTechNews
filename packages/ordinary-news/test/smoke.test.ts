import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { smokeSend } from '../src/smoke.ts';

function root() {
  const dir = mkdtempSync(join(tmpdir(), 'etn-smoke-'));
  mkdirSync(join(dir, 'news_archive/2026-10'), { recursive: true });
  writeFileSync(join(dir, 'news_archive/2026-10/21.md'),
    '# 2026-10-21 (sorted)\n' + Array.from({ length: 12 }, (_, i) => `- [测试科技标题第${i}条](https://example.test/${i})`).join('\n'));
  return dir;
}

const configured = {
  ORDINARY_SMOKE_SEND: 'YES', SENDING_ACCOUNT: 'sender@example.test', SENDING_PASSWORD: 'secret',
  SERVER: 'smtp.example.test', APP_BASE_URL: 'https://example.test', SUBSCRIPTION_CONFIRMATION_SECRET: 'test-secret',
};

test('manual sample goes only to the owner, renders the latest archive and never touches the ledger', async () => {
  const dir = root();
  const sent: any[] = [];
  const result = await smokeSend(dir, configured, true, { sendMail: async (message: any) => { sent.push(message); }, close: async () => {} });
  assert.equal(result.status, 'sent');
  assert.equal(result.to, 'nowscott@qq.com');
  assert.equal(result.items, 12);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'nowscott@qq.com', '收件人写死为测试邮箱');
  assert.match(sent[0].subject, /手动测试/);
  assert.ok(sent[0].html.includes('测试科技标题第0条'));
  assert.ok(sent[0].html.includes('unsubscribe_token='), '退订链接仍然生成');
  assert.ok(!existsSync(join(dir, 'state.sqlite3')), '不创建账本');
  assert.ok(!existsSync(join(dir, 'issues')), '不冻结期刊');
});

test('manual sample refuses to send without explicit confirmation, and dry run sends nothing', async () => {
  const dir = root();
  await assert.rejects(() => smokeSend(dir, { ...configured, ORDINARY_SMOKE_SEND: 'no' }, true, { sendMail: async () => { throw new Error('must_not_send'); } }), /ordinary_smoke_confirmation_required/);
  const sent: any[] = [];
  const result = await smokeSend(dir, {}, false, { sendMail: async (message: any) => { sent.push(message); } });
  assert.equal(result.status, 'rendered');
  assert.equal(result.items, 12);
  assert.equal(sent.length, 0);
});

test('manual sample skips the empty 00.md and reports missing archives instead of sending an empty mail', async () => {
  const dir = root();
  writeFileSync(join(dir, 'news_archive/2026-10/00.md'), '# 2026-10-00\n');
  const result = await smokeSend(dir, configured, false);
  assert.equal(result.status, 'rendered');
  assert.ok(result.archive.endsWith('2026-10/21.md'));
  await assert.rejects(() => smokeSend(mkdtempSync(join(tmpdir(), 'etn-empty-')), {}, false), /archive_missing/);
});
