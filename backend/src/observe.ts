import { createObserveModule } from '@nestjs/observe';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

/**
 * NestJS Observe (APM) runs only when both credentials are set in the
 * environment, and never in tests, so each environment turns it on or off
 * through its .env without code changes. Decided once, when this module is
 * first imported (main.ts loads .env before that).
 */
export const OBSERVE_ENABLED =
  Boolean(process.env.OBSERVE_APP_KEY && process.env.OBSERVE_APP_SECRET) &&
  process.env.NODE_ENV !== 'test';
