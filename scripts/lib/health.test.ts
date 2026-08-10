import { describe, expect, it } from 'vitest';

import type { StandardConfig } from '../../shared/types';
import type { RepoFacts } from './github';
import { evaluateHealth, historyLineFromReport, upsertHealthHistoryLine } from './health';

const standard: StandardConfig = {
  standard_version: '1.0.0',
  source: 'test',
  known_default_description: 'Give me 1 ⭐ if it\'s cool.',
  checks: [
    { id: 'license_is_apache_2', weight: 1, severity: 'high' },
    { id: 'notice_present', weight: 1, severity: 'high', params: { organisation: 'The Prawn Organisation' } },
    { id: 'description_is_not_default', weight: 1, severity: 'medium' },
    { id: 'topics_min_3', weight: 1, severity: 'low', params: { min: 3 } },
    { id: 'readme_min_bytes', weight: 1, severity: 'medium', params: { min: 500 } },
    { id: 'security_policy_present', weight: 1, severity: 'high' },
    { id: 'discussions_matches_standard', weight: 1, severity: 'low', params: { expected: true } },
    { id: 'default_branch_matches_standard', weight: 1, severity: 'medium', params: { expected: 'main' } },
    { id: 'not_unintentionally_archived', weight: 1, severity: 'medium' },
  ],
  exempt: {},
};

const passingRepo: RepoFacts = {
  name: 'passing',
  archived: false,
  description: 'A real project description.',
  topics: ['one', 'two', 'three'],
  license: { spdx_id: 'Apache-2.0' },
  has_discussions: true,
  default_branch: 'main',
  visibility: 'public',
  readmeSize: 600,
  noticeText: 'Copyright 2026 The Prawn Organisation',
  securityPolicyPresent: true,
};

describe('evaluateHealth', () => {
  it('scores passing and failing repos', () => {
    const failingRepo: RepoFacts = {
      ...passingRepo,
      name: 'failing',
      description: standard.known_default_description,
      topics: [],
      license: { spdx_id: 'MIT' },
      readmeSize: 100,
      securityPolicyPresent: false,
    };

    const report = evaluateHealth([passingRepo, failingRepo], standard, new Date('2026-08-10T00:00:00.000Z'));
    expect(report.repos.find((repo) => repo.name === 'passing')?.fail).toEqual([]);
    expect(report.repos.find((repo) => repo.name === 'failing')?.fail).toEqual([
      'license_is_apache_2',
      'description_is_not_default',
      'topics_min_3',
      'readme_min_bytes',
      'security_policy_present',
    ]);
  });

  it('builds and upserts one daily history line', () => {
    const report = evaluateHealth([passingRepo], standard, new Date('2026-08-10T00:00:00.000Z'));
    const first = historyLineFromReport(report, new Date('2026-08-10T00:00:00.000Z'));
    const updated = upsertHealthHistoryLine(
      '{"d":"2026-08-09","org_score":0,"repos":1,"compliant":0,"by_check":{}}\n{"d":"2026-08-10","org_score":0,"repos":1,"compliant":0,"by_check":{}}\n',
      first,
    );

    expect(updated.split('\n').filter(Boolean)).toHaveLength(2);
    expect(updated).toContain('"org_score":1');
  });
});
