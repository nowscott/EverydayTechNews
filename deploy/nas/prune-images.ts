// 镜像治理：每个 everyday-tech-news-* 仓库只保留最近 N 个 tag + 任何被直接引用的镜像（digest 或运行中容器）。
// 默认只打印计划，`--apply` 才删除；删除只按 image id，避免误删别名 tag。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export interface Image { repository: string; tag: string; id: string; created: string; size?: string }

export const PREFIXES = ['everyday-tech-news-', 'etn-premium'];
export const PREFIX = PREFIXES[0];

export function plan(images: Image[], keep: number, protectedIds: string[]): Image[] {
  const protectedSet = new Set(protectedIds.map((id) => id.replace(/^sha256:/, '')));
  const byRepo = new Map<string, Image[]>();
  for (const image of images) {
    if (!PREFIXES.some((prefix) => image.repository.startsWith(prefix))) continue;
    const list = byRepo.get(image.repository) ?? [];
    list.push(image);
    byRepo.set(image.repository, list);
  }
  const removals: Image[] = [];
  for (const [, list] of byRepo) {
    const sorted = [...list].sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
    // 同一 image id 可能有多个 tag（例如 git-<sha> 别名），按 id 计保留名额。
    const kept = new Set<string>();
    for (const image of sorted) {
      if (kept.size >= keep) break;
      kept.add(image.id);
    }
    for (const image of sorted) {
      if (image.tag === '<none>' || image.tag === 'latest') continue; // 无 tag 交给 image prune 处理
      if (image.tag.startsWith('legacy-') || image.repository.includes('legacy')) continue; // 迁移期 legacy 镜像冻结保留
      if (kept.has(image.id) || protectedSet.has(image.id)) continue;
      removals.push(image);
    }
  }
  return removals;
}

function run(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: 'utf8' }) as unknown as string;
}

function images(): Image[] {
  return run('docker', ['images', '--format', '{{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.CreatedAt}}'])
    .split('\n').filter(Boolean).map((line) => {
      const [repository, tag, id, created] = line.split('\t');
      return { repository, tag, id, created: new Date(created).toISOString() };
    });
}

function idOf(reference: string): string | null {
  try {
    return run('docker', ['image', 'inspect', reference, '--format', '{{.Id}}']).trim().replace(/^sha256:/, '');
  } catch { return null; }
}

function protectedImages(dockerRoot: string, ordinaryManaged: string, dashboardRoot: string, premiumManaged: string): string[] {
  const ids: string[] = [];
  const push = (value: string | null) => { if (value) ids.push(value.replace(/^sha256:/, '')); };
  for (const managed of [ordinaryManaged, premiumManaged]) {
    try {
      const state = JSON.parse(fs.readFileSync(path.join(managed, 'deployment.json'), 'utf8'));
      const active = state.active;
      push(active?.image ?? null);
      if (active?.image_tag) push(idOf(active.image_tag));
      // active + 上一版必须保留；history 可能比 --keep 窗口更长。
      for (const item of (state.history ?? []).slice(0, 2)) {
        push(item?.image ?? null);
        if (item?.image_tag) push(idOf(item.image_tag));
      }
    } catch { /* 没有部署记录时跳过 */ }
  }
  try {
    const env = fs.readFileSync(path.join(dashboardRoot, 'compose.env'), 'utf8');
    const match = /^DASHBOARD_IMAGE=(.+)$/m.exec(env);
    push(match ? match[1].trim() : null);
  } catch { /* 没有看板时跳过 */ }
  // 运行中/存在的容器所用镜像一律保留，避免删掉正在跑的中间层。
  try {
    for (const id of run('docker', ['ps', '-a', '--format', '{{.Image}}']).split('\n').filter(Boolean)) push(idOf(id));
  } catch { /* docker 不可用时忽略 */ }
  return ids;
}

function main(): number {
  const argv = process.argv.slice(2);
  const value = (name: string, fallback: string): string => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : fallback;
  };
  const keep = Number(value('--keep', '2'));
  const apply = argv.includes('--apply');
  const cache = argv.includes('--cache');
  const dockerRoot = value('--docker-root', '/vol3/1000/Docker');
  const protectedIds = protectedImages(dockerRoot,
    path.join(dockerRoot, 'everydaytechnews-ordinary/managed'),
    path.join(dockerRoot, 'everydaytechnews-dashboard'),
    path.join(dockerRoot, 'everydaytechnews-managed'));
  const removals = plan(images(), keep, protectedIds);
  const total = removals.length;
  if (!apply) {
    console.log(JSON.stringify({ status: 'plan', keep, protected: protectedIds.length, removals: removals.map((v) => v.repository + ':' + v.tag), total }, null, 2));
    return 0;
  }
  let removed = 0;
  for (const image of removals) {
    try { run('docker', ['rmi', image.id]); removed += 1; } catch (error) { console.error('keep_failed:' + image.repository + ':' + image.tag + ':' + String((error as Error).message).slice(0, 60)); }
  }
  try { run('docker', ['image', 'prune', '-f']); } catch { /* 悬空镜像清理失败不阻断 */ }
  // 构建缓存默认不动：全量清理会让下次构建重跑全部层。显式 --cache 才清。
  if (cache) { try { run('docker', ['builder', 'prune', '-f']); } catch { /* 构建缓存清理失败不阻断 */ } }
  console.log(JSON.stringify({ status: 'applied', keep, removed, planned: total }, null, 2));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('prune-images.ts')) {
  try { process.exitCode = main(); } catch (error) { console.error(String((error as Error).message || error)); process.exitCode = 1; }
}
