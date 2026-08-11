import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ProbeRecord } from '../shared/types';
import { loadTargets } from './lib/config';
import { withDataBranch } from './lib/data-branch';
import { shouldWriteGit, shouldWriteSupabase, storageMode } from './lib/storage-mode';
import { isExpiredShard, parseJsonl, rebuild } from './lib/summary';
import {
  hasSupabaseWriteConfig,
  pruneSupabaseSamplesBefore,
  readProbeRecordsSinceFromSupabase,
  writeStatusRunToSupabase,
} from './lib/supabase-store';

const SUPABASE_RETENTION_DAYS = 91;

async function readHistoryRecords(
  historyDir: string,
): Promise<Array<{ file: string; records: ProbeRecord[] }>> {
  try {
    const entries = await readdir(historyDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry.name))
      .map((entry) => entry.name);

    return Promise.all(
      files.map(async (file) => ({
        file: `history/${file}`,
        records: parseJsonl(await readFile(path.join(historyDir, file), 'utf8')),
      })),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const mode = storageMode();
  const targets = await loadTargets();
  const now = new Date();

  if (shouldWriteGit(mode)) {
    await withDataBranch(
      {
        commitMessage: 'chore(data): daily rebuild + prune',
        full: true,
      },
      async ({ dir }) => {
        const history = await readHistoryRecords(path.join(dir, 'history'));
        const records = history.flatMap((item) => item.records);
        const summary = rebuild(records, targets, now);

        await writeFile(
          path.join(dir, 'summary.json'),
          `${JSON.stringify(summary, null, 2)}\n`,
          'utf8',
        );

        await Promise.all(
          history
            .filter((item) => isExpiredShard(item.file, now))
            .map((item) => rm(path.join(dir, item.file), { force: true })),
        );
      },
    );
  }

  if (shouldWriteSupabase(mode)) {
    if (!hasSupabaseWriteConfig()) {
      throw new Error('Supabase write config is missing');
    }

    const cutoff = new Date(now.getTime() - SUPABASE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const records = await readProbeRecordsSinceFromSupabase(cutoff);
    const summary = rebuild(records, targets, now);

    await writeStatusRunToSupabase(summary, now);
    await pruneSupabaseSamplesBefore(cutoff);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
