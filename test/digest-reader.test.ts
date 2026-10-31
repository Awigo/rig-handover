import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');

  it('reads 5 jobs sorted by job, with 1 bad line', () => {
    expect(night).not.toBeNull();
    expect(night?.night).toBe('2026-10-28');
    expect(night?.badLines).toBe(1);
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('keeps digest/render with owner null', () => {
    const row = night?.rows.find((r) => r.job === 'digest/render');
    expect(row).toMatchObject({ owner: null, runs: 1, lastStatus: 'ok', lastError: null });
  });

  it('folds retries and keeps the last error after a later ok', () => {
    const row = night?.rows.find((r) => r.job === 'fixtures/refresh');
    expect(row).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('shows the failed backup', () => {
    const row = night?.rows.find((r) => r.job === 'notes/backup');
    expect(row).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded', owner: 'lane-07' });
  });

  it('counts lines per status', () => {
    expect(night?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });
});

describe('readNight edge cases', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null for a night with no file', () => {
    expect(readNight(dir, '2026-01-01')).toBeNull();
  });

  it('returns null for a night that is not YYYY-MM-DD', () => {
    writeFileSync(join(dir, 'x.jsonl'), '');
    expect(readNight(join(dir, 'sub'), '../x')).toBeNull();
    expect(readNight(dir, 'x')).toBeNull();
    expect(readNight(dir, '2026-1-01')).toBeNull();
  });

  it('reads an empty file as no rows and no bad lines', () => {
    writeFileSync(join(dir, '2026-01-02.jsonl'), '');
    expect(readNight(dir, '2026-01-02')).toEqual({
      night: '2026-01-02',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('splits CRLF lines and skips blank ones', () => {
    const lines = [
      '{"at":"2026-01-03T01:00:00+01:00","job":"b","status":"retry","owner":"amy","error":"e1"}',
      '',
      '{"at":"2026-01-03T02:00:00+01:00","job":"a","status":"ok"}',
      '   ',
      '{"at":"2026-01-03T03:00:00+01:00","job":"b","status":"ok","owner":null}',
    ];
    writeFileSync(join(dir, '2026-01-03.jsonl'), lines.join('\r\n') + '\r\n');
    const night = readNight(dir, '2026-01-03');
    expect(night?.badLines).toBe(0);
    expect(night?.counts).toEqual({ ok: 2, retry: 1, fail: 0 });
    expect(night?.rows).toEqual([
      { job: 'a', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
        firstAt: '2026-01-03T02:00:00+01:00', lastAt: '2026-01-03T02:00:00+01:00' },
      { job: 'b', owner: 'amy', runs: 2, retries: 1, lastStatus: 'ok', lastError: 'e1',
        firstAt: '2026-01-03T01:00:00+01:00', lastAt: '2026-01-03T03:00:00+01:00' },
    ]);
  });

  it('counts malformed lines as bad without throwing', () => {
    const lines = [
      'not json',
      '[1,2]',
      'null',
      '{"job":"a","status":"ok"}',
      '{"at":"t","status":"ok"}',
      '{"at":"t","job":"a","status":"done"}',
      '{"at":"t","job":"a","status":"ok","owner":7}',
      '{"at":"t","job":"a","status":"ok","owner":"z"}',
    ];
    writeFileSync(join(dir, '2026-01-04.jsonl'), lines.join('\n'));
    const night = readNight(dir, '2026-01-04');
    expect(night?.badLines).toBe(7);
    expect(night?.rows.map((r) => r.job)).toEqual(['a']);
  });
});
