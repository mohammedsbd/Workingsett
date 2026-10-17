import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Every side-effect tool call of a run (tool, arguments, step), in order,
 * kept in memory and appended to a JSON Lines file. Step 16b compares these
 * logs across benchmark arms to flag missing, duplicated or changed calls.
 * The tools themselves never act on anything: they are logged only.
 */

export type SideEffectEntry = {
  tool: string;
  args: Record<string, unknown>;
  /** The model call that made it (1-based, across the run). */
  step: number;
  taskId: string;
};

export class SideEffectLog {
  readonly entries: SideEffectEntry[] = [];

  constructor(
    /** The JSON Lines file, or undefined to keep the log in memory only. */
    readonly file?: string,
  ) {}

  async record(entry: SideEffectEntry): Promise<void> {
    this.entries.push(entry);
    if (!this.file) return;
    await mkdir(path.dirname(this.file), { recursive: true });
    await appendFile(this.file, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  forTask(taskId: string): SideEffectEntry[] {
    return this.entries.filter((e) => e.taskId === taskId);
  }
}

/** Parses a side-effect log file's contents. */
export function parseSideEffectLog(text: string): SideEffectEntry[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as SideEffectEntry);
}
