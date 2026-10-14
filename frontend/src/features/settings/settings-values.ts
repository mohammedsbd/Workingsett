import type { ProjectSettings, ThresholdKey } from '@/lib/parsim/types';
import { z } from 'zod';
import type { SettingsUpdate } from './api/service';

/** The settings form's values and their conversion to and from the API. */

export const THRESHOLDS: { key: ThresholdKey; label: string; description: string; min: number }[] =
  [
    {
      key: 'gcMinContextTokens',
      label: 'Minimum context (tokens)',
      description: 'New GC decisions only when the context is larger than this.',
      min: 0
    },
    {
      key: 'gcBatchTokens',
      label: 'Batch size (tokens)',
      description:
        'A new pass only after this much context was added since the last one, so the cached prompt prefix changes rarely.',
      min: 0
    },
    {
      key: 'gcProtectedTurns',
      label: 'Protected turns',
      description: 'The last N turns are never changed.',
      min: 1
    },
    {
      key: 'gcArchiveMinTokens',
      label: 'Archive above (tokens)',
      description: 'Tool results larger than this can be archived...',
      min: 0
    },
    {
      key: 'gcArchiveAfterTurns',
      label: 'Archive after (turns)',
      description: '...once they are more than this many turns old.',
      min: 1
    }
  ];

const optionalInt = (min: number) =>
  z.number().int('Whole numbers only').min(min, `At least ${min}`).optional();

export const settingsSchema = z.object({
  gcMode: z.enum(['off', 'shadow', 'on']),
  storeContent: z.enum(['default', 'true', 'false']),
  gcSideEffectTools: z.array(z.string().trim().min(1).max(200)).max(100),
  gcMinContextTokens: optionalInt(0),
  gcBatchTokens: optionalInt(0),
  gcProtectedTurns: optionalInt(1),
  gcArchiveMinTokens: optionalInt(0),
  gcArchiveAfterTurns: optionalInt(1),
  compressionEnabled: z.boolean(),
  compressionKeySource: z.enum(['parsim', 'project']),
  compressionModel: z.string().trim().max(100)
});

export type SettingsValues = z.input<typeof settingsSchema>;

export function toForm(settings: ProjectSettings): SettingsValues {
  return {
    gcMode: settings.gcMode,
    storeContent:
      settings.storeContent === null ? 'default' : settings.storeContent ? 'true' : 'false',
    gcSideEffectTools: settings.sideEffectTools.project,
    compressionEnabled: settings.compression.enabled,
    compressionKeySource: settings.compression.keySource,
    compressionModel: settings.compression.model ?? '',
    ...(Object.fromEntries(
      THRESHOLDS.map((t) => [t.key, settings.thresholds[t.key].value ?? undefined])
    ) as Partial<Record<ThresholdKey, number>>)
  };
}

export function toUpdate(values: SettingsValues): SettingsUpdate {
  return {
    gcMode: values.gcMode,
    storeContent: values.storeContent === 'default' ? null : values.storeContent === 'true',
    gcSideEffectTools: [...new Set(values.gcSideEffectTools.map((t) => t.trim()).filter(Boolean))],
    compressionEnabled: values.compressionEnabled,
    compressionKeySource: values.compressionKeySource,
    compressionModel: values.compressionModel.trim() || null,
    ...(Object.fromEntries(THRESHOLDS.map((t) => [t.key, values[t.key] ?? null])) as Record<
      ThresholdKey,
      number | null
    >)
  };
}
