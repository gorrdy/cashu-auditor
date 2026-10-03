export type LayoutLink = { a: string; b: string; weight: number };
export type Point = { x: number; y: number };

function seeded(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export function forceLayout(ids: string[], links: LayoutLink[], width: number, height: number, pad: { x: number; y: number }, iterations = 600) {
  const n = ids.length;
  const pos = new Map<string, Point>();
  if (n === 0) return pos;
  const k = Math.sqrt((width * height) / n) * 1.05;

  for (const id of ids) {
    const rnd = seeded(id);
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * Math.min(width, height) * 0.4;
    pos.set(id, { x: width / 2 + r * Math.cos(a), y: height / 2 + r * Math.sin(a) });
  }
  if (n === 1) {
    pos.set(ids[0], { x: width / 2, y: height / 2 });
    return pos;
  }

  const strength = links.map(l => 0.35 + Math.min(0.5, Math.log1p(l.weight) / 8));
  let temp = width / 8;
  const cool = temp / iterations;

  for (let it = 0; it < iterations; it++) {
    const disp = new Map(ids.map(id => [id, { x: 0, y: 0 }]));
    for (let i = 0; i < n; i++) {
      const pi = pos.get(ids[i])!;
      for (let j = i + 1; j < n; j++) {
        const pj = pos.get(ids[j])!;
        let dx = pi.x - pj.x, dy = pi.y - pj.y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) { dx = 0.01 * (i - j); dy = 0.01; d = Math.hypot(dx, dy); }
        const f = (k * k) / d;
        const di = disp.get(ids[i])!, dj = disp.get(ids[j])!;
        di.x += (dx / d) * f; di.y += (dy / d) * f;
        dj.x -= (dx / d) * f; dj.y -= (dy / d) * f;
      }
    }
    links.forEach((l, idx) => {
      const pa = pos.get(l.a), pb = pos.get(l.b);
      if (!pa || !pb) return;
      const dx = pa.x - pb.x, dy = pa.y - pb.y;
      const d = Math.max(0.01, Math.hypot(dx, dy));
      const f = ((d * d) / k) * strength[idx];
      const da = disp.get(l.a)!, db = disp.get(l.b)!;
      da.x -= (dx / d) * f; da.y -= (dy / d) * f;
      db.x += (dx / d) * f; db.y += (dy / d) * f;
    });
    for (const id of ids) {
      const p = pos.get(id)!, dd = disp.get(id)!;
      dd.x += (width / 2 - p.x) * 0.06;
      dd.y += (height / 2 - p.y) * 0.06;
      const d = Math.max(0.01, Math.hypot(dd.x, dd.y));
      const step = Math.min(d, temp);
      p.x += (dd.x / d) * step;
      p.y += (dd.y / d) * step;
    }
    temp = Math.max(0.5, temp - cool);
  }

  const xs = ids.map(id => pos.get(id)!.x), ys = ids.map(id => pos.get(id)!.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const sx = (width - 2 * pad.x) / Math.max(1, maxX - minX);
  const sy = (height - 2 * pad.y) / Math.max(1, maxY - minY);
  const s = Math.min(sx, sy);
  const offX = (width - (maxX - minX) * s) / 2, offY = (height - (maxY - minY) * s) / 2;
  for (const id of ids) {
    const p = pos.get(id)!;
    pos.set(id, { x: offX + (p.x - minX) * s, y: offY + (p.y - minY) * s });
  }
  return pos;
}
