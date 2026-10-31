import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

const NORMAL = '2026-01-10';
const EMPTY = '2026-01-11';
const BAD = '2026-01-12';
const MISSING = '2026-01-13';

const line = (at: string, job: string, status: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ at, job, status, owner: 'ops', ...extra });

// File order is deliberately not sorted: the reader sorts by job, and page and JSON must follow it.
const normalNight = [
  line('2026-01-10T01:00:00+01:00', 'zeta/cleanup', 'ok'),
  line('2026-01-10T01:05:00+01:00', 'alpha/sync', 'retry', { error: 'timeout' }),
  line('2026-01-10T01:10:00+01:00', 'alpha/sync', 'retry', { error: 'timeout' }),
  line('2026-01-10T01:15:00+01:00', 'alpha/sync', 'retry', { error: 'timeout' }),
  line('2026-01-10T01:20:00+01:00', 'alpha/sync', 'ok'),
].join('\n');

const badLineNight = [
  line('2026-01-12T01:00:00+01:00', 'alpha/sync', 'ok'),
  'this is not json',
].join('\n');

let runsDir: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-'));
  writeFileSync(join(runsDir, `${NORMAL}.jsonl`), `${normalNight}\n`);
  writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');
  writeFileSync(join(runsDir, `${BAD}.jsonl`), `${badLineNight}\n`);
  app = createApp({ ...config, runsDir });
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

type PageRow = { job: string; tr: string };

// Rows of the page's <tbody>: the text of the first <td> and the opening <tr> tag.
function pageRows(html: string): PageRow[] {
  const body = /<tbody[^>]*>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? '';
  return [...body.matchAll(/(<tr[^>]*>)\s*<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => ({
    tr: m[1] ?? '',
    job: (m[2] ?? '').replace(/<[^>]*>/g, '').trim(),
  }));
}

describe('digest page', () => {
  it('answers 200 and lists the jobs in order, marking the 3-retry row as warn', async () => {
    const res = await app.request(`/digest/${NORMAL}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain(`<h1>digest · ${NORMAL}</h1>`);
    const rows = pageRows(html);
    expect(rows.map((r) => r.job)).toEqual(['alpha/sync', 'zeta/cleanup']);
    expect(rows[0]?.tr).toContain('class="warn"');
    expect(rows[1]?.tr).not.toContain('warn');
  });

  it('answers 404 for a night with no file', async () => {
    const res = await app.request(`/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('no such night');
  });

  it('says "nothing ran" and renders no table for an empty night', async () => {
    const res = await app.request(`/digest/${EMPTY}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<table');
  });

  it('still answers 200 for a night with a bad line and says it could not be read', async () => {
    const res = await app.request(`/digest/${BAD}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('1 line could not be read');
    expect(pageRows(html).map((r) => r.job)).toEqual(['alpha/sync']);
  });
});

describe('digest JSON', () => {
  it('answers 200 with the Night object', async () => {
    const res = await app.request(`/api/digest/${NORMAL}`);
    expect(res.status).toBe(200);
    const night = (await res.json()) as Night;
    expect(night.night).toBe(NORMAL);
    expect(night.badLines).toBe(0);
    expect(night.counts).toEqual({ ok: 2, retry: 3, fail: 0 });
    expect(night.rows.map((r) => r.job)).toEqual(['alpha/sync', 'zeta/cleanup']);
    expect(night.rows[0]?.retries).toBe(3);
  });

  it('answers 404 with an error body for a night with no file', async () => {
    const res = await app.request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no such night' });
  });

  it('has no rows for an empty night', async () => {
    const res = await app.request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    const night = (await res.json()) as Night;
    expect(night.rows).toEqual([]);
  });

  it('counts the bad line and still answers 200', async () => {
    const res = await app.request(`/api/digest/${BAD}`);
    expect(res.status).toBe(200);
    const night = (await res.json()) as Night;
    expect(night.badLines).toBe(1);
  });
});

describe('page and JSON agree', () => {
  it('list the same jobs in the same order', async () => {
    const page = await app.request(`/digest/${NORMAL}`);
    const json = await app.request(`/api/digest/${NORMAL}`);
    const jobs = ((await json.json()) as Night).rows.map((r) => r.job);
    expect(jobs.length).toBeGreaterThan(1);
    expect(pageRows(await page.text()).map((r) => r.job)).toEqual(jobs);
  });
});
