import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authorized } from '@/lib/auth';
import { hasInternet, mapLimit, probeMint, type ProbeResult } from '@/lib/probe';
import { fetchIcon } from '@/lib/icons';
import { lookupNetwork } from '@/lib/netinfo';
import { looksLikeTestMint } from '@/lib/testMint';
import { publish } from '@/lib/events';
import { DAY } from '@/lib/constants';
import { runNotifications } from '@/lib/notify/events';

const ICON_MAX_AGE_MS = DAY;
const NET_MAX_AGE_MS = DAY;

type MintRow = Awaited<ReturnType<typeof loadMints>>[number];

const loadMints = () => prisma.mint.findMany({ omit: { iconData: true } });

function iconUrlOf(value: unknown) {
  return typeof value === 'string' && value.startsWith('https://') && value.length < 500 ? value : null;
}

const TRACKED = ['version', 'pubkey', 'activeKeysetId', 'inputFeePpk', 'motd', 'mintDisabled', 'meltDisabled'] as const;

function snapshot(mint: MintRow, r: ProbeResult) {
  const info = r.info!;
  const spec = r.spec!;
  return {
    name: typeof info.name === 'string' ? info.name.slice(0, 120) : mint.name,
    version: typeof info.version === 'string' ? info.version.slice(0, 60) : mint.version,
    pubkey: typeof info.pubkey === 'string' ? info.pubkey.slice(0, 80) : mint.pubkey,
    description: typeof info.description === 'string' ? info.description.slice(0, 500) : mint.description,
    iconUrl: iconUrlOf(info.icon_url),
    nuts: info.nuts ? JSON.stringify(Object.keys(info.nuts).slice(0, 60)) : mint.nuts,
    contact: JSON.stringify(spec.contact),
    motd: spec.motd,
    tosUrl: spec.tosUrl,
    onionUrl: spec.onionUrl,
    methods: JSON.stringify(spec.methods),
    units: JSON.stringify(spec.units),
    mintDisabled: spec.mintDisabled,
    meltDisabled: spec.meltDisabled,
    authRequired: spec.authRequired,
    websockets: spec.websockets,
    cachedResponses: spec.cachedResponses,
    batchMax: spec.batchMax,
    maxArrayLength: spec.maxArrayLength,
    clockSkewMs: r.clockSkewMs ?? null,
    isTest: looksLikeTestMint({ url: mint.url, name: typeof info.name === 'string' ? info.name : null, description: typeof info.description === 'string' ? info.description : null }),
    ...(r.keysets ? { inputFeePpk: r.keysets.inputFeePpk, activeKeysetId: r.keysets.activeId, keysetCount: r.keysets.count } : {}),
    ...(r.cert ? { tlsIssuer: r.cert.issuer, tlsExpiresAt: r.cert.validTo ? new Date(r.cert.validTo) : null } : {}),
  };
}

let running = false;

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (running) return NextResponse.json({ error: 'Audit already running' }, { status: 409 });
  running = true;
  try {
    return await audit();
  } finally {
    running = false;
  }
}

