import { afterEach, describe, expect, it } from 'vitest';
import { API, connect, loadFixture, type Route } from '../helpers.js';

interface Positions {
  LivePositions: unknown[];
  [key: string]: unknown;
}

const positions = loadFixture('ship-live-position.json') as Positions;
// The fixture's two vessels (NEW TAIMA moored at Keelung, MAI LIAO NO.205 under way off
// Yunlin), plus one that broadcasts no name, drifting near 小琉球.
const ROUTES: Route[] = [
  [
    '/v3/Ship/LivePosition',
    {
      ...positions,
      LivePositions: [
        ...positions.LivePositions,
        {
          VesselID: '416000001',
          MMSI: '416000001',
          VesselName: { Zh_tw: '', En: '' },
          VesselPosition: { PositionLat: 22.36, PositionLon: 120.39 },
          NAVSTAT: 15,
          SOG: 0.4,
          COG: 10,
          GPSTime: '2026-10-21T15:36:00+08:00',
        },
      ],
    },
  ],
  ['/v3/Ship/Port', loadFixture('ship-port.json')],
];

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
});

async function setup() {
  const t = await connect(ROUTES);
  close = t.close;
  return t;
}

describe('ferry_positions', () => {
  it('lists the vessels near a port, nearest first, with their nearest port', async () => {
    const t = await setup();
    const result = await t.call('ferry_positions', { port: '基隆' });
    expect(t.apiUrls.sort()).toEqual([
      `${API}/v3/Ship/LivePosition?$format=JSON`,
      `${API}/v3/Ship/Port?$format=JSON`,
    ]);
    expect(result.json).toMatchObject({ near: '基隆港 / Keelung' });
    expect(result.json.items).toEqual([
      {
        vessel: 'NEW TAIMA',
        status: 'moored',
        speedKnots: 0,
        nearPort: '基隆港 / Keelung (0.1 km)',
        distanceKm: 0.1,
        lat: 25.1343117,
        lon: 121.74133,
        updated: '2026-10-21T15:36:13+08:00',
        mmsi: '416009193',
      },
    ]);
  });

  it('finds vessels by name, and only moving ones on request', async () => {
    const t = await setup();
    const byName = await t.call('ferry_positions', { keyword: 'taima' });
    expect(byName.json.items.map((i) => i.vessel)).toEqual(['NEW TAIMA']);
    const moving = await t.call('ferry_positions', { moving: true });
    expect(moving.json.items).toEqual([
      expect.objectContaining({
        vessel: 'MAI LIAO NO.205',
        status: 'under way',
        speedKnots: 10.8,
        courseDegrees: 269.5,
      }),
    ]);
  });

  it('names a vessel without a broadcast name by its MMSI', async () => {
    const t = await setup();
    const result = await t.call('ferry_positions', { port: '小琉球', radiusKm: 5 });
    expect(result.json.items).toEqual([
      expect.objectContaining({
        vessel: 'MMSI 416000001',
        status: 'not reported',
        nearPort: '小琉球白沙港 / Baisha Port (1.0 km)',
      }),
    ]);
    expect(result.json.items[0]?.courseDegrees).toBeUndefined();
  });

  it('notes an empty area and rejects half a coordinate', async () => {
    const t = await setup();
    const empty = await t.call('ferry_positions', { port: '馬公', radiusKm: 1 });
    expect(empty.json.note).toBe(
      'No vessel within 1 km of 澎湖港馬公碼頭區 / Magong, Penghu(1) reports a position now.',
    );
    const half = await t.call('ferry_positions', { lat: 25 });
    expect(half.text).toBe('Give both lat and lon, or neither.');
  });
});
