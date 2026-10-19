import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { execute, type Input } from '../src/cli.ts';
import { preferences } from '../src/ranking.ts';

const value: Input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
value.config ??= preferences(); // Same once-per-run config loading as cached Python.
const repeats = Number(process.argv[3] ?? 5);
execute(structuredClone(value));
const seconds: number[] = [];
for (let i = 0; i < repeats; i++) {
  const data = structuredClone(value);
  const start = performance.now(); execute(data); seconds.push((performance.now() - start) / 1000);
}
const sorted = [...seconds].sort((a, b) => a - b);
console.log(JSON.stringify({ seconds, median_seconds: sorted[Math.floor(sorted.length / 2)], peak_rss_bytes: process.resourceUsage().maxRSS * 1024 }));
