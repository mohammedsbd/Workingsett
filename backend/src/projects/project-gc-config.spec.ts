import { describe, expect, it } from '@jest/globals';
import { DEFAULT_GC_CONFIG } from '../gc/gc-config';
import { projectGcConfig, ProjectGcSettings } from './project-gc-config';

const unset: ProjectGcSettings = {
  gcMinContextTokens: null,
  gcBatchTokens: null,
  gcProtectedTurns: null,
  gcArchiveMinTokens: null,
  gcArchiveAfterTurns: null,
  gcSideEffectTools: [],
};

describe('projectGcConfig', () => {
  it('should use the server defaults when the project sets nothing', () => {
    expect(projectGcConfig(unset, DEFAULT_GC_CONFIG)).toEqual(
      DEFAULT_GC_CONFIG,
    );
  });

  it("should use the project's own thresholds, including zero", () => {
    expect(
      projectGcConfig(
        {
          ...unset,
          gcMinContextTokens: 0,
          gcBatchTokens: 2000,
          gcProtectedTurns: 3,
          gcArchiveMinTokens: 800,
          gcArchiveAfterTurns: 4,
        },
        DEFAULT_GC_CONFIG,
      ),
    ).toMatchObject({
      minContextTokens: 0,
      batchTokens: 2000,
      protectedTurns: 3,
      archiveMinTokens: 800,
      archiveAfterTurns: 4,
    });
  });

  it('should add project side-effect tools to the server list, once each', () => {
    const config = projectGcConfig(
      { ...unset, gcSideEffectTools: ['book_flight', 'save_note'] },
      { ...DEFAULT_GC_CONFIG, sideEffectTools: ['save_note'] },
    );
    expect(config.sideEffectTools).toEqual(['save_note', 'book_flight']);
    expect(config.sideEffectPatterns).toEqual(
      DEFAULT_GC_CONFIG.sideEffectPatterns,
    );
  });
});
