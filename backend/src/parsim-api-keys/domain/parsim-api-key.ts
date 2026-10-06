import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';

export class ParsimApiKey {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  projectId: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  name: string | null;

  /** Start of the key, safe to show (for example "psm_AbCd1234"). */
  @ApiProperty({ type: String })
  prefix: string;

  /** SHA-256 of the key. Never serialized. */
  @Exclude({ toPlainOnly: true })
  keyHash: string;

  @ApiPropertyOptional({ type: Date, nullable: true })
  lastUsedAt: Date | null;

  @ApiPropertyOptional({ type: Date, nullable: true })
  revokedAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
