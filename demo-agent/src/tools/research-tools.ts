import type { ResearchWorld } from '../world/research-world.js';
import {
  recordedTool,
  type RecordingStore,
  type ToolMode,
} from './recorder.js';
import type { SideEffectLog } from './side-effect-log.js';
import { stringArg, type Tool } from './types.js';

/**
 * The research agent's tools:
 * - web_search and fetch_page: recorded (no side effects)
 * - take_note: keeps a note in the agent's own context; nothing external
 * - save_report: a side effect (it would publish the answer), logged only
 */

export function researchTools(
  world: ResearchWorld,
  store: RecordingStore,
  mode: ToolMode,
  log: SideEffectLog,
): Tool[] {
  const webSearch = recordedTool(
    {
      definition: {
        name: 'web_search',
        description:
          'Search the web. Returns up to three results with a title, URL and snippet.',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'The query.' } },
          required: ['query'],
        },
      },
      // The search engine answers by the site the query is about.
      canonical: (args) => ({
        subject: world.matchSubject(stringArg(args, 'query'))?.slug ?? null,
      }),
      source: (canonical) => {
        const { subject } = canonical as { subject: string | null };
        const results = world.search(subject);
        return Promise.resolve(
          results.length
            ? results
                .map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet}`)
                .join('\n\n')
            : 'No results.',
        );
      },
    },
    store,
    mode,
  );

  const knownUrls = new Set(world.urls());
  const fetchPage = recordedTool(
    {
      definition: {
        name: 'fetch_page',
        description: 'Fetch a web page by URL and return its text.',
        parameters: {
          type: 'object',
          properties: { url: { type: 'string', description: 'The URL.' } },
          required: ['url'],
        },
      },
      // Site pages are revised during a run: the revision is part of the key.
      canonical: (args, context) => {
        const url = stringArg(args, 'url').trim().replace(/\/+$/, '');
        return knownUrls.has(url)
          ? { url, revision: world.revisionAt(url, context.taskIndex) }
          : { url: null, revision: 0 };
      },
      source: (canonical) => {
        const { url, revision } = canonical as {
          url: string | null;
          revision: number;
        };
        return Promise.resolve(
          (url && world.page(url, revision)) ?? '404: page not found.',
        );
      },
    },
    store,
    mode,
  );

  const takeNote: Tool = {
    definition: {
      name: 'take_note',
      description:
        'Write a short note for yourself. Notes are not shown again; they stay in this conversation.',
      parameters: {
        type: 'object',
        properties: { note: { type: 'string' } },
        required: ['note'],
      },
    },
    sideEffect: false,
    run: () => Promise.resolve('Noted.'),
  };

  const saveReport: Tool = {
    definition: {
      name: 'save_report',
      description:
        "Save your final answer to a question in the team's report. Call it once per question.",
      parameters: {
        type: 'object',
        properties: {
          question_id: { type: 'string', description: 'For example q07.' },
          answer: {
            type: 'string',
            description: 'The answer: the figure or name asked for.',
          },
        },
        required: ['question_id', 'answer'],
      },
    },
    sideEffect: true,
    async run(args, context) {
      await log.record({
        tool: 'save_report',
        args,
        step: context.step,
        taskId: context.taskId,
      });
      return 'Saved to the report.';
    },
  };

  return [webSearch, fetchPage, takeNote, saveReport];
}
