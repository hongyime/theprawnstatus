import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadStandardConfig } from './lib/config';
import { withDataBranch } from './lib/data-branch';
import { evaluateHealth, historyLineFromReport, upsertHealthHistoryLine } from './lib/health';
import { fetchOrgRepoFacts, GithubClient } from './lib/github';
import { knownCheckIds } from './lib/checks';

async function readOptionalFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const token = process.env.HEALTH_PAT;
  if (token === undefined || token.trim() === '') {
    throw new Error('HEALTH_PAT is required for repo health checks');
  }

  if (process.env.GITHUB_ACTIONS === 'true') {
    console.log('::add-mask::' + token);
  }

  const org = process.env.HEALTH_ORG ?? 'hongyime';
  const standard = await loadStandardConfig('config/standard.json', knownCheckIds());
  const client = new GithubClient({ token, org });
  const facts = await fetchOrgRepoFacts(client);
  const now = new Date();
  const report = evaluateHealth(facts, standard, now);
  const historyLine = historyLineFromReport(report, now);

  await withDataBranch({
    commitMessage: `chore(data): health ${now.toISOString()}`,
    sparsePaths: ['health.json', 'health-history.jsonl'],
  }, async ({ dir }) => {
    const healthPath = path.join(dir, 'health.json');
    const historyPath = path.join(dir, 'health-history.jsonl');
    const history = await readOptionalFile(historyPath);

    await writeFile(healthPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await writeFile(historyPath, upsertHealthHistoryLine(history, historyLine), 'utf8');
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
