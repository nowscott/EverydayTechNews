import nodemailer from 'nodemailer';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { Store, files } from './store.ts';
import { atomic, read, digest, RECIPIENT, EXPIRY, trial, stamp, type Row } from './core.ts';
import { validate, codepoints } from './model.ts';
export const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[c]!);
const write = (p: string, value: string) => writeFileSync(p, value, { mode: 0o600 });
export function buildEmail(issue: Row, records: Row[]): [string, string] {
  const shown = records.filter(r => r.result).slice(0, 20); const date = issue.collection_cutoff.slice(0, 10).replaceAll('-', '.');
  const sources = new Set(shown.map(r => r.article.source)).size;
  const minutes = Math.max(1, Math.round(shown.reduce((n, r) => n + codepoints(r.result.summary), 0) / 350));
  const notice = '测试邮件，仅供指定邮箱审阅。未经逐条人工事实审阅。';
  const plain = [`【测试】每日科技早报｜${date}`, notice, `${shown.length} 条模型初稿 · 尚待人工核对`, `采集截止：${issue.collection_cutoff} 上海时间`, `本期 ${shown.length} 条 / ${sources} 个来源 / 约 ${minutes} 分钟`, '今日速览'];
  const toc = shown.map((r, i) => { plain.push(`${String(i + 1).padStart(2, '0')}. ${r.result.title}`); return `<tr><td style="width:28px;color:#829177;font-size:12px;vertical-align:top;padding:7px 0">${String(i + 1).padStart(2, '0')}</td><td style="padding:6px 0;font-size:14px;line-height:1.65"><a href="${escape(r.article.url)}" style="color:#20251f;text-decoration:none">${escape(r.result.title)}</a></td></tr>`; }).join('');
  const blocks = shown.map((r, i) => {
    const a = r.article; const g = r.result; validate(g, a);
    const label = i < 5 ? '今日重点' : '精编短讯'; const summary = i < 5 ? g.summary : g.short_summary;
    if (!summary) throw new Error('short_summary_required');
    const group = i === 0 || i === 5 ? `<tr><td class="pad" style="padding:32px 36px 12px"><span style="background:#d7f783;padding:5px 12px;font-size:13px;font-weight:800">${i < 5 ? '✦' : '＋'} ${label}</span></td></tr>` : '';
    const points = i < 5 ? g.points.map((p: string) => `<p style="font-size:14px;color:#4d574c;line-height:1.8">• ${escape(p)}</p>`).join('') : '';
    const why = i < 5 && g.why ? `<p style="padding:12px 14px;border-left:3px solid #a6ca58;background:#f6f9ee;font-size:14px;line-height:1.8"><strong>为什么值得关注</strong><br>${escape(g.why)}</p>` : '';
    const pending = `AI 初稿，待人工核对${a.update_review_required ? ' · 更新待审' : ''}`;
    plain.push('', `${i + 1} / ${label}`, g.title, summary, ...(i < 5 ? g.points : []), i < 5 ? g.why : '', `${a.source_name} / ${a.published_at} 上海时间`, a.url, pending);
    return group + `<tr><td class="pad" style="padding:18px 36px 25px"><p style="font-size:11px;color:#73816b;font-weight:700">${String(i + 1).padStart(2, '0')} / ${label}</p><h2 style="font-size:22px;line-height:1.5;margin:0 0 14px"><a href="${escape(a.url)}" style="color:#111b12;text-decoration:none">${escape(g.title)}</a></h2><p style="font-size:16px;line-height:1.95;color:#353f35;overflow-wrap:anywhere">${escape(summary)}</p>${points}${why}<p style="font-size:11px;color:#768071;line-height:1.8">${escape(a.source_name)} · ${escape(a.published_at.slice(5, 16).replace('T', ' '))}（上海时间）<br><span style="color:#8a6542">${pending}</span>　<a href="${escape(a.url)}" style="color:#526b32">阅读原文 ↗</a></p><div style="margin-top:25px;border-bottom:1px solid #e8eae3"></div></td></tr>`;
  }).join('');
  const health = issue.source_health?.sources ?? [];
  const coverage = health.length ? `采集状态：${health.filter((s: Row) => s.ok).length}/${health.length} 路可用；${health.reduce((n: number, s: Row) => n + (s.discovery_only ?? 0), 0)} 条仅供发现线索，不据此补写正文。` : '采集范围有限，来源健康详情见内部审阅记录。';
  plain.push('', coverage, '来源范围有限，企业自述未经独立核实。模型处理及后续分发用途条件仍需核实。', '当前仅允许发送到已指定的测试邮箱；请勿转发为正式简报。');
  const doc = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>【测试】每日科技早报</title><style>@media only screen and (max-width:520px){.outer{padding:0!important}.pad{padding-left:23px!important;padding-right:23px!important}.hero{font-size:34px!important}.card{border:0!important}}</style></head><body style="margin:0;background:#edf0e9;font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;color:#172016;-webkit-text-size-adjust:100%"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td class="outer" align="center" style="padding:28px 12px"><table role="presentation" class="card" width="680" cellspacing="0" cellpadding="0" style="width:100%;max-width:680px;background:#fff;border:1px solid #e1e6dc;border-collapse:collapse"><tr><td class="pad" style="padding:25px 36px 0;border-top:7px solid #182719"><table role="presentation" width="100%"><tr><td style="font-size:11px;font-weight:800;letter-spacing:2px">EVERYDAY TECH NEWS</td><td align="right" style="font-size:11px;color:#65715d">${date}</td></tr></table></td></tr><tr><td class="pad" style="padding:34px 36px 26px"><p><span style="background:#d7f783;padding:6px 10px;font-size:11px;font-weight:800">MORNING BRIEF / 测试刊</span></p><h1 class="hero" style="margin:0;font-size:42px;line-height:1.25;letter-spacing:-1.5px">早上好，<br>科技世界有新消息。</h1><p style="color:#66715e;font-size:13px;line-height:1.8">${shown.length} 条科技动态 / ${sources} 个来源 / 约 ${minutes} 分钟</p></td></tr><tr><td class="pad" style="padding:0 36px 26px"><table role="presentation" width="100%" style="background:#f6f7f1;border-left:3px solid #b8d66b"><tr><td style="padding:12px 15px;font-size:12px;line-height:1.8;color:#637054"><strong>【测试】${issue.mode === 'current_24h_sample' ? '最近24小时 · TS新选题测试加刊' : '最近24小时早报'}</strong><br>${notice}<br>${shown.length} 条模型初稿 · 尚待人工核对<br>采集截止：${escape(issue.collection_cutoff)}（上海时间）</td></tr></table></td></tr><tr><td class="pad" style="padding:0 36px 22px"><div style="border-top:2px solid #1a2718;padding-top:18px"><h2 style="font-size:15px">今日速览 / AT A GLANCE</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${toc}</table></div></td></tr>${blocks}<tr><td class="pad" style="padding:8px 36px 32px;font-size:12px;line-height:1.9;color:#7b8374">${escape(coverage)}<br>来源范围有限，企业自述未经独立核实。<br>模型处理与后续分发用途条件仍需核实。</td></tr><tr><td class="pad" style="padding:24px 36px;background:#172719;color:#dce4d4;font-size:11px;line-height:1.9"><strong>EVERYDAY TECH NEWS · 内部试刊</strong><br>测试邮件，仅供指定邮箱审阅。请勿作为正式简报转发。<br>版式版本 morning-3-pool-ts · 未达到可收费标准</td></tr></table></td></tr></table></body></html>`;
  return [doc, plain.filter(Boolean).join('\n\n')];
}
export function freezeIssue(store: Store, issue: Row, records: Row[]) {
  const root = store.root; const out = root + '/issues/' + issue.id;
  if (store.one('SELECT id FROM issues WHERE id=?', issue.id) || (() => { try { read(out + '/edition.json'); return true; } catch { return false; } })()) throw new Error('edition_already_frozen');
  mkdirSync(out, { recursive: true }); const review = root + '/transient/reviews/' + issue.id; mkdirSync(review, { recursive: true });
  let [doc, plain] = buildEmail(issue, records);
  if (issue.kind === 'diagnostic') {
    write(review + '/draft-email.html', doc); write(review + '/draft-email.txt', plain);
    const counts: Row = {}; for (const r of issue.rejected) counts[r.reason] = (counts[r.reason] ?? 0) + 1;
    plain = `【测试】TS早报异常诊断\n未经逐条人工事实审阅。\n本期仅 ${records.length} 条通过程序校验，未达到15条，不发送正常早报。\n采集截止：${issue.collection_cutoff}\n生成截止：${issue.generation_cutoff}\n${JSON.stringify(counts, null, 2)}\n来源健康：\n${JSON.stringify(issue.source_health, null, 2)}`;
    doc = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>【测试】早报异常诊断</title><body style="font:16px/1.8 system-ui;max-width:680px;margin:24px auto;padding:20px"><h1>【测试】早报异常诊断</h1><pre style="white-space:pre-wrap;overflow-wrap:anywhere">' + escape(plain) + '</pre></body></html>';
  }
  write(out + '/email.html', doc); write(out + '/email.txt', plain); issue.html_sha256 = digest(doc); issue.text_sha256 = digest(plain);
  atomic(review + '/comparison-full.json', { issue, records });
  write(review + '/review.html', '<!doctype html><meta charset="utf-8"><h1>未经逐条人工事实审阅</h1>' + records.map(r => '<h2>' + escape(r.article.title) + '</h2><pre style="white-space:pre-wrap">' + escape(r.article.text) + '</pre><pre style="white-space:pre-wrap">' + escape(JSON.stringify(r.result, null, 2)) + '</pre>').join(''));
  const csv = [['文章ID', '中文标题', '原文链接', '关键事实错误', '无依据陈述', '遗漏', '修改需求', '人工审阅', '调用次数', '估算费用元'], ...records.map(r => [r.article.id, r.result.title, r.article.url, '待审', '待审', '待审', '待审', '未开始', r.calls.length, r.calls.reduce((n: number, c: Row) => n + (c.cost ?? 0), 0)])];
  write(out + '/review.csv', '\ufeff' + csv.map(row => row.map(cell => '"' + (/^[=+@-]/.test(String(cell)) ? "'" : '') + String(cell).replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n');
  atomic(out + '/comparison.json', store.shrink({ issue, records, sendable_count: 0, cost_is_estimate: true }));
  atomic(out + '/ranking.json', { version: 'editorial-4.3', selected: issue.articles.map((a: Row) => ({ id: a.id, ranking: a.ranking })), rejected: issue.rejected });
  const frozen = store.shrink(issue); atomic(out + '/edition.json', frozen);
  store.run('INSERT INTO issues VALUES (?,?)', issue.id, JSON.stringify(issue)); store.checkpoint(); return frozen;
}

export async function sendOnce(store: Store, issueId: string, deps: { transport?: any; now?: () => Date } = {}): Promise<Row> {
  if (!/^[A-Za-z0-9_-]+$/.test(issueId)) throw new Error('invalid_issue');
  const config = trial(store.root); const now = deps.now?.() ?? new Date();
  if (!config.enabled || !config.delivery_enabled || now.getTime() >= Date.parse(EXPIRY)) return { status: 'trial_or_delivery_disabled_or_expired' };
  if (read(store.root + '/test-delivery-config.json').allowed_recipient !== RECIPIENT) throw new Error('recipient_not_explicitly_authorized');
  if (!store.syncGit && !deps.transport) throw new Error('smtp_requires_authoritative_checkpoint');
  const folder = store.root + '/issues/' + issueId; const edition = read(folder + '/edition.json');
  const html = readFileSync(folder + '/email.html', 'utf8'); const text = readFileSync(folder + '/email.txt', 'utf8');
  if (digest(html) !== edition.html_sha256 || digest(text) !== edition.text_sha256) throw new Error('frozen_content_changed_do_not_send');
  if (!html.includes('【测试】') || !text.includes('【测试】')) throw new Error('missing_test_label');
  if (/(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}/.test(html + '\n' + text)) throw new Error('credential_like_text_blocked');
  for (const path of files(store.root + '/deliveries')) {
    const old = read(path); if (old.issue === issueId && old.recipient === RECIPIENT) return { ...old, reused: true };
  }
  const sender = process.env.SENDING_ACCOUNT; const password = process.env.SENDING_PASSWORD; const server = process.env.SERVER;
  if (!sender || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(sender) || !password || !server) return { status: 'missing_test_smtp_configuration' };
  const fingerprint = digest(RECIPIENT + '\0' + issueId + '\0' + html + '\0' + text);
  const subject = edition.kind === 'diagnostic' ? `【测试】TS早报异常诊断｜${edition.collection_cutoff.slice(0, 10)}` : `【测试·TS${edition.mode === 'current_24h_sample' ? '新版选题' : '早报'}】科技早报｜${edition.collection_cutoff.slice(0, 10)}｜${edition.articles.length}条精选`;
  const receipt: Row = { issue: issueId, recipient: RECIPIENT, subject, message_id: `<premium-test-${fingerprint.slice(0, 32)}@${sender.split('@')[1]}>`, status: 'sending', started_at: stamp(now), model_content_generated: edition.articles.length > 0, engine: 'typescript' };
  const path = store.root + '/deliveries/' + fingerprint + '.json'; const save = () => { atomic(path, receipt); store.checkpoint(); };
  save(); // Claim is remotely durable before creating an SMTP connection.
  const transport = deps.transport ?? nodemailer.createTransport({ host: server, port: 465, secure: true, auth: { user: sender, pass: password }, pool: false,
    connectionTimeout: 30000, greetingTimeout: 30000, socketTimeout: 30000, logger: false, debug: false });
  try {
    const result = await transport.sendMail({ from: { name: '每日科技早报 · 测试', address: sender }, to: RECIPIENT, envelope: { from: sender, to: [RECIPIENT] }, subject, messageId: receipt.message_id, text, html });
    receipt.status = result.accepted?.includes(RECIPIENT) ? 'smtp_accepted' : 'recipient_refused'; receipt.accepted_at = stamp(); save();
  } catch (error) {
    if (receipt.status === 'smtp_accepted') throw error; // Failed acceptance persistence must fail the task, never mask it.
    receipt.status = ['CONN', 'AUTH', 'EHLO', 'HELO', 'STARTTLS'].includes((error as any).command) ? 'failed_before_send' : 'unknown_do_not_retry'; save();
  } finally { try { transport.close(); } catch { /* QUIT failures cannot invalidate saved acceptance or cause another send. */ } }
  return receipt;
}
