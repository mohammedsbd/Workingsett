import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** A date range; defaults to the last 30 days. */
export class DateRangeQueryDto {
  @ApiPropertyOptional({ description: 'Start (ISO 8601, inclusive).' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'End (ISO 8601, exclusive).' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export const SESSION_SORTS = [
  'lastSeenAt',
  'firstSeenAt',
  'requestCount',
  'tokensSaved',
] as const;
export type SessionSort = (typeof SESSION_SORTS)[number];

export class SessionsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ enum: SESSION_SORTS, default: 'lastSeenAt' })
  @IsOptional()
  @IsIn(SESSION_SORTS)
  sort?: SessionSort;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @ApiPropertyOptional({ description: 'Matches the session id or model.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
