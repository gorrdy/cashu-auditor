import { prisma } from '../prisma';
import { getOverview } from '../stats';
import { DAY, HOUR } from '../constants';
import { mintPage } from '../site';
import { sendToChannel, type Message } from './channels';

export const EVENTS = {
  offline: 'Mint offline',
  degraded: 'No active sat keyset',
  swapfail: 'Swap failure attributed to the mint',
  stuck: 'Outgoing payment stuck',
  unpaid: 'Payment received but no ecash issued',
  outdated: 'Outdated software',
  tls: 'TLS certificate expires soon',
} as const;
export type EventKey = keyof typeof EVENTS;

export type Prefs = { events: Record<EventKey, boolean>; offlineMinutes: number };
export const DEFAULT_PREFS: Prefs = {
  events: { offline: true, degraded: true, swapfail: true, stuck: true, unpaid: true, outdated: true, tls: true },
  offlineMinutes: 10,
};

export function parsePrefs(raw: string | null): Prefs {
  try {
    const p = raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
    return { events: { ...DEFAULT_PREFS.events, ...(p.events ?? {}) }, offlineMinutes: Math.min(1440, Math.max(5, Number(p.offlineMinutes) || DEFAULT_PREFS.offlineMinutes)) };
  } catch {
    return DEFAULT_PREFS;
  }
}

type Active = { key: string; since: number; detail: string };

const fmtDuration = (ms: number) => (ms >= DAY ? `${Math.round(ms / DAY)} d` : ms >= HOUR ? `${Math.round(ms / HOUR)} h` : `${Math.max(1, Math.round(ms / 60_000))} min`);

async function activeEvents(mintIds: string[], now: number) {
  const { mints } = await getOverview();
  const [extra, stuck, unpaid] = await Promise.all([
    prisma.mint.findMany({ where: { id: { in: mintIds } }, select: { id: true, tlsExpiresAt: true } }),
    prisma.swap.groupBy({ by: ['sourceMintId'], where: { sourceMintId: { in: mintIds }, status: 'pending', stage: 'melt', timestamp: { lt: new Date(now - HOUR) } }, _count: { _all: true }, _min: { timestamp: true } }),
    prisma.swap.groupBy({ by: ['destMintId'], where: { destMintId: { in: mintIds }, stage: 'mint', status: { not: 'success' }, preimageOk: true }, _count: { _all: true }, _sum: { amount: true }, _min: { timestamp: true } }),
  ]);
  const out = new Map<string, Partial<Record<EventKey, Active>>>();
  for (const id of mintIds) {
    const m = mints.find(x => x.id === id);
    if (!m) continue;
    const ev: Partial<Record<EventKey, Active>> = {};
    if (m.latestStatus === 'offline') ev.offline = { key: '', since: m.offlineSince ?? now, detail: m.latestError ? `Last error: ${m.latestError}` : 'The mint does not answer /v1/info.' };
    if (m.latestStatus === 'degraded') ev.degraded = { key: '', since: now, detail: '/v1/info answers but there is no active sat keyset.' };
    if (m.reasons.includes('Recent swap failure attributed to this mint')) ev.swapfail = { key: '', since: now, detail: 'A recent swap failed at this mint. Details are on the mint page.' };
    if (m.versionStatus?.outdated) ev.outdated = { key: m.version ?? '', since: now, detail: `Running ${m.version}; the newest release seen in the audit is ${m.versionStatus.newest}.` };
    const s = stuck.find(x => x.sourceMintId === id);
    if (s) ev.stuck = { key: '', since: s._min.timestamp?.getTime() ?? now, detail: `${s._count._all} outgoing Lightning payment(s) pending for over an hour.` };
    const u = unpaid.find(x => x.destMintId === id);
    if (u) ev.unpaid = { key: String(u._count._all), since: u._min.timestamp?.getTime() ?? now, detail: `${u._sum.amount ?? 0} sat paid to the mint in ${u._count._all} payment(s) with a valid preimage, but no ecash was issued.` };
    const tls = extra.find(x => x.id === id)?.tlsExpiresAt;
    if (tls && tls.getTime() - now < 14 * DAY) ev.tls = { key: tls.toISOString().slice(0, 10), since: now, detail: `The TLS certificate expires on ${tls.toISOString().slice(0, 10)}.` };
    out.set(id, ev);
  }
  return { out, labels: new Map(mints.map(m => [m.id, m.name ?? m.url])) };
}

