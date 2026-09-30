import { timingSafeEqual } from 'node:crypto';

export function authorized(request: Request, secretName: 'CRON_SECRET' | 'PROBE_SECRET' = 'CRON_SECRET'): boolean {
  const secret = process.env[secretName];
  if (!secret) return false;
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
