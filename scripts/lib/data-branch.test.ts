import { access, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import type { CommandRunner } from './data-branch';
import { withDataBranch } from './data-branch';

describe('withDataBranch', () => {
  it('retries rejected pushes with pull --rebase and cleans up', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'theprawnstatus-'));
    const worktreePath = 'data-wt';
    const worktree = path.join(cwd, worktreePath);
    const commands: string[] = [];
    let pushAttempts = 0;

    const runner: CommandRunner = async (command, args) => {
      commands.push([command, ...args].join(' '));
      if (args[0] === 'clone') {
        await mkdir(args.at(-1) ?? worktree, { recursive: true });
      }

      if (args.includes('status')) {
        return { stdout: 'M summary.json\n', stderr: '' };
      }

      if (args.includes('push')) {
        pushAttempts += 1;
        if (pushAttempts < 3) {
          throw new Error('rejected');
        }
      }

      return { stdout: '', stderr: '' };
    };

    const result = await withDataBranch(
      {
        cwd,
        worktreePath,
        remoteUrl: 'https://example.com/repo.git',
        commitMessage: 'test',
        runner,
        sparsePaths: ['summary.json'],
      },
      async ({ dir }) => {
        await writeFile(path.join(dir, 'summary.json'), '{}\n', 'utf8');
      },
    );

    await expect(access(worktree)).rejects.toThrow();
    expect(result).toMatchObject({ committed: true, pushed: true });
    expect(pushAttempts).toBe(3);
    expect(commands.filter((item) => item.includes('pull --rebase'))).toHaveLength(2);
  });

  it('resets and reapplies the idempotent writer after a rebase conflict', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'theprawnstatus-'));
    const worktreePath = 'data-wt';
    const worktree = path.join(cwd, worktreePath);
    const commands: string[] = [];
    let pushes = 0;
    let writes = 0;
    let rebaseActive = false;

    const runner: CommandRunner = async (command, args) => {
      commands.push([command, ...args].join(' '));
      if (args[0] === 'clone') {
        await mkdir(args.at(-1) ?? worktree, { recursive: true });
      }
      if (args.includes('status')) return { stdout: 'M summary.json\n', stderr: '' };
      if (args.includes('push') && ++pushes === 1) throw new Error('rejected');
      if (args.includes('pull')) {
        rebaseActive = true;
        throw new Error('conflict');
      }
      if (args.includes('rebase') && args.includes('--abort')) rebaseActive = false;
      return { stdout: '', stderr: '' };
    };

    const result = await withDataBranch(
      {
        cwd,
        worktreePath,
        remoteUrl: 'https://example.com/repo.git',
        commitMessage: 'test',
        runner,
        sparsePaths: ['summary.json'],
      },
      async ({ dir }) => {
        writes += 1;
        await writeFile(path.join(dir, 'summary.json'), '{}\n', 'utf8');
      },
    );

    expect(result).toMatchObject({ committed: true, pushed: true });
    expect(pushes).toBe(2);
    expect(writes).toBe(2);
    expect(rebaseActive).toBe(false);
    expect(commands.some((item) => item.includes('rebase --abort'))).toBe(true);
    expect(commands.some((item) => item.includes('fetch origin data'))).toBe(true);
    expect(commands.some((item) => item.includes('reset --hard origin/data'))).toBe(true);
  });
});
