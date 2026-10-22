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
