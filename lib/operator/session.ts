import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { prisma } from '../prisma';
import { DAY } from '../constants';

const COOKIE = 'op_session';
const TTL_MS = 30 * DAY;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export const randomToken = (bytes = 24) => randomBytes(bytes).toString('base64url');

export async function createSession(operatorId: string) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + TTL_MS);
  await prisma.operatorSession.create({ data: { id: hash(token), operatorId, expiresAt } });
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', expires: expiresAt });
}

export async function currentOperator() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.operatorSession.findUnique({ where: { id: hash(token) }, include: { operator: true } });
  if (!session || session.expiresAt.getTime() < Date.now()) return null;
  return session.operator;
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) await prisma.operatorSession.deleteMany({ where: { id: hash(token) } });
  store.delete(COOKIE);
}

export async function createChallenge(kind: string, data: { email?: string; operatorId?: string; claimId?: string } = {}, ttlMs = 10 * 60_000) {
  const id = randomToken();
  await prisma.loginChallenge.create({ data: { id, kind, ...data, expiresAt: new Date(Date.now() + ttlMs) } });
  return id;
}

export async function consumeChallenge(id: string, kind: string) {
  const row = await prisma.loginChallenge.findUnique({ where: { id } });
  if (!row || row.kind !== kind || row.usedAt || row.expiresAt.getTime() < Date.now()) return null;
  const { count } = await prisma.loginChallenge.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date() } });
  return count ? row : null;
}
