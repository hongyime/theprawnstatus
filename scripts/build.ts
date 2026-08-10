import { runCommand } from './lib/data-branch';
import path from 'node:path';

function nodeBin(...parts: string[]): string {
  return path.join(process.cwd(), 'node_modules', ...parts);
}

async function main(): Promise<void> {
  await runCommand(process.execPath, [nodeBin('tsx', 'dist', 'cli.mjs'), 'scripts/prepare-snapshot.ts']);
  await runCommand(process.execPath, [nodeBin('typescript', 'bin', 'tsc'), '--noEmit']);
  await runCommand(process.execPath, [nodeBin('vite', 'bin', 'vite.js'), 'build']);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
