import { Buffer } from 'node:buffer';
import { setTimeout as sleep } from 'node:timers/promises';

export interface GithubRepo {
  name: string;
  archived: boolean;
  description: string | null;
  topics: string[];
  license: { spdx_id: string | null } | null;
  has_discussions: boolean;
  default_branch: string;
  visibility: string;
}

export interface CommunityProfile {
  files?: {
    code_of_conduct?: unknown;
    contributing?: unknown;
    issue_template?: unknown;
    pull_request_template?: unknown;
    license?: unknown;
    readme?: unknown;
  };
}

export interface RepoFacts extends GithubRepo {
  readmeSize: number | null;
  noticeText: string | null;
  securityPolicyPresent: boolean;
}

interface GithubClientOptions {
  token: string;
  org: string;
  fetchImpl?: typeof fetch;
  delayMs?: number;
}

export class GithubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class GithubClient {
  private readonly fetchImpl: typeof fetch;
  private readonly delayMs: number;

  constructor(private readonly options: GithubClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.delayMs = options.delayMs ?? 150;
  }

  async request<T>(path: string, allow404 = false): Promise<T | null> {
    await sleep(this.delayMs);
    const response = await this.fetchImpl(`https://api.github.com${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.options.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'theprawnstatus/1.0',
      },
    });

    if (response.status === 404 && allow404) {
      return null;
    }

    if (response.status === 401) {
      throw new GithubApiError('PAT invalid or expired', 401);
    }

    if (response.status === 403) {
      throw new GithubApiError('PAT lacks required read permissions or hit a rate limit', 403);
    }

    if (!response.ok) {
      throw new GithubApiError(`GitHub API request failed with ${response.status}`, response.status);
    }

    return (await response.json()) as T;
  }

  async listOrgRepos(): Promise<GithubRepo[]> {
    const repos: GithubRepo[] = [];
    let page = 1;

    for (;;) {
      const current = await this.request<GithubRepo[]>(
        `/orgs/${this.options.org}/repos?per_page=100&type=all&page=${page}`,
      );
      if (current === null || current.length === 0) {
        break;
      }

      repos.push(...current);
      if (current.length < 100) {
        break;
      }

      page += 1;
    }

    return repos;
  }

  async getReadmeSize(repo: string): Promise<number | null> {
    const readme = await this.request<{ size: number }>(
      `/repos/${this.options.org}/${repo}/readme`,
      true,
    );
    return readme?.size ?? null;
  }

  async getContentText(repo: string, filePath: string): Promise<string | null> {
    const content = await this.request<{ content?: string; encoding?: string }>(
      `/repos/${this.options.org}/${repo}/contents/${encodeURIComponent(filePath)}`,
      true,
    );

    if (content?.content === undefined || content.encoding !== 'base64') {
      return null;
    }

    return Buffer.from(content.content, 'base64').toString('utf8');
  }

  async hasSecurityPolicy(repo: string): Promise<boolean> {
    const community = await this.request<CommunityProfile>(
      `/repos/${this.options.org}/${repo}/community/profile`,
      true,
    );

    if (community !== null && 'files' in community) {
      const securityFile = (community.files as Record<string, unknown> | undefined)?.security_policy;
      if (securityFile !== undefined && securityFile !== null) {
        return true;
      }
    }

    const rootPolicy = await this.getContentText(repo, 'SECURITY.md');
    if (rootPolicy !== null) {
      return true;
    }

    return (await this.getContentText(repo, '.github/SECURITY.md')) !== null;
  }
}

export async function fetchOrgRepoFacts(client: GithubClient): Promise<RepoFacts[]> {
  const repos = await client.listOrgRepos();
  const facts: RepoFacts[] = [];

  for (const repo of repos) {
    facts.push({
      ...repo,
      readmeSize: await client.getReadmeSize(repo.name),
      noticeText: await client.getContentText(repo.name, 'NOTICE'),
      securityPolicyPresent: await client.hasSecurityPolicy(repo.name),
    });
  }

  return facts;
}
