import { writeFile } from 'node:fs/promises';

import { runCommand } from './lib/data-branch';

async function main(): Promise<void> {
  await writeFile('.keepalive', `${new Date().toISOString()}\n`, 'utf8');
  await runCommand('git', ['config', 'user.name', 'github-actions[bot]']);
  await runCommand('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  await runCommand('git', ['add', '-f', '.keepalive']);

  const status = await runCommand('git', ['status', '--porcelain', '--', '.keepalive']);
  if (status.stdout.trim() === '') {
    return;
  }

  await runCommand('git', ['commit', '--no-verify', '-m', 'chore: keepalive']);
  await runCommand('git', ['push', 'origin', 'HEAD:main']);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
