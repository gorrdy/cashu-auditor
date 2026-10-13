import { NextResponse } from 'next/server';
import { SimplePool, type Event } from 'nostr-tools';
import { prisma } from '@/lib/prisma';
import { authorized } from '@/lib/auth';
import { normalizeMintUrl } from '@/lib/mintUrl';
import { mapLimit, probeMint } from '@/lib/probe';
import { publish } from '@/lib/events';
import { findConfirmedAlias } from '@/lib/alias';

const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.8333.space', 'wss://relay.nostr.band'];
const MAX_MINTS = 500;
const MAX_NEW_PER_RUN = 10;
const MAX_UNVOUCHED_PER_RUN = 2;
const MAX_PROBES = 30;
const HOUR = 3_600_000;
const MAX_RETRY = 7 * 24 * HOUR;

const urlsOf = (e: Event) => e.tags.filter(t => t[0] === 'u' && t[1]).map(t => normalizeMintUrl(t[1])).filter((u): u is string => !!u);

function parseReview(content: string) {
  const m = content.match(/^\s*\[(\d)\s*\/\s*5\]\s*/);
  const rating = m ? Number(m[1]) : null;
  return { rating: rating !== null && rating >= 0 && rating <= 5 ? rating : null, text: (m ? content.slice(m[0].length) : content).trim().slice(0, 1000) };
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = new SimplePool();
  try {
    const [announcements, recommendations] = await Promise.all([
      pool.querySync(RELAYS, { kinds: [38172], limit: 1000 }, { maxWait: 12_000 }),
      pool.querySync(RELAYS, { kinds: [38000], '#k': ['38172'], limit: 3000 }, { maxWait: 12_000 }),
    ]);

    const known = new Map((await prisma.mint.findMany({ select: { id: true, url: true } })).map(m => [m.url, m.id]));
    const recommenders = new Map<string, Set<string>>();
    const trusted = new Set(recommendations.filter(e => urlsOf(e).some(u => known.has(u))).map(e => e.pubkey));
    for (const e of recommendations) {
      if (!trusted.has(e.pubkey)) continue;
      for (const u of urlsOf(e)) (recommenders.get(u) ?? recommenders.set(u, new Set()).get(u)!).add(e.pubkey);
    }
    const announced = new Set(announcements.flatMap(urlsOf));
    const urls = new Set<string>([...announced, ...recommendations.flatMap(urlsOf)]);

    const now = Date.now();
    const seen = new Map((await prisma.discoveryCandidate.findMany()).map(c => [c.url, c]));
    const due = (url: string) => {
      const c = seen.get(url);
      return !c?.lastTriedAt || now - c.lastTriedAt.getTime() >= Math.min(MAX_RETRY, HOUR * 2 ** c.failures);
    };
    const vouched = (url: string) => recommenders.get(url)?.size ?? 0;
    const candidates = [...urls]
      .filter(u => !known.has(u) && due(u) && (vouched(u) > 0 || announced.has(u)))
      .sort((a, b) => vouched(b) - vouched(a) || (seen.get(a)?.failures ?? 0) - (seen.get(b)?.failures ?? 0))
      .slice(0, MAX_PROBES);
    const probes = await mapLimit(candidates, 4, async url => ({ url, probe: await probeMint(url) }));
    let added = 0, unvouched = 0, rejected = 0;
    const remember = (url: string, ok: boolean, reason: string | null, aliasOfId: string | null = null) =>
      prisma.discoveryCandidate.upsert({
        where: { url },
        update: { lastTriedAt: new Date(now), failures: ok ? 0 : { increment: 1 }, reason, aliasOfId },
        create: { url, lastTriedAt: new Date(now), failures: ok ? 0 : 1, reason, aliasOfId },
      });
    for (const { url, probe } of probes) {
      if (!probe.info) {
        rejected++;
        await remember(url, false, probe.error?.slice(0, 200) ?? 'No /v1/info');
        continue;
      }
      const alias = await findConfirmedAlias(url, probe.info.pubkey);
      if (alias) {
        await remember(url, false, `Alias of ${alias.url}`, alias.id);
        continue;
      }
      const isVouched = vouched(url) > 0;
      if (!isVouched && (probe.status !== 'online' || unvouched >= MAX_UNVOUCHED_PER_RUN)) {
        await remember(url, false, probe.status !== 'online' ? 'Only announced and not fully online' : 'Only announced, waiting for its turn');
        continue;
      }
      if (added >= MAX_NEW_PER_RUN || known.size >= MAX_MINTS) break;
      const mint = await prisma.mint.create({
        data: { url, source: 'nostr', name: probe.info.name?.slice(0, 120), version: probe.info.version?.slice(0, 60), pubkey: probe.info.pubkey },
      });
      await prisma.discoveryCandidate.deleteMany({ where: { url } });
      known.set(url, mint.id);
      added++;
      if (!isVouched) unvouched++;
    }

    let reviews = 0;
    const latest = new Map<string, Event>();
    for (const e of recommendations) {
      for (const url of urlsOf(e)) {
        const mintId = known.get(url);
        if (!mintId) continue;
        const key = `${mintId}:${e.pubkey}`;
        if ((latest.get(key)?.created_at ?? 0) < e.created_at) latest.set(key, e);
      }
    }
    for (const [key, e] of latest) {
      const mintId = key.split(':')[0];
      const { rating, text } = parseReview(e.content ?? '');
      const createdAt = new Date(e.created_at * 1000);
      const existing = await prisma.mintReview.findUnique({ where: { mintId_author: { mintId, author: e.pubkey } }, select: { createdAt: true } });
      if (existing && existing.createdAt >= createdAt) continue;
      await prisma.mintReview.upsert({
        where: { mintId_author: { mintId, author: e.pubkey } },
        update: { id: e.id, rating, content: text, createdAt },
        create: { id: e.id, mintId, author: e.pubkey, rating, content: text, createdAt },
      });
      reviews++;
    }

    if (added || reviews) publish('mints', { added, reviews });
    return NextResponse.json({
      success: true,
      announcements: announcements.length,
      recommendations: recommendations.length,
      urls: urls.size,
      probed: candidates.length,
      added,
      rejected,
      reviews,
    });
  } catch (error) {
    console.error('Nostr fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch from Nostr' }, { status: 500 });
  } finally {
    pool.close(RELAYS);
  }
}
