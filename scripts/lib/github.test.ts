import { describe, expect, it, vi } from 'vitest';

import { fetchOrgRepoFacts, GithubClient } from './github';

const repo = {
  name: 'fixture',
  full_name: 'test/fixture',
  archived: false,
  description: 'fixture',
  homepage: null,
  topics: [],
  license: null,
  has_discussions: false,
  default_branch: 'main',
  visibility: 'public',
};

describe('fetchOrgRepoFacts', () => {
  it('uses the root tree to avoid missing-content requests', async () => {
    const paths: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      if (path === '/orgs/test/repos') return Response.json([repo]);
      if (path === '/repos/test/fixture/git/trees/main') {
        return Response.json({
          tree: [
            { path: 'README.md', type: 'blob', size: 42 },
            { path: 'LICENSE', type: 'blob', size: 7 },
            { path: 'demo.gif', type: 'blob', size: 1 },
            { path: 'nested/NOTICE', type: 'blob', size: 1 },
          ],
        });
      }
      if (path === '/repos/test/fixture/contents/README.md') {
        return Response.json({
          content: Buffer.from('# Fixture').toString('base64'),
          encoding: 'base64',
        });
      }
      if (path === '/repos/test/fixture/contents/LICENSE') {
        return Response.json({
          content: Buffer.from('license').toString('base64'),
          encoding: 'base64',
        });
      }
      return new Response(null, { status: 404 });
    });

    const facts = await fetchOrgRepoFacts(
      new GithubClient({ token: 'token', org: 'test', fetchImpl, delayMs: 0 }),
    );

    expect(facts).toMatchObject([
      {
        readmeSize: 42,
        readmeText: '# Fixture',
        licenseText: 'license',
        noticeText: null,
        rootMediaPresent: true,
      },
    ]);
    expect(paths).not.toContain('/repos/test/fixture/readme');
    expect(paths).not.toContain('/repos/test/fixture/contents/NOTICE');
    expect(paths).not.toContain('/repos/test/fixture/contents/LICENSE.md');
  });
});
