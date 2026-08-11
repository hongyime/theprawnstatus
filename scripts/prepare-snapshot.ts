import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  hasSupabaseReadConfig,
  readLatestHealthFromSupabase,
  readLatestSummaryFromSupabase,
} from './lib/supabase-store';

const DATA_BASE = 'https://raw.githubusercontent.com/hongyime/theprawnstatus/data';

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'theprawnstatus-build',
      },
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

async function ensureSnapshot(filePath: string, fallback: unknown): Promise<void> {
  try {
    JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    await writeFile(filePath, `${JSON.stringify(fallback, null, 2)}\n`, 'utf8');
  }
}

async function fetchSupabaseSnapshot(fileName: string): Promise<unknown | null> {
  if (!hasSupabaseReadConfig()) {
    return null;
  }

  try {
    return fileName === 'snapshot.json'
      ? await readLatestSummaryFromSupabase()
      : await readLatestHealthFromSupabase();
  } catch {
    return null;
  }
}

async function writeSnapshot(fileName: string, fallback: unknown): Promise<void> {
  const filePath = path.join('public', fileName);
  const remote =
    (await fetchSupabaseSnapshot(fileName)) ??
    (await fetchJson(
      `${DATA_BASE}/${fileName === 'snapshot.json' ? 'summary.json' : 'health.json'}`,
    ));
  await mkdir(path.dirname(filePath), { recursive: true });

  if (remote === null) {
    await ensureSnapshot(filePath, fallback);
    return;
  }

  await writeFile(filePath, `${JSON.stringify(remote, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  await writeSnapshot('snapshot.json', {
    generated_at: null,
    window_days: 90,
    schema: 1,
    targets: [],
  });
  await writeSnapshot('health-snapshot.json', {
    generated_at: null,
    standard_version: '1.0.0',
    schema: 1,
    org_score: 0,
    repos: [],
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
