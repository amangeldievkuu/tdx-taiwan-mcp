import { describe, expect, it } from 'vitest';
import { haversine, nearest, pointOf, pointFromWkt } from '../../src/core/geo.js';

const TAIPEI_MAIN = { lat: 25.0478, lon: 121.517 };

describe('haversine', () => {
  it('is zero for the same point', () => {
    expect(haversine(TAIPEI_MAIN, TAIPEI_MAIN)).toBe(0);
  });

  it('matches a known distance (Taipei Main → Taipei 101, about 5 km)', () => {
    const d = haversine(TAIPEI_MAIN, { lat: 25.0339, lon: 121.5645 });
    expect(d).toBeGreaterThan(4_800);
    expect(d).toBeLessThan(5_200);
  });
});

describe('pointOf', () => {
  it('reads PointType and rejects missing coordinates', () => {
    expect(pointOf({ PositionLat: 25, PositionLon: 121 })).toEqual({ lat: 25, lon: 121 });
    expect(pointOf({ PositionLat: 25, PositionLon: null })).toBeUndefined();
    expect(pointOf(null)).toBeUndefined();
  });
});

describe('nearest', () => {
  const items = [
    { id: 'far', pos: { lat: 25.06, lon: 121.517 } },
    { id: 'none', pos: undefined },
    { id: 'near', pos: { lat: 25.048, lon: 121.517 } },
    { id: 'mid', pos: { lat: 25.05, lon: 121.517 } },
  ];

  it('sorts by distance, skips items without a position and applies the limit', () => {
    const found = nearest(items, (i) => i.pos, TAIPEI_MAIN, { limit: 2 });
    expect(found.map((f) => f.item.id)).toEqual(['near', 'mid']);
    expect(found[0]?.distance).toBeLessThan(50);
  });

  it('drops items beyond maxMeters', () => {
    const found = nearest(items, (i) => i.pos, TAIPEI_MAIN, { limit: 10, maxMeters: 500 });
    expect(found.map((f) => f.item.id)).toEqual(['near', 'mid']);
  });
});

describe('pointFromWkt', () => {
  it('reads lon and lat from a WKT point', () => {
    expect(pointFromWkt('POINT(121.362315 25.064692)')).toEqual({
      lat: 25.064692,
      lon: 121.362315,
    });
    expect(pointFromWkt('LINESTRING(121 25, 122 26)')).toBeUndefined();
    expect(pointFromWkt(undefined)).toBeUndefined();
  });
});
