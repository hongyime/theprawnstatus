import { Buffer } from 'node:buffer';
import { setTimeout as sleep } from 'node:timers/promises';

export interface GithubRepo {
  name: string;
  full_name: string;
  archived: boolean;
  description: string | null;
  homepage: string | null;
  topics: string[];
  license: { spdx_id: string | null } | null;
  has_discussions: boolean;
  default_branch: string;
  visibility: string;
}

export interface RepoFacts extends GithubRepo {
  licenseText: string | null;
  readmeSize: number | null;
  readmeText: string | null;
  noticeText: string | null;
  rootMediaPresent: boolean;
}

interface GithubClientOptions {
  token: string;
  org: string;
  fetchImpl?: typeof fetch;
  delayMs?: number;
  timeoutMs?: number;
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
  private readonly timeoutMs: number;

  constructor(private readonly options: GithubClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.delayMs = options.delayMs ?? 25;
    this.timeoutMs = options.timeoutMs ?? 20_000;
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
      signal: AbortSignal.timeout(this.timeoutMs),
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

  async getReadme(repo: string): Promise<{ size: number; text: string | null } | null> {
    const readme = await this.request<{ size: number; content?: string; encoding?: string }>(
      `/repos/${this.options.org}/${repo}/readme`,
      true,
    );
    if (readme === null) {
      return null;
    }

    return {
      size: readme.size,
      text:
        readme.content !== undefined && readme.encoding === 'base64'
          ? Buffer.from(readme.content, 'base64').toString('utf8')
          : null,
    };
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

  async getFirstContentText(repo: string, paths: string[]): Promise<string | null> {
    for (const filePath of paths) {
      const text = await this.getContentText(repo, filePath);
      if (text !== null) {
        return text;
      }
    }

    return null;
  }

  async hasAnyContent(repo: string, paths: string[]): Promise<boolean> {
    for (const filePath of paths) {
      const content = await this.request<unknown>(
        `/repos/${this.options.org}/${repo}/contents/${encodeURIComponent(filePath)}`,
        true,
      );
      if (content !== null) {
        return true;
      }
    }

    return false;
  }
}

export async function fetchOrgRepoFacts(client: GithubClient): Promise<RepoFacts[]> {
  const repos = await client.listOrgRepos();
  const facts: RepoFacts[] = [];

  for (const repo of repos) {
    const readme = await client.getReadme(repo.name);
    facts.push({
      ...repo,
      licenseText: await client.getFirstContentText(repo.name, [
        'LICENSE',
        'LICENSE.md',
        'LICENCE',
        'LICENCE.md',
      ]),
      readmeSize: readme?.size ?? null,
      readmeText: readme?.text ?? null,
      noticeText: await client.getContentText(repo.name, 'NOTICE'),
      rootMediaPresent: await client.hasAnyContent(repo.name, [
        'screenshot.png',
        'screenshot.jpg',
        'screenshot.jpeg',
        'screenshot.webp',
        'demo.gif',
      ]),
    });
  }

  return facts;
}
