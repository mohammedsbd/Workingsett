import fs from 'node:fs';
import path from 'node:path';
import { ToolCallPart, ToolResultPart } from './internal-model';
import { OpenAiChatConverter } from './openai-chat.converter';

const converter = new OpenAiChatConverter();

/** Request -> internal -> request must give back the identical JSON. */
const roundTrip = (body: Record<string, unknown>) =>
  JSON.stringify(converter.fromInternal(converter.toInternal(body)));

const fixturesDir = path.join(
  __dirname,
  '../../../test/fixtures/conversations',
);

describe('OpenAiChatConverter', () => {
  describe('round trip', () => {
    it.each(['short-chat', 'research-agent-session', 'support-agent-session'])(
      'should rebuild the %s fixture byte for byte',
      (name) => {
        const fixture = JSON.parse(
          fs.readFileSync(path.join(fixturesDir, `${name}.json`), 'utf8'),
        ) as { model: string; tools?: unknown; messages: unknown[] };
        const body = {
          model: fixture.model,
          messages: fixture.messages,
          tools: fixture.tools,
          temperature: 0.2,
        };

        expect(roundTrip(body)).toBe(JSON.stringify(body));
      },
    );

    it('should keep every content form and unknown field', () => {
      const body = {
        stream: true,
        model: 'gpt-4o',
        messages: [
          { role: 'developer', content: 'Be brief.', name: 'ops' },
          {
            content: [
              { type: 'text', text: 'What is in this image?' },
              {
                type: 'image_url',
                image_url: { url: 'https://example.com/a.png', detail: 'low' },
              },
              {
                type: 'image_url',
                image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' },
              },
              {
                type: 'input_audio',
                input_audio: { data: 'UklGRg==', format: 'wav' },
              },
            ],
            role: 'user',
          },
          {
            role: 'assistant',
            content: null,
            refusal: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'lookup', arguments: '{"q": "x"}' },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
          {
            role: 'tool',
            tool_call_id: 'call_2',
            content: [{ type: 'text', text: 'part' }],
          },
          { role: 'assistant', tool_calls: [] },
          { role: 'assistant', content: 'Done.' },
        ],
        response_format: { type: 'json_object' },
      };

      expect(roundTrip(body)).toBe(JSON.stringify(body));
    });

    it('should keep a body without messages unchanged', () => {
      const body = { model: 'x', input: 'not chat' };
      expect(roundTrip(body)).toBe(JSON.stringify(body));
    });
  });

  describe('internal model', () => {
    const internal = converter.toInternal({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'S' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Look' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/jpeg;base64,AAAA' },
            },
          ],
        },
        {
          role: 'assistant',
          content: 'Calling a tool.',
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'f', arguments: '{}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'c1', content: 'result' },
      ],
    });

    it('should map roles and parts', () => {
      expect(internal.messages.map((m) => m.role)).toEqual([
        'system',
        'user',
        'assistant',
        'tool',
      ]);
      expect(internal.messages[2].parts.map((p) => p.type)).toEqual([
        'text',
        'tool_call',
      ]);
      expect(internal.messages[2].parts[1] as ToolCallPart).toMatchObject({
        id: 'c1',
        name: 'f',
        input: '{}',
      });
      expect(internal.messages[3].parts[0] as ToolResultPart).toMatchObject({
        type: 'tool_result',
        toolCallId: 'c1',
        content: [{ type: 'text', text: 'result' }],
      });
    });

    it('should reference inline images by hash instead of embedding them', () => {
      const image = internal.messages[1].parts[1];
      expect(image).toMatchObject({
        type: 'image',
        image: {
          source: 'data',
          mediaType: 'image/jpeg',
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          bytes: 3,
        },
      });
    });

    it('should apply edits to the rebuilt request', () => {
      const edited = converter.toInternal({
        model: 'm',
        messages: [{ role: 'user', content: 'long text' }],
      });
      const part = edited.messages[0].parts[0];
      if (part.type === 'text') part.text = 'short';

      expect(converter.fromInternal(edited)).toEqual({
        model: 'm',
        messages: [{ role: 'user', content: 'short' }],
      });
    });
  });
});
