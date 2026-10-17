import type { ToolDefinition } from '../llm/types.js';

/** Where the agent is when a tool runs. */
export type ToolContext = {
  /** The id of the task (question or ticket) being worked on. */
  taskId: string;
  /** 1-based position of that task in the run. */
  taskIndex: number;
  /** The model call that asked for this tool (1-based, across the run). */
  step: number;
};

export type Tool = {
  definition: ToolDefinition;
  /** Side-effect tools change the world (or would); they are logged and never recorded. */
  sideEffect: boolean;
  run(args: Record<string, unknown>, context: ToolContext): Promise<string>;
};

/** A tool argument as a string ('' when missing). */
export function stringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  return typeof value === 'string'
    ? value
    : value === undefined
      ? ''
      : String(value);
}
