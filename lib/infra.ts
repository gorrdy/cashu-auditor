import { prisma } from './prisma';
import { getOverview, type MintState } from './stats';
import { parseVersion } from './versions';
import type { GraphNode, LnNode } from './lnnode';

export type InfraMint = { id: string; label: string; url: string; state: MintState };
export type Bucket = { key: string; mints: InfraMint[] };

const label = (m: { name: string | null; url: string }) => m.name ?? m.url.replace(/^https:\/\//, '');

function buckets(entries: [string | null | undefined, InfraMint][]) {
  const map = new Map<string, InfraMint[]>();
  for (const [key, mint] of entries) {
    if (!key) continue;
    const list = map.get(key) ?? [];
    if (!list.some(m => m.id === mint.id)) list.push(mint);
    map.set(key, list);
  }
  return [...map.entries()].map(([key, mints]) => ({ key, mints })).sort((a, b) => b.mints.length - a.mints.length || a.key.localeCompare(b.key));
}

export async function getInfrastructure() {
  const { mints } = await getOverview();
  const active = mints.filter(m => !m.longOffline && !m.isTest);
  const extra = new Map(
    (await prisma.mint.findMany({
      where: { id: { in: active.map(m => m.id) } },
      select: { id: true, asName: true, country: true, lnPubkey: true, lnNode: true },
    })).map(m => [m.id, m])
  );
  const rows = active.map(m => {
    const x = extra.get(m.id);
    const ln = x?.lnNode ? (JSON.parse(x.lnNode) as LnNode) : null;
    return { mint: { id: m.id, label: label(m), url: m.url, state: m.state } as InfraMint, m, x, ln };
  });

  const nodes = new Map<string, { node: GraphNode; via: LnNode['via']; mints: InfraMint[] }>();
  for (const r of rows) {
    if (!r.ln || !r.x?.lnPubkey) continue;
    const g = nodes.get(r.x.lnPubkey) ?? { node: r.ln.node, via: r.ln.via, mints: [] };
    g.mints.push(r.mint);
    nodes.set(r.x.lnPubkey, g);
  }
  const sharedNodes = [...nodes.values()].filter(g => g.mints.length > 1).sort((a, b) => b.mints.length - a.mints.length);

  const software = new Map<string, { version: string; mints: InfraMint[]; outdated: boolean }[]>();
  for (const r of rows) {
    const p = parseVersion(r.m.version);
    if (!p) continue;
    const list = software.get(p.impl) ?? [];
    const version = r.m.version!.split('/')[1];
    const entry = list.find(e => e.version === version) ?? (list.push({ version, mints: [], outdated: !!r.m.versionStatus?.outdated }), list[list.length - 1]);
    entry.mints.push(r.mint);
    software.set(p.impl, list);
  }

  return {
    total: rows.length,
    withNode: rows.filter(r => r.ln).length,
    distinctNodes: nodes.size,
    sharedNodes,
    sharingMints: sharedNodes.reduce((n, g) => n + g.mints.length, 0),
    webHosting: buckets(rows.map(r => [r.x?.asName, r.mint])),
    nodeHosting: buckets(rows.map(r => [r.ln?.node.public ? r.ln.node.hosting : null, r.mint])),
    liquidity: buckets(rows.flatMap(r => (r.ln?.via ?? []).filter(v => v.public).map(v => [v.alias ?? v.pubkey.slice(0, 12), r.mint] as [string, InfraMint]))),
    countries: buckets(rows.map(r => [r.x?.country, r.mint])),
    software: [...software.entries()]
      .map(([impl, versions]) => ({ impl, versions: versions.sort((a, b) => b.mints.length - a.mints.length), count: versions.reduce((n, v) => n + v.mints.length, 0) }))
      .sort((a, b) => b.count - a.count),
    outdated: rows.filter(r => r.m.versionStatus?.outdated).length,
  };
}
