const partsFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function offsetAt(t: number) {
  const p = Object.fromEntries(partsFormatter.formatToParts(t).map(x => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - (t - (t % 1000));
}

export function startOfDay(now: number) {
  const local = now + offsetAt(now);
  const guess = now - (local % 86_400_000);
  return guess - (offsetAt(guess) - offsetAt(now));
}
