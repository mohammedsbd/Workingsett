import { parseProxyCredentials } from './proxy-credentials';

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
});
