const clockFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function startOfDay(now: number) {
  const [h, m, sec] = clockFormatter.format(now).split(':').map(Number);
  return now - ((h * 60 + m) * 60 + sec) * 1000 - (now % 1000);
}
