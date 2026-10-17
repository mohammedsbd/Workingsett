import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  canonicalJson,
  MissingRecordingError,
  recordedTool,
  recordingKey,
  RecordingStore,
} from '../src/tools/recorder.js';
import { researchTools } from '../src/tools/research-tools.js';
import { SideEffectLog } from '../src/tools/side-effect-log.js';
import { supportTools } from '../src/tools/support-tools.js';
import type { Tool } from '../src/tools/types.js';
import {
  REVISION_FROM_QUESTION,
  ResearchWorld,
} from '../src/world/research-world.js';
import { SupportWorld } from '../src/world/support-world.js';

const context = (taskIndex = 1) => ({ taskId: 'q01', taskIndex, step: 1 });
const byName = (tools: Tool[], name: string) =>
  tools.find((t) => t.definition.name === name)!;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'parsim-recordings-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('recorded mode', () => {
  it('should hash arguments regardless of key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,1]},"b":1}',
    );
    expect(recordingKey({ url: 'x', revision: 1 })).toBe(
      recordingKey({ revision: 1, url: 'x' }),
    );
  });

  it('should save a result in record mode and give the same one back in replay mode', async () => {
    const store = new RecordingStore(dir);
    let calls = 0;
    const spec = {
      definition: { name: 'echo', description: 'Echo.', parameters: {} },
      canonical: (args: Record<string, unknown>) => ({ text: args.text }),
      source: (canonical: unknown) => {
        calls += 1;
        return Promise.resolve(`echo ${(canonical as { text: string }).text}`);
      },
    };
    const recorded = await recordedTool(spec, store, 'record').run(
      { text: 'hi' },
      context(),
    );
    const replayed = await recordedTool(spec, store, 'replay').run(
      { text: 'hi' },
      context(),
    );
    expect(replayed).toBe(recorded);
    expect(calls).toBe(1);
    expect(await readdir(path.join(dir, 'echo'))).toEqual([
      `${recordingKey({ text: 'hi' })}.json`,
    ]);

    // Live mode runs the real tool and saves nothing new.
    await recordedTool(spec, store, 'live').run({ text: 'other' }, context());
    expect(await readdir(path.join(dir, 'echo'))).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it('should fail loudly when a recording is missing in replay mode', async () => {
    const tools = researchTools(
      new ResearchWorld(),
      new RecordingStore(dir),
      'replay',
      new SideEffectLog(),
    );
    const error = await byName(tools, 'web_search')
      .run({ query: 'Halvorsen storage' }, context())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MissingRecordingError);
    expect((error as Error).message).toMatch(/No recording for web_search/);
    expect((error as Error).message).toMatch(/npm run record/);
    expect((error as MissingRecordingError).file).toContain(
      path.join(dir, 'web_search'),
    );
  });

  it('should replay the same search for any wording about the same site', async () => {
    const world = new ResearchWorld();
    const store = new RecordingStore(dir);
    const name = world.subject(3).name;
    const record = researchTools(world, store, 'record', new SideEffectLog());
    const replay = researchTools(world, store, 'replay', new SideEffectLog());
    const recorded = await byName(record, 'web_search').run(
      { query: name },
      context(),
    );
    const replayed = await byName(replay, 'web_search').run(
      { query: `capacity of the ${name.toUpperCase()} storage site?` },
      context(),
    );
    expect(replayed).toBe(recorded);
    expect(replayed).toContain(world.siteUrl(world.subject(3)));
  });

  it('should key revised pages by revision, so a late fetch sees the new figure', async () => {
    const world = new ResearchWorld();
    const subject = world.subject(1);
    const tools = researchTools(
      world,
      new RecordingStore(dir),
      'record',
      new SideEffectLog(),
    );
    const fetch = byName(tools, 'fetch_page');
    const early = await fetch.run({ url: world.siteUrl(subject) }, context(1));
    const late = await fetch.run(
      { url: `${world.siteUrl(subject)}/` },
      context(REVISION_FROM_QUESTION),
    );
    expect(early).toContain(`Storage capacity: ${subject.capacityMwh} MWh`);
    expect(late).toContain(
      `Storage capacity: ${subject.revisedCapacityMwh} MWh`,
    );
    expect(await readdir(path.join(dir, 'fetch_page'))).toHaveLength(2);
  });

  it('should map unknown order ids and pages to one recording each', async () => {
    const tools = supportTools(
      new SupportWorld(),
      new RecordingStore(dir),
      'record',
      new SideEffectLog(),
    );
    const lookup = byName(tools, 'lookup_order');
    expect(await lookup.run({ order_id: 'o2003' }, context())).toContain(
      'Order O-2003',
    );
    expect(await lookup.run({ order_id: 'O-9999' }, context())).toBe(
      'No order found with that id.',
    );
    await lookup.run({ order_id: 'Dario Venn' }, context());
    expect(await readdir(path.join(dir, 'lookup_order'))).toHaveLength(2);
  });

  it('should have a committed recording for every tool result the agents can get', async () => {
    const root = path.resolve(import.meta.dirname, '..', 'recordings');
    const research = researchTools(
      new ResearchWorld(),
      new RecordingStore(path.join(root, 'research')),
      'replay',
      new SideEffectLog(),
    );
    const world = new ResearchWorld();
    for (const subject of world.subjects) {
      await byName(research, 'web_search').run(
        { query: subject.name },
        context(),
      );
    }
    for (const url of world.urls()) {
      await byName(research, 'fetch_page').run({ url }, context(1));
      await byName(research, 'fetch_page').run(
        { url },
        context(REVISION_FROM_QUESTION),
      );
    }
    const support = supportTools(
      new SupportWorld(),
      new RecordingStore(path.join(root, 'support')),
      'replay',
      new SideEffectLog(),
    );
    for (const order of new SupportWorld().orders) {
      await byName(support, 'lookup_order').run(
        { order_id: order.id },
        context(),
      );
    }
    await byName(support, 'lookup_order').run({ order_id: 'nope' }, context());
  });
});
