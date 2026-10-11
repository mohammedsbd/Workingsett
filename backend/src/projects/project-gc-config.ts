import { GcConfig } from '../gc/gc-config';
import { Project } from './domain/project';

export type ProjectGcSettings = Pick<
  Project,
  | 'gcMinContextTokens'
  | 'gcBatchTokens'
  | 'gcProtectedTurns'
  | 'gcArchiveMinTokens'
  | 'gcArchiveAfterTurns'
  | 'gcSideEffectTools'
>;

/**
 * The GC config for a project: its own thresholds where set, the server
 * defaults (.env) otherwise. Side-effect tools are added to the server's
 * list, never replace it, so a project can only protect more.
 */
export function projectGcConfig(
  project: ProjectGcSettings,
  defaults: GcConfig,
): GcConfig {
  return {
    ...defaults,
    minContextTokens: project.gcMinContextTokens ?? defaults.minContextTokens,
    batchTokens: project.gcBatchTokens ?? defaults.batchTokens,
    protectedTurns: project.gcProtectedTurns ?? defaults.protectedTurns,
    archiveMinTokens: project.gcArchiveMinTokens ?? defaults.archiveMinTokens,
    archiveAfterTurns:
      project.gcArchiveAfterTurns ?? defaults.archiveAfterTurns,
    sideEffectTools: [
      ...new Set([
        ...defaults.sideEffectTools,
        ...(project.gcSideEffectTools ?? []),
      ]),
    ],
  };
}