async function audit() {
  const mints = await loadMints();
  const timestamp = new Date();
  const results = await mapLimit(mints, 8, async mint => ({ mint, result: await probeMint(mint.url) }));
  const retry = results.filter(r => r.result.status === 'offline' && !r.mint.offlineSince);
  if (retry.length && retry.length < results.length / 2) {
    await new Promise(r => setTimeout(r, 2000));
    await mapLimit(retry, 8, async r => {
      const again = await probeMint(r.mint.url);
      if (again.status !== 'offline') r.result = again;
    });
  }

  const up = results.filter(r => r.result.status !== 'offline').length;
  if (mints.length >= 5 && up / mints.length < 0.2 && !(await hasInternet())) {
    return NextResponse.json({ error: 'Auditor has no internet, results discarded' }, { status: 503 });
  }

  let events = 0;
  await prisma.$transaction(
    async tx => {
      for (const { mint, result } of results) {
        if (result.info && result.spec) {
          const data = snapshot(mint, result);
          for (const key of TRACKED) {
            const before = mint[key];
            const after = data[key as keyof typeof data];
            if (after === undefined || before === null || before === undefined || String(before) === String(after)) continue;
            await tx.mintEvent.create({
              data: { mintId: mint.id, kind: key, previous: String(before).slice(0, 300), value: after === null ? null : String(after).slice(0, 300), timestamp },
            });
            events++;
          }
          await tx.mint.update({ where: { id: mint.id }, data: { ...data, ...(mint.offlineSince ? { offlineSince: null } : {}) } });
        } else if (result.cert) {
          await tx.mint.update({
            where: { id: mint.id },
            data: { tlsIssuer: result.cert.issuer, tlsExpiresAt: result.cert.validTo ? new Date(result.cert.validTo) : null },
          });
        }
        await tx.auditLog.create({
          data: {
            mintId: mint.id,
            location: 'prague',
            status: result.status,
            latency: result.latency,
            keysetsMs: result.keysetsMs,
            httpStatus: result.httpStatus,
            dnsMs: result.timings?.dnsMs,
            connectMs: result.timings?.connectMs,
            tlsMs: result.timings?.tlsMs,
            ttfbMs: result.timings?.ttfbMs,
            clockSkewMs: result.clockSkewMs,
            version: typeof result.info?.version === 'string' ? result.info.version.slice(0, 60) : null,
            error: result.error?.slice(0, 300),
            timestamp,
          },
        });
      }
    },
    { timeout: 30_000 }
  );

  const staleNet = results.filter(({ mint, result }) =>
    result.status !== 'offline' && (!mint.netCheckedAt || timestamp.getTime() - mint.netCheckedAt.getTime() > NET_MAX_AGE_MS)
  );
  await mapLimit(staleNet, 4, async ({ mint, result }) => {
    const net = await lookupNetwork(new URL(mint.url).hostname, result.address).catch(() => null);
    if (net) await prisma.mint.update({ where: { id: mint.id }, data: { ...net, netCheckedAt: timestamp } });
  });

  const icons = await mapLimit(
    results.filter(({ mint, result }) => {
      const url = iconUrlOf(result.info?.icon_url);
      if (!result.info) return false;
      if (url !== mint.iconUrl) return true;
      return !!url && (!mint.iconFetchedAt || timestamp.getTime() - mint.iconFetchedAt.getTime() > ICON_MAX_AGE_MS);
    }),
    4,
    async ({ mint, result }) => {
      const url = iconUrlOf(result.info?.icon_url);
      if (!url) {
        await prisma.mint.update({ where: { id: mint.id }, data: { iconData: null, iconType: null, iconHash: null, iconFetchedAt: timestamp } });
        return 'cleared';
      }
      try {
        const icon = await fetchIcon(url);
        await prisma.mint.update({ where: { id: mint.id }, data: { iconData: icon.data, iconType: icon.type, iconHash: icon.hash, iconFetchedAt: timestamp } });
        return 'stored';
      } catch {
        await prisma.mint.update({
          where: { id: mint.id },
          data: url === mint.iconUrl ? { iconFetchedAt: timestamp } : { iconData: null, iconType: null, iconHash: null, iconFetchedAt: timestamp },
        });
        return 'failed';
      }
    }
  );

  publish('audit', { location: 'prague', online: up });
  const notified = await runNotifications().catch(error => {
    console.error('runNotifications failed:', error);
    return null;
  });
  return NextResponse.json({
    success: true,
    notified: notified?.sent ?? 0,
    audited: mints.length,
    online: results.filter(r => r.result.status === 'online').length,
    degraded: results.filter(r => r.result.status === 'degraded').length,
    offline: results.filter(r => r.result.status === 'offline').length,
    events,
    network: staleNet.length,
    icons: { stored: icons.filter(i => i === 'stored').length, failed: icons.filter(i => i === 'failed').length },
  });
}
