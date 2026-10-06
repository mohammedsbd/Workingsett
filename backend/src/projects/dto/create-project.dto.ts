import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  UPSTREAMS,
  Upstream,
} from '../../proxy/providers/chat-completions-adapter';

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
    description:
      'Provider API key to use when a request does not send one. Stored encrypted and never returned.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  providerKey?: string;
}
