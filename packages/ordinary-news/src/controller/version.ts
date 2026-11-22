/** 版本与时间窗口：与 deploy/nas/manage.py 的 version/choose/protected 保持一致。 */
export type Triple = [number, number, number];

export function version(tag: string | undefined, prefix: string): Triple | null {
  if (!tag) return null;
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp('^' + escaped + '(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$').exec(tag);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function compare(a: Triple, b: Triple): number {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export interface Release {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
}

export function choose(releases: Release[], floor: Triple, prefix: string): Release | null {
  let best: { release: Release; version: Triple } | null = null;
  for (const release of releases) {
    const v = version(release.tag_name, prefix);
    if (!v || release.draft || release.prerelease || !release.published_at) continue;
    if (compare(v, floor) <= 0) continue;
    if (!best || compare(v, best.version) > 0) best = { release, version: v };
  }
  return best ? best.release : null;
}

/** 04:00–08:59（Asia/Shanghai）不部署，避开出刊窗口。 */
export function protectedWindow(now: Date = new Date()): boolean {
  const hour = (now.getUTCHours() + 8) % 24;
  return hour >= 4 && hour < 9;
}

export function shanghaiIso(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + 8 * 3600 * 1000);
  return shifted.toISOString().replace('Z', '+08:00');
}
