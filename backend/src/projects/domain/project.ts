import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { UPSTREAMS, Upstream } from '../../proxy/providers/provider-adapter';
import { GC_MODES, GcMode } from '../../gc/gc-config';
import { User } from '../../users/domain/user';

export const COMPRESSION_KEY_SOURCES = ['parsim', 'project'] as const;
export type CompressionKeySource = (typeof COMPRESSION_KEY_SOURCES)[number];

export class Project {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ enum: UPSTREAMS })
  upstream: Upstream;

  /** The user who owns the project. Every project belongs to a user. */
  @ApiProperty({ type: Number })
  ownerId: number;

  @Exclude({ toPlainOnly: true })
  owner?: User;

  /**
   * Whether to store the content of context items (hashes, token counts
   * and kinds are always stored). null means the PARSIM_STORE_CONTENT
   * default.
   */
  @ApiProperty({ type: Boolean, nullable: true })
  storeContent: boolean | null;

  /**
   * off: no GC. shadow (default): run the GC but forward the original
   * request, recording what it would have saved. on: forward the GC'd
   * request.
   */
  @ApiProperty({ enum: GC_MODES })
  gcMode: GcMode;

  /** New GC decisions only above this many context tokens. Null uses the server default. */
  @ApiProperty({ type: Number, nullable: true })
  gcMinContextTokens: number | null;

  /** A new GC pass only after this many tokens were added since the last one. Null uses the server default. */
  @ApiProperty({ type: Number, nullable: true })
  gcBatchTokens: number | null;

  /** The last N turns are never changed. Null uses the server default. */
  @ApiProperty({ type: Number, nullable: true })
  gcProtectedTurns: number | null;

  /** Tool results above this many tokens can be archived. Null uses the server default. */
  @ApiProperty({ type: Number, nullable: true })
  gcArchiveMinTokens: number | null;

  /** Archive them once they are more than this many turns old. Null uses the server default. */
  @ApiProperty({ type: Number, nullable: true })
  gcArchiveAfterTurns: number | null;

  /**
   * Tool names with side effects for this project, on top of the server's
   * GC_SIDE_EFFECT_TOOLS and the default patterns. Never dropped or archived.
   */
  @ApiProperty({ type: String, isArray: true })
  gcSideEffectTools: string[];

  /**
   * Compress finished stretches of long sessions into state blocks (GC on
   * mode only). Off by default: each summary is a paid model call.
   */
  @ApiProperty({ type: Boolean })
  compressionEnabled: boolean;

  /**
   * Whose key pays for summaries: Parsim's internal model, or the project's
   * own provider key with compressionModel.
   */
  @ApiProperty({ enum: COMPRESSION_KEY_SOURCES })
  compressionKeySource: CompressionKeySource;

  /** Model for summaries when the project's own key is used. */
  @ApiProperty({ type: String, nullable: true })
  compressionModel: string | null;

  /**
   * Whose key pays for the replay judge: Parsim's internal model, or the
   * project's own provider key with replayJudgeModel. The replay calls
   * themselves always use the project's own key.
   */
  @ApiProperty({ enum: COMPRESSION_KEY_SOURCES })
  replayJudgeKeySource: CompressionKeySource;

  /** Model for the replay judge when the project's own key is used. */
  @ApiProperty({ type: String, nullable: true })
  replayJudgeModel: string | null;

  /** AES-256-GCM encrypted provider key. Never serialized. */
  @Exclude({ toPlainOnly: true })
  providerKeyEncrypted?: string | null;

  @ApiProperty({ type: Boolean })
  @Expose()
  get hasProviderKey(): boolean {
    return Boolean(this.providerKeyEncrypted);
  }

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
