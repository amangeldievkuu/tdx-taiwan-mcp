import { describe, expect, it } from 'vitest';
import { compact, name } from '../../src/core/format.js';

describe('name', () => {
  it('joins Chinese and English, or uses whichever exists', () => {
    expect(name({ Zh_tw: '撫遠街', En: 'Fuyuan St.' })).toBe('撫遠街 / Fuyuan St.');
    expect(name({ Zh_tw: '307', En: '307' })).toBe('307');
    expect(name({ Zh_tw: '撫遠街', En: null })).toBe('撫遠街');
    expect(name({ En: 'Fuyuan St.' })).toBe('Fuyuan St.');
    expect(name(null)).toBeUndefined();
  });

  it('collapses the runs of spaces TDX names sometimes contain', () => {
    expect(name({ Zh_tw: '承德鄭州路口', En: 'Chengde Rd. & Zhengzhou Rd.  Intersection ' })).toBe(
      '承德鄭州路口 / Chengde Rd. & Zhengzhou Rd. Intersection',
    );
  });
});

describe('compact', () => {
  it('drops null, undefined and empty values, and the empty containers they leave', () => {
    expect(
      compact({ a: 1, b: null, c: '', d: { e: null }, f: [], g: [{ h: null }, 2], i: 0, j: false }),
    ).toEqual({ a: 1, g: [2], i: 0, j: false });
  });

  it('keeps an empty top-level array', () => {
    expect(compact([])).toEqual([]);
  });
});
