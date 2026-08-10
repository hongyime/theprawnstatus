import { readFile } from 'node:fs/promises';

import type { JsonValue, StandardConfig, TargetConfig } from '../../shared/types';

const TARGET_ID_PATTERN = /^[a-z0-9-]+$/;
const VALID_SEVERITIES = new Set(['low', 'medium', 'high']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, field: string, errors: string[]): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${field} must be a non-empty string`);
    return null;
  }

  return value;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (isRecord(value)) {
    return Object.values(value).every(isJsonValue);
  }

  return false;
}

export function validateTargets(input: unknown): TargetConfig[] {
  const errors: string[] = [];

  if (!Array.isArray(input)) {
    throw new Error('targets config must be an array');
  }

  const seen = new Set<string>();
  const targets = input.flatMap((raw, index): TargetConfig[] => {
    if (!isRecord(raw)) {
      errors.push(`target[${index}] must be an object`);
      return [];
    }

    const id = readString(raw.id, `target[${index}].id`, errors);
    const name = readString(raw.name, `target[${index}].name`, errors);
    const url = readString(raw.url, `target[${index}].url`, errors);
    const expectedStatus = raw.expect === undefined ? 200 : raw.expect;

    if (id !== null) {
      if (!TARGET_ID_PATTERN.test(id)) {
        errors.push(`target[${index}].id must match ${TARGET_ID_PATTERN.source}`);
      }

      if (seen.has(id)) {
        errors.push(`target[${index}].id duplicates "${id}"`);
      }

      seen.add(id);
    }

    if (url !== null) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') {
          errors.push(`target[${index}].url must use https`);
        }
      } catch {
        errors.push(`target[${index}].url must be an absolute URL`);
      }
    }

    if (
      typeof expectedStatus !== 'number' ||
      !Number.isInteger(expectedStatus) ||
      expectedStatus < 100 ||
      expectedStatus > 599
    ) {
      errors.push(`target[${index}].expect must be an HTTP status code`);
    }

    if (id === null || name === null || url === null || typeof expectedStatus !== 'number') {
      return [];
    }

    return [{ id, name, url, expect: expectedStatus }];
  });

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  return targets;
}

export function validateStandardConfig(input: unknown, knownCheckIds?: Set<string>): StandardConfig {
  const errors: string[] = [];

  if (!isRecord(input)) {
    throw new Error('standard config must be an object');
  }

  const standardVersion = readString(input.standard_version, 'standard_version', errors);
  const source = readString(input.source, 'source', errors);
  const knownDefaultDescription = readString(
    input.known_default_description,
    'known_default_description',
    errors,
  );

  if (!Array.isArray(input.checks)) {
    errors.push('checks must be an array');
  }

  const checkIds = new Set<string>();
  const checks = Array.isArray(input.checks)
    ? input.checks.flatMap((raw, index) => {
        if (!isRecord(raw)) {
          errors.push(`checks[${index}] must be an object`);
          return [];
        }

        const id = readString(raw.id, `checks[${index}].id`, errors);
        const severity = readString(raw.severity, `checks[${index}].severity`, errors);
        const weight = raw.weight;

        if (id !== null) {
          if (checkIds.has(id)) {
            errors.push(`checks[${index}].id duplicates "${id}"`);
          }
          checkIds.add(id);

          if (knownCheckIds !== undefined && !knownCheckIds.has(id)) {
            errors.push(`checks[${index}].id has no module: ${id}`);
          }
        }

        if (severity !== null && !VALID_SEVERITIES.has(severity)) {
          errors.push(`checks[${index}].severity must be low, medium, or high`);
        }

        if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) {
          errors.push(`checks[${index}].weight must be a positive number`);
        }

        let params: Record<string, JsonValue> | undefined;
        if (raw.params !== undefined) {
          if (!isRecord(raw.params) || !isJsonValue(raw.params)) {
            errors.push(`checks[${index}].params must be a JSON object`);
          } else {
            params = raw.params as Record<string, JsonValue>;
          }
        }

        if (id === null || severity === null || typeof weight !== 'number') {
          return [];
        }

        return [{ id, severity: severity as 'low' | 'medium' | 'high', weight, params }];
      })
    : [];

  let exempt: Record<string, string[]> = {};
  if (input.exempt !== undefined) {
    if (!isRecord(input.exempt)) {
      errors.push('exempt must be an object');
    } else {
      exempt = Object.fromEntries(
        Object.entries(input.exempt).flatMap(([repo, values]) => {
          if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
            errors.push(`exempt.${repo} must be an array of check ids`);
            return [];
          }

          return [[repo, values as string[]]];
        }),
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  if (standardVersion === null || source === null || knownDefaultDescription === null) {
    throw new Error('standard config is missing required fields');
  }

  return {
    standard_version: standardVersion,
    source,
    known_default_description: knownDefaultDescription,
    checks,
    exempt,
  };
}

export async function loadTargets(path = 'config/targets.json'): Promise<TargetConfig[]> {
  return validateTargets(JSON.parse(await readFile(path, 'utf8')));
}

export async function loadStandardConfig(
  path = 'config/standard.json',
  knownCheckIds?: Set<string>,
): Promise<StandardConfig> {
  return validateStandardConfig(JSON.parse(await readFile(path, 'utf8')), knownCheckIds);
}
