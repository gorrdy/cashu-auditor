import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';

const resolver = new Resolver({ timeout: 4_000, tries: 2 });

function reverseV6(ip: string) {
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t].map(g => g.padStart(4, '0'));
  return groups.join('').split('').reverse().join('.');
}

async function txt(name: string) {
  const records = await resolver.resolveTxt(name);
  return records.map(r => r.join('')).find(Boolean) ?? null;
}

export async function lookupNetwork(host: string, address?: string) {
  const [v4, v6] = await Promise.all([
    isIP(host) === 4 ? [host] : resolver.resolve4(host).catch(() => [] as string[]),
    isIP(host) === 6 ? [host] : resolver.resolve6(host).catch(() => [] as string[]),
  ]);
  const ip = address?.replace(/^::ffff:/, '') ?? v4[0] ?? v6[0] ?? null;
  let asn: number | null = null, asName: string | null = null, country: string | null = null;
  if (ip) {
    const query = isIP(ip) === 4 ? `${ip.split('.').reverse().join('.')}.origin.asn.cymru.com` : `${reverseV6(ip)}.origin6.asn.cymru.com`;
    const origin = await txt(query).catch(() => null);
    const parts = origin?.split('|').map(s => s.trim());
    if (parts?.[0]) {
      asn = Number(parts[0].split(' ')[0]) || null;
      country = parts[2] || null;
      const name = asn ? await txt(`AS${asn}.asn.cymru.com`).catch(() => null) : null;
      asName = name?.split('|').map(s => s.trim())[4]?.slice(0, 120) ?? null;
    }
  }
  return { ip, ipv4: v4.length > 0, ipv6: v6.length > 0, asn, asName, country };
}
