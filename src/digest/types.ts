// Plan morning-digest § 1. The contract the digest page, JSON and board link build against.
export type RunStatus = 'ok' | 'retry' | 'fail';

// One job's night, folded from its log lines. Times are kept exactly as logged (offset included).
export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  // Most recent `error` seen for the job, even if a later run was ok.
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

export type Night = {
  night: string; // YYYY-MM-DD
  rows: DigestRow[]; // sorted by job
  badLines: number; // lines that didn't parse: counted, never thrown
  counts: Record<RunStatus, number>; // per log line, not per job
};

// null: no runs/<night>.jsonl, or `night` isn't a YYYY-MM-DD name.
export type ReadNight = (runsDir: string, night: string) => Night | null;
