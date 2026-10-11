import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { UPSTREAMS, Upstream } from '../../proxy/providers/provider-adapter';
import { GC_MODES, GcMode } from '../../gc/gc-config';
import { User } from '../../users/domain/user';

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
