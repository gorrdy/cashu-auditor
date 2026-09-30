import { API_HEADERS, mintList } from '@/lib/api';

const COLUMNS = ['id', 'url', 'name', 'state', 'score', 'uptime24h', 'uptime7d', 'uptime30d', 'latencyMs24h', 'version', 'inputFeePpk', 'units', 'websockets', 'onion', 'minted', 'melted', 'attributedFailures', 'lastCheck'] as const;

function cell(v: unknown) {
  const s = v == null ? '' : Array.isArray(v) ? v.join(' ') : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function GET() {
  const { mints } = await mintList();
  const lines = [COLUMNS.join(',')];
  for (const m of mints) {
    const row = { ...m, ...m.swaps } as Record<string, unknown>;
    lines.push(COLUMNS.map(c => cell(row[c])).join(','));
  }
  return new Response(lines.join('\n') + '\n', {
    headers: { ...API_HEADERS, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'inline; filename="cashu-audit-mints.csv"' },
  });
}
