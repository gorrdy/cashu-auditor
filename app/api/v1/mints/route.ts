import { json, mintList } from '@/lib/api';

export async function GET() {
  return json(await mintList());
}
