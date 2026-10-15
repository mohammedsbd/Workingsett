import { ProxyApi } from '../proxy/providers/provider-adapter';

const asObject = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * A recorded request made ready to replay: not streamed, and at
 * temperature 0 when `temperatureZero` is asked for and the request allows
 * it (Anthropic requires temperature 1 with extended thinking). Everything
 * else stays as recorded, the model included.
 */
export function forReplay(
  api: ProxyApi,
  body: Record<string, unknown>,
  temperatureZero: boolean,
): { body: Record<string, unknown>; temperatureZero: boolean } {
  const copy = structuredClone(body);
  if (api !== 'gemini-native') {
    delete copy.stream;
    delete copy.stream_options;
  }
  if (!temperatureZero) return { body: copy, temperatureZero: false };
  if (api === 'gemini-native') {
    copy.generationConfig = {
      ...asObject(copy.generationConfig),
      temperature: 0,
    };
    return { body: copy, temperatureZero: true };
  }
  if (
    api === 'anthropic-messages' &&
    asObject(copy.thinking).type === 'enabled'
  ) {
    return { body: copy, temperatureZero: false };
  }
  copy.temperature = 0;
  return { body: copy, temperatureZero: true };
}

/** The request's own output limit, if it sets one. */
export function maxOutputTokens(
  api: ProxyApi,
  body: Record<string, unknown>,
): number | null {
  const value =
    api === 'gemini-native'
      ? asObject(body.generationConfig).maxOutputTokens
      : api === 'anthropic-messages'
        ? body.max_tokens
        : (body.max_completion_tokens ?? body.max_tokens);
  return typeof value === 'number' && value > 0 ? value : null;
}

/** An upstream 400 that names the temperature: the model does not take it. */
export function rejectsTemperature(status: number, response: unknown): boolean {
  return (
    status === 400 &&
    JSON.stringify(response ?? '')
      .toLowerCase()
      .includes('temperature')
  );
}
