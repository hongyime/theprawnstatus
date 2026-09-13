import { readFile } from 'node:fs/promises';
import { applyIncrement, rebuild } from './lib/summary';
import type { ProbeRecord, Summary, TargetConfig } from '../shared/types';

const input = JSON.parse(await readFile(process.argv[2], 'utf8')) as {
  targets: TargetConfig[];
  records: ProbeRecord[];
  now: string;
  previous?: Summary;
  affected?: ProbeRecord[];
};
const now = new Date(input.now);
const result =
  input.previous === undefined
    ? rebuild(input.records, input.targets, now)
    : applyIncrement(input.previous, input.affected ?? [], now, input.targets, input.affected);
process.stdout.write(JSON.stringify(result));
