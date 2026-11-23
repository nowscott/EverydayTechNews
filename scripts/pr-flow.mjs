#!/usr/bin/env node
// PR 自动化：建 PR → 等 checks → squash 合并。
// 用法：GITHUB_TOKEN=... node scripts/pr-flow.mjs --branch chore/foo [--title "..."] [--body "..."] [--no-merge] [--timeout 900]
// 约定：分支必须已 push；脚本不负责 commit/push。
const API = 'https://api.github.com';
const env = process.env;
const token = env.ETN_PR_TOKEN || env.GITHUB_TOKEN;
if (!token) fail('missing_token');
const repo = env.ETN_REPO || 'nowscott/EverydayTechNews';
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const flag = (name) => args.includes(name);
const branch = opt('--branch');
const base = opt('--base', 'main');
if (!branch) fail('missing_branch');
const title = opt('--title', branch);
const body = opt('--body', '');
const timeout = Number(opt('--timeout', '900')) * 1000;

async function gh(path, init = {}) {
  const res = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) fail('github_http_' + res.status, data);
  return data;
}
function fail(code, detail) { console.log(JSON.stringify({ status: 'error', code, detail })); process.exit(1); }
function out(obj) { console.log(JSON.stringify(obj)); }

out({ status: 'start', repo, branch, base });
const prs = await gh(`/repos/${repo}/pulls?state=open&head=${encodeURIComponent(env.GITHUB_ACTOR || 'nowscott')}:${encodeURIComponent(branch)}`);
let pr = prs[0];
if (!pr) {
  pr = await gh(`/repos/${repo}/pulls`, { method: 'POST', body: JSON.stringify({ title, head: branch, base, body }) });
  out({ status: 'pr_created', number: pr.number, url: pr.html_url });
} else out({ status: 'pr_exists', number: pr.number, url: pr.html_url });

if (flag('--no-merge')) { out({ status: 'done_no_merge', number: pr.number, url: pr.html_url }); process.exit(0); }

const deadline = Date.now() + timeout;
let head = (await gh(`/repos/${repo}/branches/${encodeURIComponent(branch)}`)).commit.sha, checks = null;
while (Date.now() < deadline) {
  const runs = await gh(`/repos/${repo}/commits/${head}/check-runs?per_page=100`);
  checks = runs.check_runs || [];
  if (!checks.length) {
    out({ status: 'waiting_for_checks', head });
    if (deadline - Date.now() > 60000) { await new Promise(r => setTimeout(r, 20000)); continue; }
    out({ status: 'no_checks', head }); break;
  }
  const bad = checks.filter(c => c.status === 'completed' && c.conclusion !== 'success' && c.conclusion !== 'neutral' && c.conclusion !== 'skipped');
  const pending = checks.filter(c => c.status !== 'completed');
  out({ status: 'checks', head, total: checks.length, pending: pending.length, failed: bad.length, names: checks.map(c => `${c.name}:${c.status}/${c.conclusion}`) });
  if (bad.length) fail('checks_failed', bad.map(c => ({ name: c.name, conclusion: c.conclusion, url: c.html_url })));
  if (!pending.length) break;
  await new Promise(r => setTimeout(r, 20000));
}
if (Date.now() >= deadline) fail('checks_timeout', { head });

let merged;
for (let attempt = 0; attempt < 4; attempt++) {
  try {
    merged = await gh(`/repos/${repo}/pulls/${pr.number}/merge`, { method: 'PUT', body: JSON.stringify({ merge_method: 'squash', sha: head }) });
    break;
  } catch (error) {
    if (attempt === 3) throw error;
    out({ status: 'merge_retry', attempt: attempt + 1 });
    await new Promise(r => setTimeout(r, 15000));
  }
}
out({ status: 'merged', number: pr.number, sha: merged.sha, message: merged.message });
