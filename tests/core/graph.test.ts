import { describe, expect, it } from 'vitest';
import { shortestPath, type Step } from '../../src/core/graph.js';

const both = (a: string, b: string, cost: number): Array<Step<string>> => [
  { from: a, to: b, cost, data: `${a}${b}` },
  { from: b, to: a, cost, data: `${b}${a}` },
];

describe('shortestPath', () => {
  const steps = [
    ...both('A', 'B', 5),
    ...both('B', 'C', 5),
    ...both('A', 'D', 2),
    ...both('D', 'C', 2),
  ];

  it('finds the cheapest chain, not the shortest', () => {
    expect(shortestPath(steps, new Set(['A']), new Set(['C']))?.map((s) => s.data)).toEqual([
      'AD',
      'DC',
    ]);
  });

  it('starts from any start node and stops at the nearest end node', () => {
    const path = shortestPath(steps, new Set(['A', 'B']), new Set(['C', 'D']));
    expect(path?.map((s) => s.data)).toEqual(['AD']);
  });

  it('returns undefined when no end is reachable', () => {
    expect(shortestPath(steps, new Set(['A']), new Set(['Z']))).toBeUndefined();
  });
});
