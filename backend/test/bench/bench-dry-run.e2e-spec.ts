import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestApp, TestApp } from '../utils/test-app';

/**
 * The benchmark's dry run end to end: the demo agent's bench CLI runs both
 * agents over all five arms against its scripted fake upstream, with the
 * Parsim arms going through this in-process Parsim (whose OpenAI upstream
 * is that fake). No real model is called.
 */

/** Each dry run makes hundreds of calls through Parsim. */
const TIMEOUT_MS = 10 * 60_000;

const DEMO_AGENT = path.resolve(__dirname, '..', '..', '..', 'demo-agent');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function runBench(
  args: string[],
  env: Record<string, string>,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', 'src/cli/bench.ts', ...args], {
      cwd: DEMO_AGENT,
      env: { ...process.env, ...env },
      shell: true,
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('close', (code) => resolve({ code, output }));
  });
}

describe('Benchmark dry run (e2e)', () => {
  let t: TestApp;
  let parsimUrl: string;
  let fakePort: number;
  let outDir: string;

  beforeAll(async () => {
    fakePort = await freePort();
    t = await createTestApp({
      PROXY_OPENAI_BASE_URL: `http://127.0.0.1:${fakePort}`,
      // Archive the research pages, so late-recall questions use parsim_recall.
      GC_ARCHIVE_MIN_TOKENS: '400',
      PARSIM_RECALL_MAX_PER_REQUEST: '3',
    });
    await t.reset();
    parsimUrl = await t.listen();
    outDir = await mkdtemp(path.join(tmpdir(), 'parsim-bench-e2e-'));
  });

  afterAll(async () => {
    await t?.close();
    if (outDir) await rm(outDir, { recursive: true, force: true });
  });

  const bench = (agent: string) =>
    runBench(
      [
        '--agent',
        agent,
        '--dry-run',
        '--arms',
        'all',
        '--fake-port',
        String(fakePort),
        '--parsim-url',
        parsimUrl,
        '--out-dir',
        path.join(outDir, agent),
      ],
      {
        BENCH_PARSIM_EMAIL: 'admin@example.com',
        BENCH_PARSIM_PASSWORD: 'secret',
      },
    );

  const report = async (agent: string) => {
    const dir = path.join(outDir, agent);
    const files = await readdir(dir);
    const md = files.find((f) => f.endsWith('.md'))!;
    const json = files.find((f) => f.endsWith('.json'))!;
    return {
      files,
      markdown: await readFile(path.join(dir, md), 'utf8'),
      json: JSON.parse(await readFile(path.join(dir, json), 'utf8')) as {
        results: {
          arm: string;
          tasks: { type: string; passed: boolean; recalls: number }[];
        }[];
        summaries: { arm: string; success: { mean: number } }[];
      },
    };
  };

  it(
    'should run the support agent over all five arms and write a report',
    async () => {
      const { code, output } = await bench('support');
      expect(output).toContain('Report:');
      expect(code).toBe(0);

      const { files, markdown, json } = await report('support');
      expect(files.filter((f) => /\.(md|json|svg)$/.test(f))).toHaveLength(3);
      expect(markdown).toContain('**Dry run**');
      expect(markdown).toMatch(
        /\*\*Parsim on: .* (lower|higher) net cost, success .* for full context\. Truncation: .* (lower|higher) net cost, success .*\*\*/,
      );
      expect(json.results.map((r) => r.arm)).toEqual([
        'full',
        'truncate',
        'summarize',
        'parsim-shadow',
        'parsim-on',
      ]);
      const success = Object.fromEntries(
        json.summaries.map((s) => [s.arm, s.success.mean]),
      );
      // The scripted agent handles every ticket with full context, through
      // Parsim or not; truncation loses the cross-ticket details.
      expect(success.full).toBe(1);
      expect(success['parsim-shadow']).toBe(1);
      expect(success.truncate).toBeLessThan(1);

      // Parsim saw each Parsim arm as one session.
      const sessions: { count: string }[] = await t.dataSource.query(
        `SELECT count(*) AS count FROM agent_session s JOIN project p ON p.id = s."projectId" WHERE p.name LIKE 'Benchmark: parsim-%'`,
      );
      expect(Number(sessions[0].count)).toBe(2);
    },
    TIMEOUT_MS,
  );

  it(
    'should run the research agent over all five arms, with recalls through Parsim',
    async () => {
      const { code, output } = await bench('research');
      expect(output).toContain('Report:');
      expect(code).toBe(0);

      const { json } = await report('research');
      const byArm = Object.fromEntries(json.results.map((r) => [r.arm, r]));
      const late = (arm: string) =>
        byArm[arm].tasks.filter((t) => t.type === 'late_recall');
      // Late-recall answers need the page as first read: full context has it,
      // truncation does not, and Parsim on brings it back with parsim_recall.
      expect(late('full').every((t) => t.passed)).toBe(true);
      expect(late('truncate').some((t) => !t.passed)).toBe(true);
      expect(
        byArm['parsim-on'].tasks.reduce((s, t) => s + t.recalls, 0),
      ).toBeGreaterThan(0);
      expect(late('parsim-on').every((t) => t.passed)).toBe(true);
    },
    TIMEOUT_MS,
  );
});
