export type ParsedVersion = { impl: string; parts: number[]; prerelease: boolean };

export function parseVersion(version: string | null | undefined): ParsedVersion | null {
  const m = version?.trim().match(/^([A-Za-z][\w.-]*?)\/v?(\d+)\.(\d+)(?:\.(\d+))?(?:\.(\d+))?(-[\w.]+)?/);
  if (!m) return null;
  return { impl: m[1], parts: [m[2], m[3], m[4] ?? '0', m[5] ?? '0'].map(Number), prerelease: !!m[6] };
}

const compare = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
};

export function newestVersions(versions: (string | null)[]) {
  const best = new Map<string, { parts: number[]; label: string; count: number }>();
  for (const v of versions) {
    const p = parseVersion(v);
    if (!p || p.prerelease) continue;
    const cur = best.get(p.impl);
    if (!cur) best.set(p.impl, { parts: p.parts, label: v!.split('/')[1], count: 1 });
    else {
      cur.count++;
      if (compare(p.parts, cur.parts) > 0) Object.assign(cur, { parts: p.parts, label: v!.split('/')[1] });
    }
  }
  return best;
}

export function versionStatus(version: string | null | undefined, newest: ReturnType<typeof newestVersions>) {
  const p = parseVersion(version);
  const top = p && newest.get(p.impl);
  if (!p || !top || top.count < 2) return null;
  const behind = p.parts[0] < top.parts[0] ? Infinity : p.parts[0] === top.parts[0] ? top.parts[1] - p.parts[1] : 0;
  return { outdated: behind >= 2, newest: `${p.impl}/${top.label}`, behind };
}
