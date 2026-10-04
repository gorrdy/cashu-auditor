import { NextResponse } from 'next/server';
import { authorized } from '@/lib/auth';
import { lockHolder } from '@/lib/lock';

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ wallet: lockHolder() });
}
