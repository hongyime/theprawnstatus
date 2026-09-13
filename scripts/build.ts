import { spawn } from 'node:child_process';
import path from 'node:path';

function nodeBin(...parts: string[]): string {
  return path.join(process.cwd(), 'node_modules', ...parts);
}

async function main(): Promise<void> {
  const steps = [
    [nodeBin('tsx', 'dist', 'cli.mjs'), 'scripts/prepare-snapshot.ts'],
    [nodeBin('typescript', 'bin', 'tsc'), '--noEmit'],
    [nodeBin('vite', 'bin', 'vite.js'), 'build'],
  ];
  for (const args of steps) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true });
      child.once('error', reject);
      child.once('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Build step ${path.basename(args[0])} exited ${code}`));
      });
    });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
