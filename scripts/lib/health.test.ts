import { describe, expect, it } from 'vitest';

import type { StandardConfig } from '../../shared/types';
import type { RepoFacts } from './github';
import { evaluateHealth, historyLineFromReport, upsertHealthHistoryLine } from './health';

const standard: StandardConfig = {
  standard_version: '1.0.0',
  source: 'test',
  known_default_description: 'Give me 1 ⭐ if it\'s cool.',
  checks: [
    { id: 'license_is_full_apache_2', weight: 1, severity: 'high' },
    { id: 'notice_names_organisation', weight: 1, severity: 'high', params: { notice_text: 'Copyright 2026 The Prawn Organisation' } },
    { id: 'description_is_real', weight: 1, severity: 'medium', params: { max: 120 } },
    {
      id: 'topics_match_vocabulary',
      weight: 1,
      severity: 'low',
      params: { min: 3, reserved: ['keep-lfs', 'no-config-sync'], allowed: ['one', 'two', 'three', 'keep-lfs', 'no-config-sync'] },
    },
    { id: 'readme_meets_standard', weight: 1, severity: 'medium', params: { min: 400 } },
    { id: 'showcase_meets_standard', weight: 1, severity: 'medium', params: { showcase_repos: ['passing'], default_homepages: ['', 'https://www.hong-yi.me'] } },
  ],
  exempt: {},
};

const passingRepo: RepoFacts = {
  name: 'passing',
  full_name: 'hongyime/passing',
  archived: false,
  description: 'A real project description.',
  homepage: 'https://passing.hong-yi.me',
  topics: ['one', 'two', 'three'],
  license: { spdx_id: 'Apache-2.0' },
  has_discussions: true,
  default_branch: 'main',
  visibility: 'public',
  licenseText: `Apache License\nVersion 2.0\nhttp://www.apache.org/licenses/\n${'x'.repeat(8_100)}`,
  readmeSize: 600,
  readmeText:
    '# Passing\n\nA real project description.\n\nLive: https://passing.hong-yi.me\n\n## Setup\n\nRun it.\n\n![Screenshot](screenshot.png)\n',
  noticeText: 'Copyright 2026 The Prawn Organisation',
  rootMediaPresent: false,
};

describe('evaluateHealth', () => {
  it('scores passing and failing repos', () => {
    const failingRepo: RepoFacts = {
      ...passingRepo,
      name: 'failing',
      full_name: 'hongyime/failing',
      description: standard.known_default_description,
      homepage: '',
      topics: [],
      license: { spdx_id: 'Apache-2.0' },
      licenseText: 'stub',
      readmeSize: 100,
      readmeText: '# Failing\n',
    };

    const report = evaluateHealth([passingRepo, failingRepo], standard, new Date('2026-08-10T00:00:00.000Z'));
    expect(report.repos.find((repo) => repo.name === 'passing')?.fail).toEqual([]);
    expect(report.repos.find((repo) => repo.name === 'failing')?.fail).toEqual([
      'license_is_full_apache_2',
      'description_is_real',
      'topics_match_vocabulary',
      'readme_meets_standard',
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
