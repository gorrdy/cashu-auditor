import { NextResponse } from 'next/server';
import { authorized } from '@/lib/auth';
import { pruneRaw, rollupHours } from '@/lib/maintenance';

let running = false;

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (running) return NextResponse.json({ error: 'Maintenance already running' }, { status: 409 });
  running = true;
  try {
    const rollup = await rollupHours();
    const prune = new URL(request.url).searchParams.get('prune') === '1' ? await pruneRaw() : null;
    return NextResponse.json({ success: true, rollup, prune });
  } finally {
    running = false;
  }
}
