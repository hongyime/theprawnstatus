import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { HealthHistoryLine, HealthReport, ProbeRecord, Summary } from '../shared/types';
import { loadTargets } from './lib/config';
import { withDataBranch } from './lib/data-branch';
import { historyLineFromReport } from './lib/health';
import { parseJsonl, rebuild } from './lib/summary';
import {
  hasSupabaseWriteConfig,
  writeHealthHistoryToSupabase,
  writeHealthReportToSupabase,
  writeProbeRecordsToSupabase,
  writeStatusRunToSupabase,
} from './lib/supabase-store';

async function readHistoryRecords(historyDir: string): Promise<ProbeRecord[]> {
  try {
    const entries = await readdir(historyDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry.name))
      .map((entry) => entry.name);
    const shards = await Promise.all(
      files.map((file) => readFile(path.join(historyDir, file), 'utf8')),
    );

    return shards.flatMap((content) => parseJsonl(content));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function readOptionalJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function readOptionalHealthHistory(filePath: string): Promise<HealthHistoryLine[]> {
  try {
    const content = await readFile(filePath, 'utf8');
    return content
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as HealthHistoryLine);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function main(): Promise<void> {
  if (!hasSupabaseWriteConfig()) {
    throw new Error('Supabase write config is missing');
  }

  const targets = await loadTargets();
  const now = new Date();

  await withDataBranch(
    {
      commitMessage: 'chore(data): import source read',
      full: true,
    },
    async ({ dir }) => {
      const records = await readHistoryRecords(path.join(dir, 'history'));
      const summary =
        (await readOptionalJson<Summary>(path.join(dir, 'summary.json'))) ??
        rebuild(records, targets, now);
      const generatedAt = summary.generated_at === null ? now : new Date(summary.generated_at);
      const health = await readOptionalJson<HealthReport>(path.join(dir, 'health.json'));
      const healthHistory = await readOptionalHealthHistory(path.join(dir, 'health-history.jsonl'));

      await writeProbeRecordsToSupabase(records);
      await writeStatusRunToSupabase(summary, generatedAt);

      if (health !== null && health.generated_at !== null) {
        await writeHealthReportToSupabase(health);
        await writeHealthHistoryToSupabase(
          healthHistory.length === 0
            ? [historyLineFromReport(health, new Date(health.generated_at))]
            : healthHistory,
        );
      }
    },
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
