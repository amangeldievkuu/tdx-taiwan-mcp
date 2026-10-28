/** A directed step between two nodes, with what it costs and what it stands for. */
export interface Step<T> {
  from: string;
  to: string;
  cost: number;
  data: T;
}

/**
 * Dijkstra: the cheapest chain of steps from any node in `starts` to any node in `ends`, or
 * `undefined` when none is reachable. Steps are directed; add both ways for a two-way link.
 */
export function shortestPath<T>(
  steps: readonly Step<T>[],
  starts: ReadonlySet<string>,
  ends: ReadonlySet<string>,
): Step<T>[] | undefined {
  const out = new Map<string, Step<T>[]>();
  for (const step of steps) out.set(step.from, [...(out.get(step.from) ?? []), step]);

  const best = new Map<string, number>();
  const via = new Map<string, Step<T>>();
  const open = new Set<string>();
  for (const node of starts) {
    best.set(node, 0);
    open.add(node);
  }
  while (open.size) {
    let current: string | undefined;
    for (const node of open) {
      if (current === undefined || (best.get(node) ?? Infinity) < (best.get(current) ?? Infinity)) {
        current = node;
      }
    }
    if (current === undefined) break;
    open.delete(current);
    if (ends.has(current)) {
      const path: Step<T>[] = [];
      // Start nodes cost nothing, so no step ever leads into one: the walk stops there.
      for (let step = via.get(current); step; step = via.get(step.from)) path.unshift(step);
      return path;
    }
    const cost = best.get(current) ?? Infinity;
    for (const step of out.get(current) ?? []) {
      if (cost + step.cost < (best.get(step.to) ?? Infinity)) {
        best.set(step.to, cost + step.cost);
        via.set(step.to, step);
        open.add(step.to);
      }
    }
  }
  return undefined;
}
