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

/** How well a name matches: 3 exact, 2 prefix, 1 contains, 0 no match. */
function score(name: string, keyword: string): number {
  const n = normalize(name);
  if (n === keyword) return 3;
  if (n.startsWith(keyword)) return 2;
  return n.includes(keyword) ? 1 : 0;
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
  const key = normalize(keyword);
  if (!key) return [...items];
  return items
    .map((item, index) => ({
      item,
      index,
      score: Math.max(0, ...names(item).map((name) => (name ? score(name, key) : 0))),
    }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((m) => m.item);
}