const RETRY_MS = 30 * 60_000;
const RESOLVABLE = new Set<EventKey>(['offline', 'degraded', 'stuck', 'unpaid', 'swapfail']);

const swapSucceededSince = async (mintId: string, since: Date) =>
  !!(await prisma.swap.findFirst({ where: { status: 'success', timestamp: { gt: since }, OR: [{ sourceMintId: mintId }, { destMintId: mintId }] }, select: { id: true } }));

export async function runNotifications(now = Date.now()) {
  const claims = await prisma.mintClaim.findMany({
    where: { verifiedAt: { not: null }, alerts: true, paidUntil: { gt: new Date(now) } },
    include: { operator: { include: { channels: true } } },
  });
  if (!claims.length) return { sent: 0 };
  const mintIds = [...new Set(claims.map(c => c.mintId))];
  const { out, labels } = await activeEvents(mintIds, now);
  await prisma.notifyState.deleteMany({ where: { mintId: { notIn: mintIds } } });
  const states = await prisma.notifyState.findMany({ where: { mintId: { in: mintIds } } });
  let sent = 0;

  const send = async (claim: (typeof claims)[number], event: EventKey, m: Message) => {
    let ok = false;
    for (const ch of claim.operator.channels) {
      const r = await sendToChannel(ch, m);
      await prisma.notifyLog.create({ data: { claimId: claim.id, channelId: ch.id, event, ok: r.ok, error: r.ok ? null : r.error } });
      if (r.ok) sent++;
      ok ||= r.ok;
    }
    return ok;
  };
  const logsSince = (claimId: string, event: EventKey, since: Date) =>
    prisma.notifyLog.findMany({ where: { claimId, event, timestamp: { gte: since } }, select: { ok: true, timestamp: true }, orderBy: { timestamp: 'desc' } });

  for (const mintId of mintIds) {
    const active = out.get(mintId) ?? {};
    const name = labels.get(mintId) ?? mintId;
    const mintClaims = claims.filter(c => c.mintId === mintId);
    for (const event of Object.keys(EVENTS) as EventKey[]) {
      const a = active[event];
      let st = states.find(s => s.mintId === mintId && s.event === event);
      if (a && (!st || st.key !== a.key)) {
        const since = new Date(st ? now : a.since);
        st = await prisma.notifyState.upsert({
          where: { mintId_event: { mintId, event } },
          update: { key: a.key, since, notifiedAt: null },
          create: { mintId, event, key: a.key, since },
        });
      }
      if (a && st) {
        let delivered = false;
        for (const claim of mintClaims) {
          const prefs = parsePrefs(claim.prefs);
          if (!prefs.events[event]) continue;
          const delay = event === 'offline' || event === 'degraded' ? prefs.offlineMinutes * 60_000 : 0;
          if (now - st.since.getTime() < delay) continue;
          const logs = await logsSince(claim.id, event, st.since);
          if (logs.some(l => l.ok) || (logs[0] && now - logs[0].timestamp.getTime() < RETRY_MS)) continue;
          if (await send(claim, event, { title: `${EVENTS[event]}: ${name}`, body: a.detail, url: mintPage(mintId) })) delivered = true;
        }
        if (delivered && !st.notifiedAt) await prisma.notifyState.update({ where: { mintId_event: { mintId, event } }, data: { notifiedAt: new Date(now) } });
      }
      if (!a && st) {
        if (event === 'swapfail' && st.notifiedAt && !(await swapSucceededSince(mintId, st.notifiedAt))) continue;
        if (RESOLVABLE.has(event)) {
          for (const claim of mintClaims) {
            if (!(await logsSince(claim.id, event, st.since)).some(l => l.ok)) continue;
            await send(claim, event, { title: `Resolved: ${name}`, body: `${EVENTS[event]} is over after ${fmtDuration(now - st.since.getTime())}.`, url: mintPage(mintId) });
          }
        }
        await prisma.notifyState.delete({ where: { mintId_event: { mintId, event } } });
      }
    }
  }
  return { sent };
}

export async function sendTest(operatorId: string) {
  const channels = await prisma.notifyChannel.findMany({ where: { operatorId } });
  const results = [];
  for (const ch of channels) results.push({ kind: ch.kind, ...(await sendToChannel(ch, { title: 'Cashu Mints Auditor', body: 'Test notification. Alerts for your mints will arrive like this.', url: 'https://cashu.info/operators' })) });
  return results;
}
