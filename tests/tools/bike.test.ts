import { afterEach, describe, expect, it } from 'vitest';
import { rocDate, wktPoints } from '../../src/tools/bike.js';
import { API, connect, loadFixture, type Route } from '../helpers.js';

const ROUTES: Route[] = [
  ['/v2/Bike/Station/City/Taipei', loadFixture('bike-station-taipei.json')],
  ['/v2/Bike/Availability/City/Taipei', loadFixture('bike-availability-taipei.json')],
  ['/v2/Cycling/Shape/City/Taipei', loadFixture('bike-cycling-shape-taipei.json')],
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

describe('cycling_routes', () => {
  it("lists a city's paths, longest first, with their ends and a readable date", async () => {
    const t = await setup();
    const result = await t.call('cycling_routes', { city: '臺北市' });
    expect(t.apiUrls).toEqual([`${API}/v2/Cycling/Shape/City/Taipei?$format=JSON`]);
    expect(result.json.totalLengthKm).toBe(0.9);
    expect(result.json.items[0]).toEqual({
      name: '三元街(西南側)',
      town: '中正區',
      from: '南海路',
      to: '泉州街',
      lengthMeters: 640,
      finished: '2013-12-31',
      start: { lat: 25.02762, lon: 121.51424 },
      end: { lat: 25.02955, lon: 121.50903 },
    });
  });

  it('finds paths near a point, nearest first, within the radius', async () => {
    const t = await setup();
    const near = { city: 'Taipei', lat: 25.03, lon: 121.508 };
    const result = await t.call('cycling_routes', near);
    expect(result.json.items.map((i) => [i.name, i.distanceMeters])).toEqual([
      ['三元街(東北側2)', 41],
      ['三元街(西南側)', 115],
    ]);
    const close = await t.call('cycling_routes', { ...near, radiusMeters: 100 });
    expect(close.json.total).toBe(1);
  });

  it('searches by road or district, and wants both coordinates', async () => {
    const t = await setup();
    const result = await t.call('cycling_routes', { city: 'Taipei', keyword: '泉州街' });
    expect(result.json.items.map((i) => i.name)).toEqual(['三元街(西南側)']);
    const half = await t.call('cycling_routes', { city: 'Taipei', lat: 25.03 });
    expect(half.isError).toBe(true);
    expect(half.text).toMatch(/both lat and lon/);
  });

  it('reads ROC dates and WKT paths', () => {
    expect(rocDate('1021231')).toBe('2013-12-31');
    expect(rocDate('991231')).toBe('2010-12-31');
    expect(rocDate('102/1/5')).toBe('2013-01-05');
    expect(rocDate('unknown')).toBe('unknown');
    expect(rocDate('')).toBeUndefined();
    expect(wktPoints('MULTILINESTRING ((121.5 25.1,121.6 25.2),(121.7 25.3))')).toEqual([
      { lon: 121.5, lat: 25.1 },
      { lon: 121.6, lat: 25.2 },
      { lon: 121.7, lat: 25.3 },
    ]);
  });
});
