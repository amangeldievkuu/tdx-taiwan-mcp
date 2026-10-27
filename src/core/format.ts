/** A TDX multilingual name, in any of its shapes (`NameType`, `ZhEnName`). */
export interface AnyName {
  Zh_tw?: string | null;
  En?: string | null;
}

/** `臺北車站 / Taipei Main Station`, or just the name that exists. Runs of spaces collapse. */
export function name(value: AnyName | null | undefined): string | undefined {
  const zh = value?.Zh_tw?.replace(/\s+/g, ' ').trim();
  const en = value?.En?.replace(/\s+/g, ' ').trim();
  if (zh && en && zh !== en) return `${zh} / ${en}`;
  return zh || en || undefined;
}

/**
 * Removes `null`, `undefined`, empty strings, and the empty objects and arrays left behind, so
 * results spend fewer tokens on absent fields.
 */
export function compact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(compact).filter((v) => v !== undefined);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([k, v]) => [k, compact(v)] as const)
      .filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0));
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value === null || value === '' ? undefined : value;
}

/** Alert `Level` of the rail and ferry feeds. */
export const ALERT_LEVEL: Record<number, string> = { 1: 'severe', 2: 'moderate', 3: 'minor' };

/** Alert and event descriptions may hold HTML; this keeps the text. */
export function plain(text: string | null | undefined): string | undefined {
  const stripped = text
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || undefined;
}

/** Drops the `0001-01-01` placeholder TDX sends for "no time". */
export function realTime(value: string | null | undefined): string | undefined {
  return value && !value.startsWith('0001-') ? value : undefined;
}

/**
 * The array of a TDX wrapper object. The types require it, but TDX leaves it out for a city
 * without data (`{"UpdateInterval": -1, ...}`).
 */
export function arrayOf<T>(items: readonly T[] | undefined): readonly T[] {
  return items ?? [];
}
