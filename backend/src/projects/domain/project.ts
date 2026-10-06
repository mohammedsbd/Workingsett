import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import {
  UPSTREAMS,
  Upstream,
} from '../../proxy/providers/chat-completions-adapter';
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
