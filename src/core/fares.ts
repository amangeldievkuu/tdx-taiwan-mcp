/** 費率等級, shared by the THSR, TRA, metro and ferry fare tables (TRA, metro, ferry: 8 = group). */
export const FARE_CLASS: Record<number, string> = {
  1: 'adult',
  2: 'student',
  3: 'child',
  4: 'senior',
  5: 'disabled',
  6: 'disabledChild',
  7: 'companion',
};

/** 艙等 / 車廂: 1 = standard, 2 = business, 3 = non-reserved. */
const CABIN_CLASS: Record<number, string> = { 1: 'standard', 2: 'business', 3: 'nonReserved' };

export interface FareEntry {
  TicketType: number;
  FareClass: number;
  CabinClass?: number | null;
  CitizenCode?: string | null;
  Price: number;
}

/**
 * Single-journey prices (`TicketType` 1) as `{ cabin: { fareClass: price } }`, or a flat
 * `{ fareClass: price }` when there is only one cabin. Residents-only prices are keyed like
 * `child (TPE residents)`. Classes outside `extra` and the shared list keep their number.
 */
export function fareTable(
  fares: readonly FareEntry[],
  extra: Record<number, string> = {},
): Record<string, number> | Record<string, Record<string, number>> {
  const classes = { ...FARE_CLASS, ...extra };
  const table: Record<string, Record<string, number>> = {};
  for (const fare of fares) {
    if (fare.TicketType !== 1) continue;
    const cabin = CABIN_CLASS[fare.CabinClass ?? 1] ?? `cabin ${fare.CabinClass}`;
    const citizen =
      fare.CitizenCode && fare.CitizenCode !== 'OTHERS' ? ` (${fare.CitizenCode} residents)` : '';
    const key = `${classes[fare.FareClass] ?? `class ${fare.FareClass}`}${citizen}`;
    (table[cabin] ??= {})[key] = fare.Price;
  }
  const cabins = Object.keys(table);
  return cabins.length === 1 && cabins[0] ? (table[cabins[0]] ?? {}) : table;
}
