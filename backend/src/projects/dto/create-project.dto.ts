import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
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
    description:
      'Provider API key to use when a request does not send one. Stored encrypted and never returned.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  providerKey?: string;
}
