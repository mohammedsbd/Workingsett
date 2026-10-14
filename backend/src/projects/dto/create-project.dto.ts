import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { GC_MODES, GcMode } from '../../gc/gc-config';
import {
  COMPRESSION_KEY_SOURCES,
  CompressionKeySource,
} from '../domain/project';
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
    type: Number,
    nullable: true,
    description:
      'New GC decisions only above this many context tokens. Null uses the server default.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  gcMinContextTokens?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'A new GC pass only after this many tokens were added since the last one. Null uses the server default.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  gcBatchTokens?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'The last N turns are never changed. Null uses the server default.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  gcProtectedTurns?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'Tool results above this many tokens can be archived. Null uses the server default.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  gcArchiveMinTokens?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'Archive them once they are more than this many turns old. Null uses the server default.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  gcArchiveAfterTurns?: number | null;

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    description:
      'Tool names with side effects (never dropped or archived), added to the server defaults.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(200, { each: true })
  gcSideEffectTools?: string[];

  @ApiPropertyOptional({
    description:
      'Compress finished stretches of long sessions into state blocks (GC on mode only). Each summary is a paid model call.',
  })
  @IsOptional()
  @IsBoolean()
  compressionEnabled?: boolean;

  @ApiPropertyOptional({
    enum: COMPRESSION_KEY_SOURCES,
    description:
      "Who pays for summaries: Parsim's internal model, or the project's own provider key with compressionModel.",
  })
  @IsOptional()
  @IsIn(COMPRESSION_KEY_SOURCES)
  compressionKeySource?: CompressionKeySource;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: "Model for summaries when the project's own key is used.",
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  compressionModel?: string | null;

  @ApiPropertyOptional({
    description:
      'Provider API key to use when a request does not send one. Stored encrypted and never returned.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  providerKey?: string;
}
