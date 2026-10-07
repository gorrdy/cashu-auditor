import { buildVersion } from '@/lib/version';

export function GET() {
  return Response.json({ version: buildVersion() }, { headers: { 'Cache-Control': 'no-store' } });
}
