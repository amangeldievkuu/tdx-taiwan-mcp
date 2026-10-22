import { afterEach, describe, expect, it } from 'vitest';
import { API, connect, loadFixture, type Route } from '../helpers.js';

const ROUTES: Route[] = [
  ['/v2/Bike/Station/City/Taipei', loadFixture('bike-station-taipei.json')],
  ['/v2/Bike/Availability/City/Taipei', loadFixture('bike-availability-taipei.json')],
];

// Near 捷運科技大樓站 (TPE500101001) and 復興南路二段273號前 (TPE500101002); 臺北車站 is ~3 km away.
const NEAR_TECH_BLDG = { lat: 25.0259, lon: 121.5436 };

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
});

async function setup() {
  const t = await connect(ROUTES);
  close = t.close;
  return t;
}

describe('youbike_nearby', () => {
  it('returns operating stations with bikes, nearest first, with clean names', async () => {
    const t = await setup();
    const result = await t.call('youbike_nearby', { ...NEAR_TECH_BLDG, city: 'Taipei' });
    expect(result.isError).toBe(false);
    expect(t.apiUrls.sort()).toEqual([
      `${API}/v2/Bike/Availability/City/Taipei?$format=JSON`,
      `${API}/v2/Bike/Station/City/Taipei?$format=JSON`,
    ]);
    expect(result.json).toMatchObject({ city: 'Taipei', total: 1, truncated: false });
    expect(result.json.items[0]).toMatchObject({
      name: '捷運科技大樓站 / MRT Technology Bldg. Sta.',
      address: '復興南路二段235號前 / No.235, Sec. 2, Fuxing S. Rd.',
      stationUID: 'TPE500101001',
      type: 'YouBike2.0',
      status: 'operating',
      bikes: 6,
      regularBikes: 5,
      eBikes: 1,
      emptyDocks: 22,
      capacity: 28,
      updated: '2026-10-20T10:14:52+08:00',
    });
    expect(result.json.items[0]?.distanceMeters).toBeLessThan(50);
  });

  it('finds empty docks with want "dock", and every station with "any" and a wide radius', async () => {
    const t = await setup();
    const docks = await t.call('youbike_nearby', {
      ...NEAR_TECH_BLDG,
      city: 'Taipei',
      want: 'dock',
    });
    expect(docks.json.items.map((i) => i.stationUID)).toEqual(['TPE500101001', 'TPE500101002']);
    const any = await t.call('youbike_nearby', {
      ...NEAR_TECH_BLDG,
      city: '台北市',
      want: 'any',
      radiusMeters: 5000,
    });
    expect(any.json.items.map((i) => i.stationUID)).toEqual([
      'TPE500101001',
      'TPE500101002',
      'TPE500119001',
    ]);
    expect(any.json.items[2]).toMatchObject({ name: '臺北車站(忠孝西路)', status: 'suspended' });
    expect(any.json.items[2]?.bikes).toBeUndefined();
  });

  it('honours limit', async () => {
    const t = await setup();
    const result = await t.call('youbike_nearby', {
      ...NEAR_TECH_BLDG,
      city: 'Taipei',
      want: 'any',
      radiusMeters: 5000,
      limit: 1,
    });
    expect(result.json).toMatchObject({ total: 3, returned: 1, truncated: true });
  });
});

describe('youbike_station', () => {
  it('finds stations by Chinese name with 台/臺 folding', async () => {
    const t = await setup();
    const result = await t.call('youbike_station', { city: 'Taipei', keyword: '台北車站' });
    expect(result.json.items.map((i) => i.stationUID)).toEqual(['TPE500119001']);
  });

  it('finds stations by English name or address', async () => {
    const t = await setup();
    const result = await t.call('youbike_station', { city: 'Taipei', keyword: 'fuxing s. rd' });
    expect(result.json.total).toBe(2);
  });

  it('passes the TDX error for an unknown city through', async () => {
    const t = await connect([
      [
        '/v2/Bike/',
        () =>
          new Response(JSON.stringify({ Message: "City: 'Atlantis' 不在可接受的範圍內" }), {
            status: 400,
          }),
      ],
    ]);
    close = t.close;
    const result = await t.call('youbike_station', { city: 'Atlantis', keyword: 'x' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/HTTP 400 for \/v2\/Bike\/.*\/City\/Atlantis: City: 'Atlantis'/);
  });
});
