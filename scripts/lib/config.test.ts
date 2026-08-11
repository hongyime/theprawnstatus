import { describe, expect, it } from 'vitest';

import { validateStandardConfig, validateTargets } from './config';

describe('validateTargets', () => {
  it('defaults expect to 200', () => {
    expect(
      validateTargets([{ id: 'smuseats', name: 'SMU Seats', url: 'https://smuseats.hong-yi.me' }]),
    ).toEqual([
      { id: 'smuseats', name: 'SMU Seats', url: 'https://smuseats.hong-yi.me', expect: 200 },
    ]);
  });

  it('allows redirect-only targets to stop at the first response', () => {
    expect(
      validateTargets([
        {
          id: 'redirects',
          name: 'Redirects',
          url: 'https://at.example.com',
          expect: 308,
          follow_redirects: false,
        },
      ]),
    ).toEqual([
      {
        id: 'redirects',
        name: 'Redirects',
        url: 'https://at.example.com',
        expect: 308,
        follow_redirects: false,
      },
    ]);
  });

  it('rejects duplicate ids', () => {
    expect(() =>
      validateTargets([
        { id: 'same', name: 'One', url: 'https://one.example.com' },
        { id: 'same', name: 'Two', url: 'https://two.example.com' },
      ]),
    ).toThrow(/duplicates/);
  });

  it('rejects relative URLs', () => {
    expect(() => validateTargets([{ id: 'relative', name: 'Relative', url: '/status' }])).toThrow(
      /absolute URL/,
    );
  });

  it('rejects uppercase ids', () => {
    expect(() =>
      validateTargets([{ id: 'BadId', name: 'Bad Id', url: 'https://bad.example.com' }]),
    ).toThrow(/must match/);
  });
});

describe('validateStandardConfig', () => {
  it('rejects a check id without a module', () => {
    expect(() =>
      validateStandardConfig(
        {
          standard_version: '1.0.0',
          source: 'test',
          known_default_description: 'default',
          checks: [{ id: 'missing', weight: 1, severity: 'high' }],
          exempt: {},
        },
        new Set(['known']),
      ),
    ).toThrow(/no module/);
  });
});
