import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const WORKTREE_REMOVE_OPTIONS = {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 100,
} as const;

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<CommandResult>;

export interface DataBranchContext {
  dir: string;
  git: (args: readonly string[]) => Promise<CommandResult>;
}

export interface DataBranchOptions {
  branch?: string;
  commitMessage: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  full?: boolean;
  remoteUrl?: string;
  runner?: CommandRunner;
  sparsePaths?: string[];
  worktreePath?: string;
}

export interface DataBranchResult<T> {
  value: T;
  committed: boolean;
  pushed: boolean;
}

export const runCommand: CommandRunner = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} exited ${code}: ${stderr}`));
      }
    });
  });

function assertWorktreeInsideRoot(root: string, worktree: string): void {
  const relative = path.relative(root, worktree);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`refusing to clean worktree outside cwd: ${worktree}`);
  }
}

async function removeWorktree(worktree: string, failOnError: boolean): Promise<void> {
  try {
    await rm(worktree, WORKTREE_REMOVE_OPTIONS);
  } catch (error) {
    if (failOnError) {
      throw error;
    }

    console.warn(`warning: failed to remove temporary data worktree: ${worktree}`);
  }
}

async function resolveRemoteUrl(
  runner: CommandRunner,
  cwd: string,
  env: NodeJS.ProcessEnv,
  explicit?: string,
): Promise<string> {
  if (explicit !== undefined) {
    return explicit;
  }

  if (env.GITHUB_REPOSITORY !== undefined && env.GITHUB_TOKEN !== undefined) {
    const server = new URL(env.GITHUB_SERVER_URL ?? 'https://github.com');
    return `${server.protocol}//x-access-token:${env.GITHUB_TOKEN}@${server.host}/${env.GITHUB_REPOSITORY}.git`;
  }

  const remote = await runner('git', ['-C', cwd, 'config', '--get', 'remote.origin.url']);
  return remote.stdout.trim();
}

export async function withDataBranch<T>(
  options: DataBranchOptions,
  fn: (context: DataBranchContext) => Promise<T>,
): Promise<DataBranchResult<T>> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const branch = options.branch ?? 'data';
  const env = options.env ?? process.env;
  const runner = options.runner ?? runCommand;
  const worktree = path.resolve(cwd, options.worktreePath ?? `data-wt-${process.pid}-${Date.now()}`);
  const git = (args: readonly string[]) => runner('git', ['-C', worktree, ...args], { env });

  assertWorktreeInsideRoot(cwd, worktree);
  await removeWorktree(worktree, true);
  await mkdir(path.dirname(worktree), { recursive: true });

  try {
    const remoteUrl = await resolveRemoteUrl(runner, cwd, env, options.remoteUrl);
    await runner(
      'git',
      ['clone', '--depth=1', '--filter=blob:none', '--no-checkout', '--branch', branch, remoteUrl, worktree],
      { cwd, env },
    );

    if (options.full !== true) {
      await git(['sparse-checkout', 'init', '--no-cone']);
      await git(['sparse-checkout', 'set', ...(options.sparsePaths ?? [])]);
    }

    await git(['checkout', branch]);
    await git(['config', 'user.name', 'github-actions[bot]']);
    await git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);

    const value = await fn({ dir: worktree, git });

    await git(['add', '-A']);
    const status = await git(['status', '--porcelain']);
    if (status.stdout.trim() === '') {
      return { value, committed: false, pushed: false };
    }

    await git(['commit', '--no-verify', '-m', options.commitMessage]);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await git(['push', 'origin', branch]);
        return { value, committed: true, pushed: true };
      } catch (error) {
        if (attempt === 3) {
          throw error;
        }
        await git(['pull', '--rebase', 'origin', branch]);
      }
    }

    return { value, committed: true, pushed: false };
  } finally {
    await removeWorktree(worktree, false);
  }
}
