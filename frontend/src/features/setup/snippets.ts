import type { Project } from '@/lib/parsim/types';

export type Snippet = {
  id: string;
  title: string;
  /** The project upstream this snippet needs. */
  upstream: Project['upstream'];
  description: string;
  language: string;
  code: string;
};

/**
 * Integration snippets with the Parsim endpoint filled in. The Parsim key
 * is a placeholder: keys are only shown once, when created.
 */
export function setupSnippets(proxyUrl: string): Snippet[] {
  return [
    {
      id: 'openai',
      title: 'OpenAI SDK',
      upstream: 'openai',
      description:
        'Point the base URL at Parsim and use your Parsim key; Parsim forwards with the provider key stored on the project.',
      language: 'ts',
      code: `const client = new OpenAI({ baseURL: '${proxyUrl}/v1', apiKey: process.env.PARSIM_KEY });`
    },
    {
      id: 'gemini-openai',
      title: 'Gemini through the OpenAI SDK',
      upstream: 'gemini',
      description:
        "The same one line with a Gemini project: Parsim forwards to Gemini's OpenAI-compatible endpoint.",
      language: 'ts',
      code: `const client = new OpenAI({ baseURL: '${proxyUrl}/v1', apiKey: process.env.PARSIM_KEY }); // model: 'gemini-3.8-flash'`
    },
    {
      id: 'openai-compatible',
      title: 'Groq or another OpenAI-compatible API',
      upstream: 'openai-compatible',
      description:
        'The same one line with an openai-compatible project: Parsim forwards to the base URL set on the project (for example https://api.groq.com/openai/v1).',
      language: 'ts',
      code: `const client = new OpenAI({ baseURL: '${proxyUrl}/v1', apiKey: process.env.PARSIM_KEY });`
    },
    {
      id: 'gemini-native',
      title: 'Gemini native (Google GenAI SDK)',
      upstream: 'gemini',
      description: 'Set the SDK base URL to Parsim (host only; the SDK adds /v1beta/models/...).',
      language: 'ts',
      code: `const ai = new GoogleGenAI({ apiKey: process.env.PARSIM_KEY, httpOptions: { baseUrl: '${proxyUrl}' } });`
    },
    {
      id: 'anthropic',
      title: 'Anthropic SDK',
      upstream: 'anthropic',
      description: 'Point the base URL at Parsim and use your Parsim key as the API key.',
      language: 'ts',
      code: `const client = new Anthropic({ baseURL: '${proxyUrl}', apiKey: process.env.PARSIM_KEY });`
    },
    {
      id: 'claude-code',
      title: 'Claude Code',
      upstream: 'anthropic',
      description: 'Any tool that only lets you set a base URL and an API key works the same way.',
      language: 'sh',
      code: `ANTHROPIC_BASE_URL=${proxyUrl} ANTHROPIC_API_KEY=psm_... claude`
    }
  ];
}

/** Sends every request of one agent run to the same session. */
export const SESSION_HEADER_SNIPPET = `defaultHeaders: { 'x-parsim-session-id': runId }`;
