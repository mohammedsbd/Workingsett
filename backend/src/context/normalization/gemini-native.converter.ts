import { dataImageRef } from './image-ref';
import {
  asString,
  ContentForm,
  InternalMessage,
  InternalPart,
  InternalRequest,
  isObject,
  MessageConverter,
  ToInternalOptions,
} from './internal-model';

/**
 * The key a rewritten function response's text goes under. Gemini's docs
 * use "output" for a function's result and "error" for its failure.
 */
const OUTPUT_KEY = 'output';

const isImageMime = (mime: unknown): boolean =>
  typeof mime === 'string' && mime.startsWith('image/');

/**
 * Pairs function responses with function calls. Gemini ids are optional:
 * without one, a response answers the oldest unanswered call with the same
 * name. Calls without an id get a synthetic id from their position, which
 * is never written back to the request.
 */
class CallPairing {
  private readonly pending: { name: string; id: string }[] = [];

  call(raw: Record<string, unknown>, m: number, p: number): string {
    const id = asString(raw.id) || `gemini-call:${m}:${p}`;
    this.pending.push({ name: asString(raw.name), id });
    return id;
  }

  response(raw: Record<string, unknown>, m: number, p: number): string {
    const explicit = asString(raw.id);
    const name = asString(raw.name);
    const index = this.pending.findIndex((c) =>
      explicit ? c.id === explicit : c.name === name,
    );
    if (index === -1) return explicit || `gemini-response:${m}:${p}`;
    return this.pending.splice(index, 1)[0].id;
  }
}

function parts(
  raw: unknown,
  pairing: CallPairing | null,
  m: number,
): InternalPart[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((part: unknown, p): InternalPart => {
    if (!isObject(part)) return { type: 'other', raw: part };
    if (typeof part.text === 'string') {
      return part.thought === true
        ? { type: 'thinking', text: part.text, raw: part }
        : { type: 'text', text: part.text, raw: part };
    }
    const inline = part.inlineData;
    if (isObject(inline) && isImageMime(inline.mimeType)) {
      return {
        type: 'image',
        image: dataImageRef(asString(inline.mimeType), asString(inline.data)),
        raw: part,
      };
    }
    const file = part.fileData;
    if (isObject(file) && isImageMime(file.mimeType)) {
      return {
        type: 'image',
        image: { source: 'url', url: asString(file.fileUri) },
        raw: part,
      };
    }
    if (pairing && isObject(part.functionCall)) {
      return {
        type: 'tool_call',
        id: pairing.call(part.functionCall, m, p),
        name: asString(part.functionCall.name),
        input: part.functionCall.args,
        raw: part,
      };
    }
    if (pairing && isObject(part.functionResponse)) {
      const response = part.functionResponse.response;
      return {
        type: 'tool_result',
        toolCallId: pairing.response(part.functionResponse, m, p),
        content: [{ type: 'other', raw: response }],
        contentForm: 'array',
        isError:
          isObject(response) && 'error' in response && !('output' in response),
        raw: part,
      };
    }
    // code execution, documents, audio and anything new
    return { type: 'other', raw: part };
  });
}

/**
 * The function response object for rebuilt content: the original object
 * when untouched, or the text (a GC stub) under "output".
 */
function responseFrom(content: InternalPart[]): unknown {
  if (content.length === 1 && content[0].type === 'other') {
    return content[0].raw;
  }
  const text = content
    .map((part) =>
      part.type === 'text' || part.type === 'thinking' ? part.text : '',
    )
    .join('');
  return { [OUTPUT_KEY]: text };
}

function rebuildPart(part: InternalPart): unknown {
  const raw = isObject(part.raw) ? part.raw : {};
  switch (part.type) {
    case 'text':
    case 'thinking':
      return { ...raw, text: part.text };
    case 'tool_call': {
      const call = isObject(raw.functionCall) ? raw.functionCall : {};
      return {
        ...raw,
        functionCall: {
          ...call,
          // Synthetic ids are Parsim's; only a client id is written back.
          ...('id' in call && { id: part.id }),
          name: part.name,
          args: part.input,
        },
      };
    }
    case 'tool_result': {
      const response = isObject(raw.functionResponse)
        ? raw.functionResponse
        : {};
      return {
        ...raw,
        functionResponse: { ...response, response: responseFrom(part.content) },
      };
    }
    case 'image':
    case 'other':
      return part.raw;
  }
}

function contentForm(content: Record<string, unknown>): ContentForm {
  return 'parts' in content ? 'array' : 'absent';
}

function rebuildContent(
  raw: Record<string, unknown>,
  internal: InternalPart[],
  form: ContentForm,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  if (form !== 'absent' || internal.length) {
    out.parts = internal.map(rebuildPart);
  }
  return out;
}

/**
 * Gemini native format (generateContent and streamGenerateContent).
 * `contents` with role "model" are assistant messages, every other role is
 * the user side (function responses travel in user turns).
 * `systemInstruction` is the system prompt. functionCall and
 * functionResponse parts become tool_call and tool_result parts. The model
 * is in the URL, not the body, so the proxy passes it in.
 */
export class GeminiNativeConverter implements MessageConverter {
  readonly api = 'gemini-native' as const;

  toInternal(
    body: Record<string, unknown>,
    options: ToInternalOptions = {},
  ): InternalRequest {
    const contents = Array.isArray(body.contents) ? body.contents : [];
    const instruction = body.systemInstruction;
    const pairing = new CallPairing();
    return {
      api: this.api,
      model: options.model ?? asString(body.model),
      system: isObject(instruction)
        ? {
            parts: parts(instruction.parts, null, -1),
            contentForm: contentForm(instruction),
          }
        : null,
      messages: contents.filter(isObject).map(
        (raw, m): InternalMessage => ({
          role: raw.role === 'model' ? 'assistant' : 'user',
          parts: parts(raw.parts, pairing, m),
          contentForm: contentForm(raw),
          raw,
        }),
      ),
      raw: body,
    };
  }

  fromInternal(request: InternalRequest): Record<string, unknown> {
    const body: Record<string, unknown> = { ...request.raw };
    const instruction = request.raw.systemInstruction;
    if (request.system && isObject(instruction)) {
      body.systemInstruction = rebuildContent(
        instruction,
        request.system.parts,
        request.system.contentForm,
      );
    }
    if ('contents' in request.raw || request.messages.length) {
      body.contents = request.messages.map((m) =>
        rebuildContent(m.raw, m.parts, m.contentForm),
      );
    }
    return body;
  }
}
