import {
  parseProxyCredentials,
  queryWithoutKey,
  urlWithoutKey,
} from './proxy-credentials';

const PARSIM = 'psm_' + 'a'.repeat(43);

describe('parseProxyCredentials', () => {
  it.each([
    {
      name: 'should read the Parsim key from x-parsim-key',
      headers: { 'x-parsim-key': PARSIM },
      expected: { parsimKey: PARSIM, providerKey: undefined },
    },
    {
      name: 'should read a Parsim bearer token as the Parsim key',
      headers: { authorization: `Bearer ${PARSIM}` },
      expected: { parsimKey: PARSIM, providerKey: undefined },
    },
    {
      name: 'should read the provider key from x-provider-key',
      headers: { authorization: `Bearer ${PARSIM}`, 'x-provider-key': 'sk-1' },
      expected: { parsimKey: PARSIM, providerKey: 'sk-1' },
    },
    {
      name: 'should treat a non-Parsim bearer token as the provider key',
      headers: { 'x-parsim-key': PARSIM, authorization: 'Bearer sk-from-sdk' },
      expected: { parsimKey: PARSIM, providerKey: 'sk-from-sdk' },
    },
    {
      name: 'should prefer x-provider-key over a non-Parsim bearer token',
      headers: {
        'x-parsim-key': PARSIM,
        'x-provider-key': 'sk-header',
        authorization: 'Bearer sk-bearer',
      },
      expected: { parsimKey: PARSIM, providerKey: 'sk-header' },
    },
    {
      name: 'should prefer x-parsim-key over a Parsim bearer token',
      headers: {
        'x-parsim-key': PARSIM,
        authorization: 'Bearer psm_other',
      },
      expected: { parsimKey: PARSIM, providerKey: undefined },
    },
    {
      name: 'should accept a lower-case bearer scheme and trim spaces',
      headers: { authorization: `bearer   ${PARSIM}  ` },
      expected: { parsimKey: PARSIM, providerKey: undefined },
    },
    {
      name: 'should return nothing when no keys are sent',
      headers: {},
      expected: { parsimKey: undefined, providerKey: undefined },
    },
    {
      name: 'should ignore empty headers and non-bearer authorization',
      headers: {
        'x-parsim-key': '  ',
        'x-provider-key': '',
        authorization: 'Basic dXNlcjpwYXNz',
      },
      expected: { parsimKey: undefined, providerKey: undefined },
    },
  ])('$name', ({ headers, expected }) => {
    expect(parseProxyCredentials(headers)).toEqual(expected);
  });

  describe('Anthropic format', () => {
    it.each([
      {
        name: 'should accept the Parsim key as x-api-key (ANTHROPIC_API_KEY=psm_...)',
        headers: { 'x-api-key': PARSIM },
        expected: { parsimKey: PARSIM, providerKey: undefined },
      },
      {
        name: 'should treat a non-Parsim x-api-key as the provider key',
        headers: { 'x-parsim-key': PARSIM, 'x-api-key': 'sk-ant-real' },
        expected: { parsimKey: PARSIM, providerKey: 'sk-ant-real' },
      },
      {
        name: 'should prefer x-provider-key over x-api-key',
        headers: {
          'x-api-key': PARSIM,
          'x-provider-key': 'sk-ant-header',
        },
        expected: { parsimKey: PARSIM, providerKey: 'sk-ant-header' },
      },
      {
        name: 'should also read a bearer token (ANTHROPIC_AUTH_TOKEN)',
        headers: { authorization: `Bearer ${PARSIM}`, 'x-api-key': 'sk-ant-1' },
        expected: { parsimKey: PARSIM, providerKey: 'sk-ant-1' },
      },
    ])('$name', ({ headers, expected }) => {
      expect(parseProxyCredentials(headers, 'anthropic-messages')).toEqual(
        expected,
      );
    });

    it('should ignore x-api-key for OpenAI-format requests', () => {
      expect(parseProxyCredentials({ 'x-api-key': PARSIM })).toEqual({
        parsimKey: undefined,
        providerKey: undefined,
      });
    });
  });

  describe('Gemini format', () => {
    it.each([
      {
        name: 'should read a Google key from x-goog-api-key as the provider key',
        headers: { 'x-parsim-key': PARSIM, 'x-goog-api-key': 'AIza-header' },
        query: {},
        expected: { parsimKey: PARSIM, providerKey: 'AIza-header' },
      },
      {
        name: 'should read a Google key from the key query parameter',
        headers: { 'x-parsim-key': PARSIM },
        query: { key: 'AIza-query' },
        expected: { parsimKey: PARSIM, providerKey: 'AIza-query' },
      },
      {
        name: 'should read a Parsim key sent as x-goog-api-key (SDK base URL setup)',
        headers: { 'x-goog-api-key': PARSIM },
        query: {},
        expected: { parsimKey: PARSIM, providerKey: undefined },
      },
      {
        name: 'should read a Parsim key sent as the key parameter',
        headers: { 'x-goog-api-key': 'AIza-header' },
        query: { key: PARSIM },
        expected: { parsimKey: PARSIM, providerKey: 'AIza-header' },
      },
      {
        name: 'should prefer x-goog-api-key over the key parameter',
        headers: { 'x-parsim-key': PARSIM, 'x-goog-api-key': 'AIza-header' },
        query: { key: ['AIza-query', 'other'] },
        expected: { parsimKey: PARSIM, providerKey: 'AIza-header' },
      },
      {
        name: 'should prefer x-provider-key over the Google key',
        headers: { 'x-goog-api-key': PARSIM, 'x-provider-key': 'AIza-x' },
        query: { key: 'AIza-query' },
        expected: { parsimKey: PARSIM, providerKey: 'AIza-x' },
      },
    ])('$name', ({ headers, query, expected }) => {
      expect(parseProxyCredentials(headers, 'gemini-native', query)).toEqual(
        expected,
      );
    });

    it('should ignore x-goog-api-key and the key parameter for other formats', () => {
      expect(
        parseProxyCredentials({ 'x-goog-api-key': PARSIM }, 'openai-chat', {
          key: PARSIM,
        }),
      ).toEqual({ parsimKey: undefined, providerKey: undefined });
    });
  });

  describe('key stripping', () => {
    it.each([
      [{}, ''],
      [{ key: 'AIza-secret' }, ''],
      [{ alt: 'sse', key: 'AIza-secret' }, '?alt=sse'],
      [{ alt: 'sse', $fields: ['a', 'b'] }, '?alt=sse&%24fields=a&%24fields=b'],
    ])('should drop the key from query %j', (query, expected) => {
      expect(queryWithoutKey(query)).toBe(expected);
    });

    it('should drop the key from a URL and keep everything else', () => {
      expect(
        urlWithoutKey(
          '/v1beta/models/gemini-3.8-flash:streamGenerateContent?key=AIza-secret&alt=sse',
        ),
      ).toBe('/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse');
      expect(urlWithoutKey('/v1beta/models/m:generateContent')).toBe(
        '/v1beta/models/m:generateContent',
      );
    });
  });
});
