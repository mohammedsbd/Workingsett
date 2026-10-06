import { LoggerService } from '@nestjs/common';

/**
 * Nest logger for tests: keeps every message so tests can assert on what was
 * (and was not) logged, and prints only errors and warnings.
 */
export class CapturingLogger implements LoggerService {
  readonly lines: string[] = [];

  log(message: unknown, ...rest: unknown[]): void {
    this.capture('log', message, rest);
  }

  error(message: unknown, ...rest: unknown[]): void {
    this.capture('error', message, rest);
    console.error(message, ...rest);
  }

  warn(message: unknown, ...rest: unknown[]): void {
    this.capture('warn', message, rest);
    console.warn(message, ...rest);
  }

  debug(message: unknown, ...rest: unknown[]): void {
    this.capture('debug', message, rest);
  }

  verbose(message: unknown, ...rest: unknown[]): void {
    this.capture('verbose', message, rest);
  }

  /** All captured output as one string. */
  get text(): string {
    return this.lines.join('\n');
  }

  clear(): void {
    this.lines.length = 0;
  }

  private capture(level: string, message: unknown, rest: unknown[]): void {
    const parts = [message, ...rest].map((part) =>
      typeof part === 'string' ? part : JSON.stringify(part),
    );
    this.lines.push(`${level} ${parts.join(' ')}`);
  }
}
