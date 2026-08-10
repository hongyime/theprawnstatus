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

function booleanParam(check: StandardCheckConfig, key: string, fallback: boolean): boolean {
  const value = check.params?.[key];
  return typeof value === 'boolean' ? value : fallback;
}

export const checkModules = {
  license_is_apache_2: ({ repo }: CheckContext) => ({
    pass: repo.license?.spdx_id === 'Apache-2.0',
    detail: repo.license?.spdx_id === 'Apache-2.0' ? undefined : 'wrong or missing license',
  }),

  notice_present: ({ repo, check }: CheckContext) => {
    const organisation = stringParam(check, 'organisation', 'The Prawn Organisation');
    return {
      pass: repo.noticeText !== null && repo.noticeText.includes(organisation),
      detail: repo.noticeText === null ? 'missing required notice' : 'notice has wrong owner',
    };
  },

  description_is_not_default: ({ repo, standard }: CheckContext) => {
    const description = repo.description?.trim() ?? '';
    return {
      pass: description !== '' && description !== standard.known_default_description,
      detail: 'description needs review',
    };
  },

  topics_min_3: ({ repo, check }: CheckContext) => {
    const min = numericParam(check, 'min', 3);
    return {
      pass: repo.topics.length >= min,
      detail: 'not enough topics',
    };
  },

  readme_min_bytes: ({ repo, check }: CheckContext) => {
    const min = numericParam(check, 'min', 500);
    return {
      pass: repo.readmeSize !== null && repo.readmeSize >= min,
      detail: 'readme too small or missing',
    };
  },

  security_policy_present: ({ repo }: CheckContext) => ({
    pass: repo.securityPolicyPresent,
    detail: 'missing security policy',
  }),

  discussions_matches_standard: ({ repo, check }: CheckContext) => {
    const expected = booleanParam(check, 'expected', true);
    return {
      pass: repo.has_discussions === expected,
      detail: 'discussion setting drifted',
    };
  },

  default_branch_matches_standard: ({ repo, check }: CheckContext) => {
    const expected = stringParam(check, 'expected', 'main');
    return {
      pass: repo.default_branch === expected,
      detail: 'default branch drifted',
    };
  },

  not_unintentionally_archived: ({ repo }: CheckContext) => ({
    pass: !repo.archived,
    detail: 'repo is archived',
  }),
} satisfies Record<string, CheckModule>;

export type CheckId = keyof typeof checkModules;

export function knownCheckIds(): Set<string> {
  return new Set(Object.keys(checkModules));
}
