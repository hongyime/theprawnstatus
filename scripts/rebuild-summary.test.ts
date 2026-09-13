import { afterEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  mode: 'supabase',
  raw: { t: '2026-01-01T00:00:00.000Z', id: 'app', s: 200, ms: 100 },
  writeFile: vi.fn().mockResolvedValue(undefined),
  removeFile: vi.fn().mockResolvedValue(undefined),
  writeSummary: vi.fn().mockResolvedValue(undefined),
  prune: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(async () => [{ name: '2026-01-01.jsonl', isFile: () => true }]),
  readFile: vi.fn(async () => `${JSON.stringify(fixture.raw)}\n`),
  writeFile: fixture.writeFile,
  rm: fixture.removeFile,
}));
vi.mock('./lib/config', () => ({
  loadTargets: vi.fn(async () => [{ id: 'app', name: 'App', url: 'https://example.invalid', expect: 200 }]),
}));
vi.mock('./lib/data-branch', () => ({
  withDataBranch: vi.fn(async (_options, action) => action({ dir: 'synthetic-fixture' })),
}));
vi.mock('./lib/storage-mode', () => ({
  storageMode: () => fixture.mode,
  shouldWriteGit: () => fixture.mode === 'git',
  shouldWriteSupabase: () => fixture.mode === 'supabase',
}));
vi.mock('./lib/supabase-store', () => ({
  hasSupabaseWriteConfig: () => true,
  readProbeRecordsSinceFromSupabase: vi.fn(async () => [fixture.raw]),
  writeStatusRunToSupabase: fixture.writeSummary,
  pruneSupabaseSamplesBefore: fixture.prune,
}));

afterEach(() => { vi.useRealTimers(); });

describe('daily rebuild preservation', () => {
  it.each(['supabase', 'git'])('retains historical records in %s beyond the display window', async (mode) => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-13T00:00:00Z'));
    fixture.mode = mode;

    await import('./rebuild-summary');
    await vi.waitFor(() => expect(mode === 'git' ? fixture.writeFile : fixture.writeSummary).toHaveBeenCalled());
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(fixture.removeFile).not.toHaveBeenCalled();
    expect(fixture.prune).not.toHaveBeenCalled();
  });
});
