import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let cached: string | null = null;

export function buildVersion() {
  if (cached) return cached;
  try {
    cached = readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim();
  } catch {
    cached = 'dev';
  }
  return cached;
}
