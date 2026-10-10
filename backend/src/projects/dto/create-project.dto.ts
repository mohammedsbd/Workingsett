import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { GC_MODES, GcMode } from '../../gc/gc-config';
import { UPSTREAMS, Upstream } from '../../proxy/providers/provider-adapter';

export class CreateProjectDto {
  @ApiProperty({ example: 'Research agent' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ enum: UPSTREAMS, example: 'openai' })
  @IsIn(UPSTREAMS)
  upstream: Upstream;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Store the content of context items (on by default in development, see PARSIM_STORE_CONTENT). Hashes and token counts are always stored.',
  })
  @IsOptional()
  @IsBoolean()
  storeContent?: boolean | null;

  @ApiPropertyOptional({
    enum: GC_MODES,
    default: 'shadow',
    description:
      'off: no GC. shadow: run the GC but forward the original request and record what it would have saved. on: forward the request after GC.',
  })
  @IsOptional()
  @IsIn(GC_MODES)
  gcMode?: GcMode;

  @ApiPropertyOptional({
    description:
      'Provider API key to use when a request does not send one. Stored encrypted and never returned.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  providerKey?: string;
}
