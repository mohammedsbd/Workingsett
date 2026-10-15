import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  Min,
} from 'class-validator';

/** The request points and budget of a replay; both have defaults. */
export class StartReplayDto {
  @ApiPropertyOptional({
    type: [Number],
    description:
      'Request numbers to replay. Default: up to REPLAY_DEFAULT_POINTS requests the GC changed, spread over the session.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  @Min(1, { each: true })
  requestNumbers?: number[];

  @ApiPropertyOptional({
    description:
      'Hard budget in USD. Default REPLAY_DEFAULT_BUDGET_USD, at most REPLAY_MAX_BUDGET_USD.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @IsPositive()
  budgetUsd?: number;
}
