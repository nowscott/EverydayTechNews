// Offline only: reads a private frozen comparison; never opens a writable Store or imports transports.
import { readFileSync, writeFileSync } from 'node:fs';
import { select } from '../src/editor.ts';
import { evaluate, preferences } from '../src/ranking.ts';
import { limitDomains, publisherKey } from '../src/editorial-policy.ts';
import type { Row } from '../src/core.ts';
const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error('usage: compare_edition.ts private-comparison.json private-output.json');
const snapshot = JSON.parse(readFileSync(inputPath, 'utf8'));
const baseline: Row[] = snapshot.records; const cutoff = snapshot.issue.collection_cutoff;
const [chosen, rejected] = select(baseline.map(r => r.article), cutoff, false, 100);
const records = limitDomains(chosen.map(a => baseline.find(r => r.article.id === a.id)!), rejected);
const distribution = (rows: Row[], key: (r: Row) => string | null) => rows.reduce((acc: Row, r) => { const k = key(r) ?? 'unknown'; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
const selected = new Set(records.map(r => r.article.id));
const result = { issue: snapshot.issue.id, cutoff, mode: 'offline_selection_preview', model_calls: 0, smtp_calls: 0,
  whole_edition_ai_review: 'not_run_offline', original_count: baseline.length, preview_count: records.length,
  original_publishers: distribution(baseline, r => publisherKey(r.article)), preview_publishers: distribution(records, r => publisherKey(r.article)),
  original_domains: distribution(baseline, r => r.article.domain), preview_domains: distribution(records, r => r.article.domain),
  changes: baseline.map(r => ({ id: r.article.id, title: r.result.title, kept: selected.has(r.article.id),
    old_score: r.article.ranking?.score ?? null, new_ranking: evaluate(r.article, cutoff, preferences()),
    exclusions: rejected.filter(a => a.id === r.article.id) })),
  limitation: 'Only today’s 18 frozen articles are replayed; unselected pool candidates and whole-edition AI decisions are not simulated.' };
writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n', {mode: 0o600});
console.log(JSON.stringify({original: baseline.length, preview: records.length, model_calls: 0, smtp_calls: 0,
  dropped: result.changes.filter(r => !r.kept).map(r => ({title: r.title, reasons: r.exclusions.map(e => e.reason)}))}));
