import { registerAs } from '@nestjs/config';
import {
  IsBooleanString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import validateConfig from '../../utils/validate-config';
import { ReplayConfig } from './replay-config.type';

/** Empty values (KEY= in .env) mean "use the default". */
const isSet = (_: object, value: unknown) =>
  value !== undefined && value !== null && value !== '';

// Checked as text: an empty value must stay empty, not become 0.
const POSITIVE_NUMBER = /^[1-9]\d*$/;
const USD = /^(\d+(\.\d+)?|\.\d+)$/;
const SCORE = /^[1-5]$/;

class EnvironmentVariablesValidator {
  @IsBooleanString()
  @ValidateIf(isSet)
  REPLAY_WORKER: string;

  @Matches(POSITIVE_NUMBER)
  @ValidateIf(isSet)
  REPLAY_POLL_SECONDS: string;

  @Matches(USD)
  @ValidateIf(isSet)
  REPLAY_DEFAULT_BUDGET_USD: string;

  @Matches(USD)
  @ValidateIf(isSet)
  REPLAY_MAX_BUDGET_USD: string;

  @Matches(POSITIVE_NUMBER)
  @ValidateIf(isSet)
  REPLAY_DEFAULT_POINTS: string;

  @Matches(POSITIVE_NUMBER)
  @ValidateIf(isSet)
  REPLAY_MAX_POINTS: string;

  @MaxLength(100)
  @ValidateIf(isSet)
  REPLAY_JUDGE_MODEL: string;

  @Matches(SCORE)
  @ValidateIf(isSet)
  REPLAY_JUDGE_PASS_SCORE: string;

  @Matches(POSITIVE_NUMBER)
  @ValidateIf(isSet)
  REPLAY_OUTPUT_RESERVE_TOKENS: string;

  @Matches(POSITIVE_NUMBER)
  @ValidateIf(isSet)
  REPLAY_DEFAULT_OUTPUT_TOKENS: string;
}

const intOr = (value: string | undefined, fallback: number) =>
  value ? parseInt(value, 10) : fallback;
const usdOr = (value: string | undefined, fallback: number) =>
  value ? Number(value) : fallback;

export default registerAs<ReplayConfig>('replay', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    worker: process.env.REPLAY_WORKER !== 'false',
    pollSeconds: intOr(process.env.REPLAY_POLL_SECONDS, 2),
    defaultBudgetUsd: usdOr(process.env.REPLAY_DEFAULT_BUDGET_USD, 1),
    maxBudgetUsd: usdOr(process.env.REPLAY_MAX_BUDGET_USD, 25),
    defaultPoints: intOr(process.env.REPLAY_DEFAULT_POINTS, 5),
    maxPoints: intOr(process.env.REPLAY_MAX_POINTS, 20),
    judgeModel: process.env.REPLAY_JUDGE_MODEL?.trim() ?? '',
    passScore: intOr(process.env.REPLAY_JUDGE_PASS_SCORE, 4),
    outputReserveTokens: intOr(process.env.REPLAY_OUTPUT_RESERVE_TOKENS, 4096),
    defaultOutputTokens: intOr(process.env.REPLAY_DEFAULT_OUTPUT_TOKENS, 500),
  };
});
