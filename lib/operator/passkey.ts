import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type AuthenticatorTransportFuture, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { prisma } from '../prisma';
import { SITE_URL } from '../site';
import { consumeChallenge } from './session';
import { identityOf } from './avatar';

const RP_ID = new URL(SITE_URL).hostname;
const ORIGIN = SITE_URL;
const TTL_MS = 5 * 60_000;

async function storeChallenge(challenge: string, kind: string, operatorId?: string) {
  await prisma.loginChallenge.create({ data: { id: challenge, kind, operatorId, expiresAt: new Date(Date.now() + TTL_MS) } });
}

export async function registrationOptions(operatorId: string) {
  const op = await prisma.operator.findUniqueOrThrow({ where: { id: operatorId }, include: { passkeys: { select: { id: true } } } });
  const options = await generateRegistrationOptions({
    rpName: 'Cashu Mints Auditor',
    rpID: RP_ID,
    userName: op.name || identityOf(op),
    userID: new TextEncoder().encode(op.id),
    attestationType: 'none',
    excludeCredentials: op.passkeys.map(p => ({ id: p.id })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });
  await storeChallenge(options.challenge, 'passkey-reg', operatorId);
  return options;
}

export async function registerPasskey(operatorId: string, response: RegistrationResponseJSON, label: string) {
  const v = await verifyRegistrationResponse({
    response,
    expectedChallenge: async c => (await consumeChallenge(c, 'passkey-reg'))?.operatorId === operatorId,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    requireUserVerification: false,
  });
  if (!v.verified) return false;
  const c = v.registrationInfo.credential;
  await prisma.passkey.create({
    data: { id: c.id, operatorId, publicKey: Buffer.from(c.publicKey), counter: c.counter, transports: c.transports ? JSON.stringify(c.transports) : null, label: label.slice(0, 60) || null },
  });
  return true;
}

export async function authenticationOptions() {
  const options = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: 'preferred' });
  await storeChallenge(options.challenge, 'passkey-auth');
  return options;
}

export async function verifyPasskeyLogin(response: AuthenticationResponseJSON) {
  const passkey = await prisma.passkey.findUnique({ where: { id: response.id } });
  if (!passkey) return null;
  const v = await verifyAuthenticationResponse({
    response,
    expectedChallenge: async c => !!(await consumeChallenge(c, 'passkey-auth')),
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    requireUserVerification: false,
    credential: {
      id: passkey.id,
      publicKey: new Uint8Array(passkey.publicKey),
      counter: passkey.counter,
      transports: passkey.transports ? (JSON.parse(passkey.transports) as AuthenticatorTransportFuture[]) : undefined,
    },
  });
  if (!v.verified) return null;
  await prisma.passkey.update({ where: { id: passkey.id }, data: { counter: v.authenticationInfo.newCounter, lastUsedAt: new Date() } });
  return passkey.operatorId;
}
