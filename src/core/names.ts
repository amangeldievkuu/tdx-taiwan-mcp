import { ToolInputError } from './errors.js';

/**
 * Folds a name for matching: full-width to half-width, lower case, 台 → 臺, no spaces or
 * punctuation, and "station" → "sta" so `Taipei Main Station` matches `Taipei Main Sta.`.
 */
export function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll('台', '臺')
    .replace(/\bstation\b/g, 'sta')
    .replace(/[\s.,·・'’"()[\]{}_-]+/g, '');
}

/**
 * The folded keyword, plus the keyword without a "station" suffix (`臺北車站` → `臺北`,
 * `Taipei Main Station` → `taipei`), for sources that name stations without one.
 */
function keys(keyword: string): string[] {
  const key = normalize(keyword);
  const bare = normalize(
    keyword
      .trim()
      .replace(/\s+(main\s+)?(station|sta\.?)$/i, '')
      .replace(/(車站|站)$/, ''),
  );
  return bare && bare !== key ? [key, bare] : [key];
}

/**
 * How well a name matches: 3 exact, 2 prefix, 1 contains, 0 no match. An exact match on the
 * keyword without its "station" suffix scores 2.5, below a literal exact match.
 */
function score(name: string, key: string, bare: boolean): number {
  const n = normalize(name);
  if (n === key) return bare ? 2.5 : 3;
  if (n.startsWith(key)) return 2;
  return n.includes(key) ? 1 : 0;
}

interface Ranked<T> {
  item: T;
  score: number;
}

function rank<T>(
  items: readonly T[],
  names: (item: T) => Array<string | null | undefined>,
  keyword: string,
): Array<Ranked<T>> {
  const variants = keys(keyword);
  return items
    .map((item, index) => ({
      item,
      index,
      score: Math.max(
        0,
        ...names(item).flatMap((name) =>
          name ? variants.map((key, i) => score(name, key, i > 0)) : [],
        ),
      ),
    }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

/**
 * Items whose names contain `keyword`, best matches first (exact, then prefix, then contains;
 * ties keep the input order). `names` returns every name to try, e.g. Chinese and English.
 */
export function search<T>(
  items: readonly T[],
  names: (item: T) => Array<string | null | undefined>,
  keyword: string,
): T[] {
  if (!normalize(keyword)) return [...items];
  return rank(items, names, keyword).map((m) => m.item);
}

export interface ResolveOptions<T> {
  /** Every name to try, e.g. Chinese and English. The first is shown in messages. */
  names: (item: T) => Array<string | null | undefined>;
  /** IDs the input may give instead of a name (`1000`, `BL12`, `TPE`). */
  ids?: (item: T) => Array<string | null | undefined>;
  /** What the items are, for messages: `THSR station`. */
  label: string;
  /**
   * Return every best match, even under different names, instead of reporting them as
   * ambiguous: for places that several items serve (two ferry ports on one island).
   */
  many?: boolean;
}

/**
 * The items `input` names: an exact ID match, else the best name matches. Several items are
 * returned only when they share one name (a metro station listed once per line), or with
 * `many`. No match or an ambiguous match throws a `ToolInputError` listing the candidates.
 */
export function resolve<T>(
  items: readonly T[],
  input: string,
  options: ResolveOptions<T>,
): [T, ...T[]] {
  const { names, ids, label, many = false } = options;
  const wanted = input.trim().toLowerCase();
  const byId = ids
    ? items.filter((item) => ids(item).some((id) => id?.toLowerCase() === wanted))
    : [];
  if (byId.length) return byId as [T, ...T[]];

  const ranked = rank(items, names, input);
  const best = ranked[0];
  if (!best) {
    const known = items.map((item) => names(item)[0]).filter(Boolean);
    throw new ToolInputError(
      `No ${label} matches "${input}". Known: ${known.slice(0, 60).join('、')}${known.length > 60 ? '…' : ''}.`,
    );
  }
  const top = ranked.filter((m) => m.score === best.score).map((m) => m.item);
  const distinct = new Set(top.map((item) => normalize(names(item)[0] ?? '')));
  if (distinct.size === 1 || many) return top as [T, ...T[]];
  const candidates = [...new Set(top.map((item) => names(item)[0]).filter(Boolean))];
  throw new ToolInputError(
    `"${input}" matches several ${label}s: ${candidates.slice(0, 20).join('、')}. Give the full name.`,
  );
}
