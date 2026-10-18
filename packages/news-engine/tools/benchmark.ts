/** Offline benchmark; optional private JSON input is read only and never copied to the report. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, platform, arch, cpus, release } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { synthetic, cutoff } from '../test/fixtures.ts';
import type { Input } from '../src/cli.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const python = process.env.PYTHON ?? (existsSync(join(root, '.venv/bin/python')) ? join(root, '.venv/bin/python') : 'python3');
const reference = fileURLToPath(new URL('./python_reference.py', import.meta.url));
const worker = fileURLToPath(new URL('./node_benchmark.ts', import.meta.url));
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const args = process.argv.slice(2);
let output: string | undefined; let privateInput: string | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--output' && args[i + 1]) output = resolve(args[++i]);
  else if (args[i] === '--input' && args[i + 1]) privateInput = resolve(args[++i]);
  else throw new Error('Usage: benchmark.ts [--input private.json] [--output report.json]');
}
function run(command: string, argv: string[], input?: string) {
  const start = performance.now();
  const result = spawnSync(command, argv, { input, encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Benchmark child failed: ${result.error?.message ?? 'nonzero exit; inspect the child separately'}`);
  return { stdout: result.stdout, wall_seconds: (performance.now() - start) / 1000 };
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const datasets: { name: string; input: Input }[] = [408, 10000].map(size => ({ name: `synthetic-${size}`, input: { articles: synthetic(size), cutoff, target: 32 } }));
if (privateInput) datasets.push({ name: 'local-preprocessed-sample', input: JSON.parse(readFileSync(privateInput, 'utf8')) });
const temporary = mkdtempSync(join(tmpdir(), 'news-ranking-'));
try {
  const measurements = [];
  for (const { name, input } of datasets) {
    const encoded = JSON.stringify(input); const path = join(temporary, 'input.json'); writeFileSync(path, encoded, { mode: 0o600 });
    const expected = JSON.parse(run(python, [reference], encoded).stdout);
    const actual = JSON.parse(run(process.execPath, [cli, path]).stdout);
    if (!isDeepStrictEqual(actual, expected)) throw new Error(`Output mismatch for ${name}; private content omitted`);
    const results: Record<string, unknown> = {};
    // Alternate runtime order across three fresh processes; five warmed samples each.
    const commands: Record<string, [string, string[]]> = {
      python_original: [python, [reference, '--bench', path]],
      python_config_once: [python, [reference, '--bench', path, '--cached']],
      node_typescript: [process.execPath, [worker, path, '5']],
    };
    const aggregated: Record<string, { seconds: number[]; peak_rss_bytes: number[] }> = {};
    for (let round = 0; round < 3; round++) {
      const names = Object.keys(commands); if (round % 2) names.reverse();
      for (const runtime of names) {
        const [command, argv] = commands[runtime]; const sample = JSON.parse(run(command, argv).stdout);
        const dest = aggregated[runtime] ??= { seconds: [], peak_rss_bytes: [] };
        dest.seconds.push(...sample.seconds); dest.peak_rss_bytes.push(sample.peak_rss_bytes);
      }
    }
    for (const [name, samples] of Object.entries(aggregated)) results[name] = {
      median_seconds: median(samples.seconds), samples_seconds: samples.seconds,
      median_process_peak_rss_bytes: median(samples.peak_rss_bytes),
    };
    const cold = {} as Record<string, number>;
    // End-to-end process invocation: imports + input/config + ranking + JSON stdout.
    // This is NOT added to warmed timings, which would count computation twice.
    for (const [name, command, argv] of [
      ['python_original', python, [reference]], ['node_typescript', process.execPath, [cli]],
    ] as const) cold[name] = median(Array.from({ length: 5 }, () => run(command, [...argv], encoded).wall_seconds));
    measurements.push({ dataset: name, articles: input.articles.length, cutoff: input.cutoff, target: input.target ?? null,
      outputs_identical: true, warm: results, cold_full_invocation_seconds: cold });
    console.error(`Verified and measured ${name}: ${input.articles.length} articles`);
  }
  const startup = {
    python: median(Array.from({ length: 5 }, () => run(python, ['-c', 'pass']).wall_seconds)),
    node: median(Array.from({ length: 5 }, () => run(process.execPath, ['--eval', '']).wall_seconds)),
  };
  const report = { recorded_at: new Date().toISOString(), environment: { node: process.version,
    python: run(python, ['--version']).stdout.trim(), platform: platform(), os_release: release(), arch: arch(), cpu: cpus()[0]?.model },
    method: { fresh_processes_per_variant: 3, warm_repeats_per_process: 5, startup_repeats: 5,
      input_clone_excluded: true, config_once_excludes_initial_config_load: true,
      memory: 'Median process peak RSS after warmup, input cloning and all runs; not incremental ranking allocations. Runtime baselines differ.',
      scope: 'Offline ranking only. No network, model, SMTP, pool writes or production speed claim. Synthetic scale is not a forecast.' },
    empty_process_startup_seconds: startup, measurements };
  if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { rmSync(temporary, { recursive: true, force: true }); }
