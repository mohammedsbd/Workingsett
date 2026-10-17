import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunCheckpoint } from '../agent/runner.js';
import type { SideEffectEntry } from '../tools/side-effect-log.js';
import type { Arm, ArmRunResult, BenchConfig } from './types.js';

/**
 * Bench progress, saved after every task to runs/bench/<id>/progress.json,
 * so a run stopped by a quota (or the budget) continues with --resume
 * without repeating finished tasks. Holds Parsim keys made for the run, so
 * it stays in the gitignored runs/ folder.
 */

export type UnitState = {
  arm: Arm;
  run: number;
  status: 'partial' | 'done';
  checkpoint: RunCheckpoint | null;
  /** Side effects of the finished tasks only. */
  sideEffects: SideEffectEntry[];
  /** Internal model usage so far (summarize baseline). */
  internal: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    calls: number;
  };
  result: ArmRunResult | null;
};

export type BenchProgress = {
  id: string;
  config: BenchConfig;
  /** Parsim keys per arm (parsim arms only). */
  parsimKeys: Partial<Record<Arm, string>>;
  /** Parsim project ids per arm (parsim arms only). */
  parsimProjects: Partial<Record<Arm, string>>;
  units: UnitState[];
};

export const unitKey = (arm: Arm, run: number) => `${arm}#${run}`;

export class ProgressStore {
  constructor(readonly dir: string) {}

  file(id: string): string {
    return path.join(this.dir, id, 'progress.json');
  }

  async save(progress: BenchProgress): Promise<void> {
    const file = this.file(progress.id);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(progress, null, 2)}\n`, 'utf8');
  }

  async load(id: string): Promise<BenchProgress | null> {
    try {
      return JSON.parse(await readFile(this.file(id), 'utf8')) as BenchProgress;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /** The newest unfinished bench of this agent, provider and model, if any. */
  async latestUnfinished(match: {
    agent: string;
    provider: string;
    model: string;
    dryRun: boolean;
  }): Promise<BenchProgress | null> {
    let ids: string[];
    try {
      ids = await readdir(this.dir);
    } catch {
      return null;
    }
    for (const id of ids.sort().reverse()) {
      const progress = await this.load(id);
      if (
        progress &&
        progress.config.agent === match.agent &&
        progress.config.provider === match.provider &&
        progress.config.model === match.model &&
        progress.config.dryRun === match.dryRun &&
        progress.units.some((u) => u.status !== 'done')
      ) {
        return progress;
      }
    }
    return null;
  }
}

/** The unit for an arm and run, created if missing. */
export function unitFor(progress: BenchProgress, arm: Arm, run: number) {
  let unit = progress.units.find((u) => u.arm === arm && u.run === run);
  if (!unit) {
    unit = {
      arm,
      run,
      status: 'partial',
      checkpoint: null,
      sideEffects: [],
      internal: {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        calls: 0,
      },
      result: null,
    };
    progress.units.push(unit);
  }
  return unit;
}
