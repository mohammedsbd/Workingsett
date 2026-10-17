import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ToolDefinition } from '../llm/types.js';
import type { Tool, ToolContext } from './types.js';

/**
 * Recorded mode for tools without side effects, so benchmark runs are
 * repeatable, cheap and need no network:
 *
 * - record: run the real tool and save its result
 * - replay: return the saved result; a missing recording fails loudly
 * - live:   run the real tool, save nothing
 *
 * Recordings live at recordings/<agent>/<tool>/<hash>.json, where the hash
 * is of the tool's canonical arguments: `canonical` maps the model's
 * arguments (and the run's position, for results that change over time)
 * to the form that decides the result. So two wordings of the same search
 * replay the same recording.
 */

export const TOOL_MODES = ['record', 'replay', 'live'] as const;
export type ToolMode = (typeof TOOL_MODES)[number];

/** JSON with sorted keys, so equal arguments always hash the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function recordingKey(canonicalArgs: unknown): string {
  return createHash('sha256')
    .update(canonicalJson(canonicalArgs))
    .digest('hex')
    .slice(0, 24);
}

export type Recording = {
  tool: string;
  args: unknown;
  result: string;
};

export class MissingRecordingError extends Error {
  constructor(
    readonly tool: string,
    readonly canonicalArgs: unknown,
    readonly file: string,
  ) {
    super(
      `No recording for ${tool} ${canonicalJson(canonicalArgs)} (expected ${file}). Run in record mode (npm run record, or --mode record) to create it.`,
    );
    this.name = 'MissingRecordingError';
  }
}

export type RecordedToolSpec = {
  definition: ToolDefinition;
  /** The arguments that decide the result, from the model's arguments. */
  canonical: (args: Record<string, unknown>, context: ToolContext) => unknown;
  /** The real tool, given the canonical arguments. */
  source: (canonicalArgs: unknown) => Promise<string>;
};

export class RecordingStore {
  constructor(
    /** recordings/<agent> */
    readonly dir: string,
  ) {}

  file(tool: string, canonicalArgs: unknown): string {
    return path.join(this.dir, tool, `${recordingKey(canonicalArgs)}.json`);
  }

  async read(tool: string, canonicalArgs: unknown): Promise<Recording | null> {
    try {
      const text = await readFile(this.file(tool, canonicalArgs), 'utf8');
      return JSON.parse(text) as Recording;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async write(tool: string, canonicalArgs: unknown, result: string) {
    const file = this.file(tool, canonicalArgs);
    await mkdir(path.dirname(file), { recursive: true });
    const recording: Recording = { tool, args: canonicalArgs, result };
    await writeFile(file, `${JSON.stringify(recording, null, 2)}\n`, 'utf8');
  }
}

/** A tool without side effects, in record, replay or live mode. */
export function recordedTool(
  spec: RecordedToolSpec,
  store: RecordingStore,
  mode: ToolMode,
): Tool {
  const name = spec.definition.name;
  return {
    definition: spec.definition,
    sideEffect: false,
    async run(args, context) {
      const canonicalArgs = spec.canonical(args, context);
      if (mode === 'replay') {
        const recording = await store.read(name, canonicalArgs);
        if (!recording) {
          throw new MissingRecordingError(
            name,
            canonicalArgs,
            store.file(name, canonicalArgs),
          );
        }
        return recording.result;
      }
      const result = await spec.source(canonicalArgs);
      if (mode === 'record') await store.write(name, canonicalArgs, result);
      return result;
    },
  };
}
