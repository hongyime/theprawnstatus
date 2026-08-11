import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ProbeRecord, Summary, TargetConfig } from '../shared/types';
import { loadTargets } from './lib/config';
import { withDataBranch } from './lib/data-branch';
import { probe } from './lib/probe';
import { shouldWriteGit, shouldWriteSupabase, storageMode } from './lib/storage-mode';
import {
  applyIncrement,
  emptySummary,
  historyShardPath,
  parseJsonl,
  stringifyJsonl,
  utcDay,
} from './lib/summary';
import {
  hasSupabaseWriteConfig,
  readLatestSummaryFromSupabase,
  readProbeRecordsForDayFromSupabase,
  writeUptimeToSupabase,
} from './lib/supabase-store';

const CONCURRENCY = 5;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }

      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

async function readJsonlFile(filePath: string): Promise<ProbeRecord[]> {
  try {
    return parseJsonl(await readFile(filePath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

interface ProbeBatch {
  targets: TargetConfig[];
  now: Date;
  day: string;
  shardPath: string;
  records: ProbeRecord[];
}

async function collectProbeBatch(): Promise<ProbeBatch> {
  const targets = await loadTargets();
  const now = new Date();
  const day = utcDay(now);
  const shardPath = historyShardPath(day);
  const records = await mapWithConcurrency<TargetConfig, ProbeRecord>(
    targets,
    CONCURRENCY,
    async (target) => probe(target),
  );

  return { targets, now, day, shardPath, records };
}

async function writeGitData(batch: ProbeBatch): Promise<void> {
  await withDataBranch(
    {
      commitMessage: `chore(data): uptime ${batch.now.toISOString()}`,
      sparsePaths: ['summary.json', batch.shardPath],
    },
    async ({ dir }) => {
      const absoluteShard = path.join(dir, batch.shardPath);
      const absoluteSummary = path.join(dir, 'summary.json');
      const existingSummary = await readJsonFile<Summary>(absoluteSummary, emptySummary());
      const existingRecords = await readJsonlFile(absoluteShard);
      const allTodayRecords = [...existingRecords, ...batch.records];
      const summary = applyIncrement(
        existingSummary,
        batch.records,
        batch.now,
        batch.targets,
        allTodayRecords,
      );

      await mkdir(path.dirname(absoluteShard), { recursive: true });
      await writeFile(absoluteShard, stringifyJsonl(allTodayRecords), 'utf8');
      await writeFile(absoluteSummary, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    },
  );
}

async function writeSupabaseData(batch: ProbeBatch): Promise<void> {
  if (!hasSupabaseWriteConfig()) {
    throw new Error('Supabase write config is missing');
  }

  const existingSummary = (await readLatestSummaryFromSupabase()) ?? emptySummary();
  const existingRecords = await readProbeRecordsForDayFromSupabase(batch.day);
  const allTodayRecords = [...existingRecords, ...batch.records];
  const summary = applyIncrement(
    existingSummary,
    batch.records,
    batch.now,
    batch.targets,
    allTodayRecords,
  );

  await writeUptimeToSupabase(summary, batch.records, batch.now);
}

async function main(): Promise<void> {
  const mode = storageMode();
  const batch = await collectProbeBatch();

  if (shouldWriteGit(mode)) {
    await writeGitData(batch);
  }

  if (shouldWriteSupabase(mode)) {
    await writeSupabaseData(batch);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
