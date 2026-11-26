#!/usr/bin/env node
/** 三端发版体检：版本一致、容器在跑、调度心跳新鲜、最近一轮成功、看板健康。任一不符退出 1。 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

type Row = { name: string; detail: string; ok: boolean };

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(name);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (!value && !fallback) throw new Error(`missing_${name.replace(/^--/, '').replace(/-/g, '_')}`);
  return value || (fallback as string);
}

function readJson(file: string): Record<string, any> {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function dockerPs(project: string): Array<{ name: string; status: string }> {
  try {
    const out = execFileSync('docker', ['ps', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.Names}}|{{.Status}}'], { encoding: 'utf8', timeout: 15000 }).trim();
    if (!out) return [];
    return out.split('\n').map((line) => { const [name, status] = line.split('|'); return { name, status }; });
  } catch { return []; }
}

function versionOf(tag?: string): string | null {
  const m = String(tag || '').match(/v?(\d+\.\d+\.\d+)$/);
  return m ? m[1] : null;
}

async function main(): Promise<number> {
  const ordinaryRoot = arg('--ordinary-root');
  const premiumRoot = arg('--premium-root');
  const dashboardRoot = arg('--dashboard-root');
  const expected = arg('--version', '');
  const maxHeartbeatMs = Number(arg('--heartbeat-max-ms', '360000'));
  const tickGraceMs = Number(arg('--tick-grace-ms', '600000'));
  const rows: Row[] = [];
  const errors: string[] = [];
  const check = (name: string, ok: boolean, detail: string) => { rows.push({ name, detail, ok }); if (!ok) errors.push(name); };

  // 普通版的部署记录在 <root>/managed 下；直接传根目录时自动下探一层，避免只报 missing。
  const ordinaryDeployment = path.join(ordinaryRoot, 'deployment.json');
  const ordinaryBase = fs.existsSync(ordinaryDeployment) ? ordinaryRoot : path.join(ordinaryRoot, 'managed');
  const ordinary = readJson(path.join(ordinaryBase, 'deployment.json'));
  const premium = readJson(path.join(premiumRoot, 'deployment.json'));
  const dashboard = readJson(path.join(dashboardRoot, 'installation.json'));
  const tags = [ordinary.active?.tag, premium.active?.tag, dashboard.tag];
  const versions = tags.map(versionOf);

  check('three_versions', versions.every(Boolean) && new Set(versions).size === 1, tags.map((t, i) => `${['ordinary', 'premium', 'dashboard'][i]}=${t || 'missing'}`).join(' '));
  const version = versions[0];
  if (expected) check('expected_version', versions.every((v) => v === expected), `expected=${expected} actual=${versions.join('/')}`);
  const prefixes = [['ordinary-news-', ordinary.active?.tag], ['news-engine-', premium.active?.tag], ['nas-dashboard-', dashboard.tag]] as const;
  check('release_prefix', prefixes.every(([prefix, tag]) => String(tag || '').startsWith(prefix)), prefixes.map(([prefix, tag]) => `${prefix}*=${tag || 'missing'}`).join(' '));

  for (const [label, project] of [['ordinary', 'etn-ordinary'], ['premium', 'etn-premium'], ['dashboard', dashboard.compose_project || 'etn-dashboard']] as const) {
    const containers = dockerPs(project);
    const down = containers.filter((c) => !/^Up /.test(c.status));
    check(`container_${label}`, containers.length > 0 && down.length === 0, containers.length ? containers.map((c) => `${c.name}:${c.status}`).join('; ') : `project ${project} 无运行容器`);
  }

  for (const [label, data] of [['ordinary', ordinary], ['premium', premium]] as const) {
    const root = label === 'ordinary' ? ordinaryBase : premiumRoot;
    const config = readJson(path.join(root, 'config.json'));
    const dataDir = data.dataDir || config.data || path.join(root, 'data');
    const statusPath = path.join(dataDir, 'scheduler/status.json');
    const status = readJson(statusPath).scheduler || {};
    const heartbeat = Date.parse(status.heartbeat_at || '');
    const age = Number.isFinite(heartbeat) ? Date.now() - heartbeat : Infinity;
    check(`heartbeat_${label}`, age < maxHeartbeatMs, `version=${status.version || 'missing'} age_ms=${Number.isFinite(age) ? age : 'missing'}`);
    check(`version_${label}`, !version || status.version === version, `scheduler=${status.version || 'missing'} expected=${version || 'unknown'}`);
    const last = status.last_tick || {};
    const started = Date.parse(status.started_at || '');
    const fresh = Number.isFinite(started) && Date.now() - started < tickGraceMs;
    const okLast = last.status === 'completed' && (!last.exit_code || last.exit_code === 0);
    check(`last_tick_${label}`, okLast || (!last.at && fresh), last.at ? `${last.status} at=${last.at} exit=${last.exit_code ?? '-'} seconds=${last.seconds ?? '-'}` : `no_tick_yet started_age_ms=${Number.isFinite(started) ? Date.now() - started : 'missing'}`);
  }

  const url = String(dashboard.url || '').replace(/\/$/, '');
  if (!url) check('dashboard_health', false, 'installation.url missing');
  else {
    try {
      const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(10000) });
      const body = await res.json() as Record<string, any>;
      check('dashboard_health', res.ok && body.status === 'ok' && (!version || body.version === version), `${res.status} ${JSON.stringify(body)}`);
    } catch (error) {
      check('dashboard_health', false, String((error as Error).message || error));
    }
  }

  const width = Math.max(...rows.map((r) => r.name.length));
  console.log(`ETN verify version=${version || expected || 'unknown'}`);
  for (const row of rows) console.log(`${row.ok ? 'OK  ' : 'FAIL'} ${row.name.padEnd(width)}  ${row.detail}`);
  console.log(errors.length ? `RESULT FAIL ${errors.join(',')}` : 'RESULT PASS');
  return errors.length ? 1 : 0;
}

main().then((code) => { process.exitCode = code; }).catch((error) => { console.error(String((error as Error).message || error)); process.exitCode = 1; });
