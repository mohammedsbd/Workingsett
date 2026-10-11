import { describe, expect, it } from '@jest/globals';
import { extractContextItems } from '../context-items';
import { GeminiNativeConverter } from './gemini-native.converter';
import { ToolCallPart, ToolResultPart } from './internal-model';

const converter = new GeminiNativeConverter();

/** A request using every part type, with unusual key order. */
const body = () => ({
  contents: [
    { role: 'user', parts: [{ text: 'Find the refund policy.' }] },
    {
      parts: [
        { thought: true, text: 'Search first.', thoughtSignature: 'sig1' },
        {
          functionCall: { args: { q: 'refunds' }, name: 'search_kb' },
          thoughtSignature: 'sig2',
        },
        { functionCall: { name: 'get_order', args: { id: 7 }, id: 'call-7' } },
      ],
      role: 'model',
    },
    {
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: 'get_order',
            id: 'call-7',
            response: { output: { total: 49.9 } },
          },
        },
        {
          functionResponse: {
            name: 'search_kb',
            response: { output: 'Refunds within 30 days.' },
          },
        },
        { inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } },
        { inlineData: { mimeType: 'application/pdf', data: 'cGRm' } },
        { fileData: { mimeType: 'image/jpeg', fileUri: 'https://x/y.jpg' } },
        { executableCode: { language: 'PYTHON', code: 'print(1)' } },
      ],
    },
  ],
  systemInstruction: { parts: [{ text: 'You are terse.' }] },
  tools: [{ functionDeclarations: [{ name: 'search_kb' }] }],
  generationConfig: {
    temperature: 0.2,
    thinkingConfig: { thinkingBudget: 64 },
  },
  safetySettings: [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  ],
  cachedContent: 'cachedContents/abc',
});

describe('GeminiNativeConverter', () => {
  it('should convert a request to the internal model and back unchanged', () => {
    const original = body();
    const rebuilt = converter.fromInternal(converter.toInternal(original));
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(original));
  });

  it('should take the model from the options, since Gemini puts it in the URL', () => {
    expect(
      converter.toInternal(body(), { model: 'gemini-3.8-flash' }).model,
    ).toBe('gemini-3.8-flash');
    expect(converter.toInternal(body()).model).toBe('');
  });

  it('should map roles, the system instruction and every part type', () => {
    const request = converter.toInternal(body());

    expect(request.system?.parts).toMatchObject([
      { type: 'text', text: 'You are terse.' },
    ]);
    expect(request.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
    expect(request.messages[1].parts.map((p) => p.type)).toEqual([
      'thinking',
      'tool_call',
      'tool_call',
    ]);
    expect(request.messages[2].parts.map((p) => p.type)).toEqual([
      'tool_result',
      'tool_result',
      'image',
      'other',
      'image',
      'other',
    ]);
    expect(request.messages[2].parts[4]).toMatchObject({
      image: { source: 'url', url: 'https://x/y.jpg' },
    });
  });

  it('should pair responses with calls by id, or else by name in order', () => {
    const request = converter.toInternal(body());
    const [, search, order] = request.messages[1].parts as ToolCallPart[];
    const [orderResult, searchResult] = request.messages[2]
      .parts as ToolResultPart[];

    expect(order.id).toBe('call-7');
    expect(orderResult.toolCallId).toBe('call-7');
    expect(search.id).toBe('gemini-call:1:1');
    expect(searchResult.toolCallId).toBe(search.id);
  });

  it('should pair repeated calls of one tool in order', () => {
    const call = { functionCall: { name: 'f', args: {} } };
    const result = (n: number) => ({
      functionResponse: { name: 'f', response: { output: n } },
    });
    const request = converter.toInternal({
      contents: [
        { role: 'model', parts: [call, call] },
        { role: 'user', parts: [result(1), result(2)] },
        { role: 'user', parts: [result(3)] },
      ],
    });
    const ids = (request.messages[0].parts as ToolCallPart[]).map((p) => p.id);
    const answers = request.messages
      .slice(1)
      .flatMap((m) => m.parts as ToolResultPart[])
      .map((p) => p.toolCallId);

    expect(answers).toEqual([...ids, 'gemini-response:2:0']);
  });

  it('should mark a response that only reports an error as an error', () => {
    const request = converter.toInternal({
      contents: [
        {
          role: 'user',
          parts: [
            { functionResponse: { name: 'f', response: { error: 'down' } } },
          ],
        },
      ],
    });
    expect(request.messages[0].parts[0]).toMatchObject({ isError: true });
  });

  it('should write an edited function response under "output" and never write synthetic ids', () => {
    const request = converter.toInternal(body());
    const result = request.messages[2].parts[1] as ToolResultPart;
    request.messages[2].parts[1] = {
      ...result,
      contentForm: 'string',
      content: [
        { type: 'text', text: '[parsim dropped]', raw: '[parsim dropped]' },
      ],
    };

    const rebuilt = converter.fromInternal(request) as {
      contents: { parts: Record<string, unknown>[] }[];
    };

    expect(rebuilt.contents[2].parts[1]).toEqual({
      functionResponse: {
        name: 'search_kb',
        response: { output: '[parsim dropped]' },
      },
    });
    expect(rebuilt.contents[1].parts[1]).toEqual(body().contents[1].parts![1]);
  });

  it('should keep a string system instruction and bodies without contents as they are', () => {
    const odd = { systemInstruction: 'Be brief.', generationConfig: {} };
    const request = converter.toInternal(odd);
    expect(request.system).toBeNull();
    expect(converter.fromInternal(request)).toEqual(odd);
  });

  it('should split a request into context items with tool items', () => {
    const items = extractContextItems(converter.toInternal(body()));
    expect(items.map((i) => [i.kind, i.toolCallId])).toEqual([
      ['system', null],
      ['user', null],
      ['assistant', null],
      ['tool_call', 'gemini-call:1:1'],
      ['tool_call', 'call-7'],
      ['tool_result', 'call-7'],
      ['tool_result', 'gemini-call:1:1'],
      ['user', null],
    ]);
  });
});
