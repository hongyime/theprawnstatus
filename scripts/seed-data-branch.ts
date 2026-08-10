import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { emptySummary } from './lib/summary';
import { runCommand } from './lib/data-branch';

function assertInside(root: string, child: string): void {
  const relative = path.relative(root, child);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`refusing to use path outside cwd: ${child}`);
  }
}

async function resolveRemote(cwd: string): Promise<string> {
  const result = await runCommand('git', ['-C', cwd, 'config', '--get', 'remote.origin.url']);
  return result.stdout.trim();
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const worktree = path.resolve(cwd, 'data-wt-seed');
  assertInside(cwd, worktree);
  await rm(worktree, { recursive: true, force: true });

  try {
    await runCommand('git', ['clone', '--no-checkout', await resolveRemote(cwd), worktree], { cwd });
    await runCommand('git', ['-C', worktree, 'checkout', '--orphan', 'data']);
    await runCommand('git', ['-C', worktree, 'rm', '-rf', '.']).catch(() =>
      Promise.resolve({ stdout: '', stderr: '' }),
    );

    await mkdir(path.join(worktree, 'history'), { recursive: true });
    await writeFile(
      path.join(worktree, 'README.md'),
      'Machine-written. Do not edit by hand. Do not merge into main.\n',
      'utf8',
    );
    await writeFile(path.join(worktree, 'history', '.gitkeep'), '', 'utf8');
    await writeFile(path.join(worktree, 'summary.json'), `${JSON.stringify(emptySummary(), null, 2)}\n`, 'utf8');
    await writeFile(
      path.join(worktree, 'health.json'),
      `${JSON.stringify(
        {
          generated_at: null,
          standard_version: '1.0.0',
          schema: 1,
          org_score: 0,
          repos: [],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    await writeFile(path.join(worktree, 'health-history.jsonl'), '', 'utf8');

    await runCommand('git', ['-C', worktree, 'config', 'user.name', 'github-actions[bot]']);
    await runCommand('git', [
      '-C',
      worktree,
      'config',
      'user.email',
      '41898282+github-actions[bot]@users.noreply.github.com',
    ]);
    await runCommand('git', ['-C', worktree, 'add', '-A']);
    await runCommand('git', ['-C', worktree, 'commit', '-m', 'chore(data): seed data branch']);
    await runCommand('git', ['-C', worktree, 'push', 'origin', 'data']);
  } finally {
    await rm(worktree, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
