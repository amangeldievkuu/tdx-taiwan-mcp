const taipei = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** The date (`YYYY-MM-DD`) and time (`HH:mm`) in Taiwan. */
export function taipeiNow(now: Date = new Date()): { date: string; time: string } {
  const part = (type: string) => taipei.formatToParts(now).find((p) => p.type === type)?.value;
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
}

/** Minutes since midnight of `HH:mm` or `HH:mm:ss`. */
export function clock(time: string): number {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return h * 60 + m;
}

/** `06:15` of the unpadded `6:15` the ferry timetables use; `undefined` when blank. */
export function padTime(time: string | null | undefined): string | undefined {
  return time ? time.padStart(5, '0') : undefined;
}

/** The local `HH:mm` of a TDX timestamp such as `2026-10-21T11:10:00+08:00`. */
export function clockOf(timestamp: string | null | undefined): string | undefined {
  return timestamp ? timestamp.slice(11, 16) : undefined;
}

/** `HH:mm` of `HH:mm:ss`. */
export function hhmm(time: string | null | undefined): string | undefined {
  return time ? time.slice(0, 5) : undefined;
}

/** Travel time from `departs` to `arrives` (`HH:mm`), past midnight if need be: `2h 14m`. */
export function duration(
  departs: string | null | undefined,
  arrives: string | null | undefined,
): string | undefined {
  if (!departs || !arrives) return undefined;
  const minutes = (clock(arrives) - clock(departs) + 24 * 60) % (24 * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/**
 * The time to list departures from: `after` if given, else the current time when `date` is
 * today in Taiwan (so the next trains come first), else the start of the day.
 */
export function startTime(date: string, after: string | undefined, now = taipeiNow()): string {
  if (after) return after;
  return date === now.date ? now.time : '00:00';
}

/**
 * Minutes from `a` to `b`, both local Taiwan times as the flight boards give them
 * (`yyyy-MM-ddTHH:mm`); negative when `b` is earlier.
 */
export function minutesBetween(
  a: string | null | undefined,
  b: string | null | undefined,
): number | undefined {
  if (!a || !b) return undefined;
  const ms = Date.parse(`${b}:00+08:00`) - Date.parse(`${a}:00+08:00`);
  return Number.isNaN(ms) ? undefined : Math.round(ms / 60_000);
}

/** `1h 05m`, `28m`, or `45s` under a minute. */
export function clockText(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes === 0) return `${Math.round(seconds)}s`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
