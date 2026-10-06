import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateParsimApiKeyDto {
  @ApiPropertyOptional({ example: 'Production agent' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}
