import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ProgressStore } from '../bench/progress.js';
import {
  renderJson,
  renderMarkdown,
  renderSvg,
  reportFiles,
  summarizeArms,
} from '../bench/report.js';
import type { BenchResults } from '../bench/types.js';
import { ROOT } from '../config.js';

/**
 * Renders a bench's report again from its saved results
 * (runs/bench/<id>/progress.json), for example after a change to the
 * report's layout. The numbers come from the results, never by hand.
 *
 *   npm run bench:report -- --id <bench id> [--out-dir <dir>]
 */
const { values } = parseArgs({
  options: { id: { type: 'string' }, 'out-dir': { type: 'string' } },
});
if (!values.id) {
  console.error(
    'Usage: npm run bench:report -- --id <bench id> [--out-dir <dir>]',
  );
  process.exit(1);
}
const store = new ProgressStore(path.join(ROOT, 'runs', 'bench'));
const progress = await store.load(values.id);
if (!progress) {
  console.error(`No bench ${values.id} in runs/bench.`);
  process.exit(1);
}
const done = progress.units.filter((u) => u.status === 'done' && u.result);
const complete =
  done.length === progress.config.arms.length * progress.config.runs;
const results: BenchResults = {
  config: progress.config,
  results: done
    .map((u) => u.result!)
    .sort(
      (a, b) =>
        a.run - b.run ||
        progress.config.arms.indexOf(a.arm) -
          progress.config.arms.indexOf(b.arm),
    ),
  // The end of the last arm run, from its recorded steps.
  finishedAt: complete
    ? (done
        .flatMap((u) => u.result!.stepRecords.map((s) => s.startedAt))
        .sort()
        .at(-1) ?? null)
    : null,
};
const summaries = summarizeArms(results);
const files = reportFiles(results);
const outDir = values['out-dir']
  ? path.resolve(values['out-dir'])
  : progress.config.dryRun
    ? path.join(store.dir, progress.id)
    : path.join(ROOT, '..', 'docs', 'benchmarks');
await mkdir(outDir, { recursive: true });
await writeFile(
  path.join(outDir, files.markdown),
  renderMarkdown(results, summaries, files),
  'utf8',
);
await writeFile(
  path.join(outDir, files.json),
  renderJson(results, summaries),
  'utf8',
);
await writeFile(path.join(outDir, files.svg), renderSvg(summaries), 'utf8');
console.log(`Report: ${path.join(outDir, files.markdown)}`);
