import type { StandardCheckConfig, StandardConfig } from '../../../shared/types';
import type { RepoFacts } from '../github';

export interface CheckContext {
  repo: RepoFacts;
  standard: StandardConfig;
  check: StandardCheckConfig;
}

export interface CheckResult {
  pass: boolean;
  detail?: string;
}

export type CheckModule = (context: CheckContext) => CheckResult;

function numericParam(check: StandardCheckConfig, key: string, fallback: number): number {
  const value = check.params?.[key];
  return typeof value === 'number' ? value : fallback;
}

function stringParam(check: StandardCheckConfig, key: string, fallback: string): string {
  const value = check.params?.[key];
  return typeof value === 'string' ? value : fallback;
}

function stringArrayParam(check: StandardCheckConfig, key: string): string[] {
  const value = check.params?.[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function readmeHasMedia(readme: string | null, rootMediaPresent: boolean): boolean {
  if (rootMediaPresent) {
    return true;
  }

  return /!\[[^\]]*\]\([^)]*\.(?:png|jpe?g|gif|webp)/i.test(readme ?? '');
}

export const checkModules = {
  license_is_full_apache_2: ({ repo }: CheckContext) => {
    const body = repo.licenseText?.toLowerCase() ?? '';
    return {
      pass:
        body.includes('apache license') &&
        body.includes('version 2.0') &&
        body.includes('http://www.apache.org/licenses/') &&
        body.length > 8_000,
      detail: 'missing full Apache-2.0 license text',
    };
  },

  notice_names_organisation: ({ repo, check }: CheckContext) => {
    const noticeText = stringParam(check, 'notice_text', 'Copyright 2026 The Prawn Organisation');
    return {
      pass: repo.noticeText?.trim() === noticeText,
      detail: 'missing required organisation notice',
    };
  },

  description_is_real: ({ repo, standard, check }: CheckContext) => {
    const description = repo.description?.trim() ?? '';
    const max = numericParam(check, 'max', 120);
    return {
      pass: description !== '' && description.length <= max && description !== standard.known_default_description,
      detail: 'description needs review',
    };
  },

  topics_match_vocabulary: ({ repo, check }: CheckContext) => {
    const min = numericParam(check, 'min', 3);
    const reserved = new Set(stringArrayParam(check, 'reserved'));
    const allowed = new Set(stringArrayParam(check, 'allowed'));
    const countedTopics = repo.topics.filter((topic) => !reserved.has(topic));
    return {
      pass: countedTopics.length >= min && repo.topics.every((topic) => allowed.has(topic)),
      detail: 'topics need review',
    };
  },

  readme_meets_standard: ({ repo, check }: CheckContext) => {
    const min = numericParam(check, 'min', 400);
    const body = repo.readmeText ?? '';
    const prose = body
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#') && !line.trimStart().startsWith('[!') && !line.trimStart().startsWith('<!--'));
    return {
      pass:
        repo.readmeSize !== null &&
        repo.readmeSize >= min &&
        /^#\s+\S/m.test(body) &&
        prose.length > 0 &&
        ['setup', 'install', 'getting started', 'usage', 'run'].some((token) =>
          body.toLowerCase().includes(token),
        ),
      detail: 'README missing required structure',
    };
  },

  showcase_meets_standard: ({ repo, check }: CheckContext) => {
    const showcaseRepos = new Set(stringArrayParam(check, 'showcase_repos'));
    if (!showcaseRepos.has(repo.name)) {
      return { pass: true };
    }

    const defaultHomepages = new Set(stringArrayParam(check, 'default_homepages'));
    const homepage = (repo.homepage ?? '').trim();
    const normalisedHomepage = homepage.toLowerCase().replace(/\/$/, '');
    const first30 = (repo.readmeText ?? '').split(/\r?\n/).slice(0, 30).join('\n').toLowerCase();
    return {
      pass:
        homepage !== '' &&
        !defaultHomepages.has(normalisedHomepage) &&
        (first30.includes(normalisedHomepage) || first30.includes('demo') || first30.includes('live')) &&
        readmeHasMedia(repo.readmeText, repo.rootMediaPresent),
      detail: 'showcase metadata incomplete',
    };
  },
} satisfies Record<string, CheckModule>;

export type CheckId = keyof typeof checkModules;

export function knownCheckIds(): Set<string> {
  return new Set(Object.keys(checkModules));
}
