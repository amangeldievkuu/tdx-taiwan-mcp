import { afterEach, describe, expect, it } from 'vitest';
import { API, connect, loadFixture, type Route } from '../helpers.js';

/** What TDX answers for a city without data: no array at all. */
const NO_DATA = { UpdateInterval: -1, SrcUpdateInterval: -1 };

const ROUTES: Route[] = [
  ['/v1/Parking/OffStreet/CarPark/City/Taipei', loadFixture('parking-car-park-taipei.json')],
  [
    '/v1/Parking/OffStreet/ParkingAvailability/City/Taipei',
    loadFixture('parking-availability-taipei.json'),
  ],
  ['/v1/Parking/OnStreet/ParkingSegment/City/Taipei', loadFixture('parking-segment-taipei.json')],
  [
    '/v1/Parking/OnStreet/ParkingSegmentAvailability/City/Taipei',
    loadFixture('parking-segment-availability-taipei.json'),
  ],
  // NewTaipei's breakdown says 0 free while the overall count has some, as in live data.
  [
    '/v1/Parking/OnStreet/ParkingSegmentAvailability/City/NewTaipei',
    {
      CurbParkingSegmentAvailabilities: [
        {
          ParkingSegmentID: '6018000',
          ParkingSegmentName: { Zh_tw: '雙園堤外平面停車場(大車)' },
          TotalSpaces: 30,
          AvailableSpaces: 7,
          Availabilities: [{ SpaceType: 1, NumberOfSpaces: 24, AvailableSpaces: 0 }],
          ServiceStatus: 1,
          FullStatus: 1,
          ChargeStatus: 1,
          DataCollectTime: '2026-10-27T14:33:22+08:00',
        },
      ],
    },
  ],
  ['/v1/Parking/OffStreet/CarPark/City/NewTaipei', NO_DATA],
  ['/v1/Parking/OffStreet/ParkingAvailability/City/NewTaipei', NO_DATA],
  [
    '/v1/Parking/OnStreet/ParkingSegment/City/NewTaipei',
    loadFixture('parking-segment-taipei.json'),
  ],
];

// Next to 臺北市災害應變中心地下停車場 (TPE0567).
const NEAR_TPE0567 = { lat: 25.0289, lon: 121.5659, city: 'Taipei' };

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
});

async function setup() {
  const t = await connect(ROUTES);
  close = t.close;
  return t;
}

describe('parking_nearby', () => {
  it('joins car parks with live spaces, nearest first', async () => {
    const t = await setup();
    const result = await t.call('parking_nearby', NEAR_TPE0567);
    expect(t.apiUrls.sort()).toEqual([
      `${API}/v1/Parking/OffStreet/CarPark/City/Taipei?$format=JSON`,
      `${API}/v1/Parking/OffStreet/ParkingAvailability/City/Taipei?$format=JSON`,
      `${API}/v1/Parking/OnStreet/ParkingSegment/City/Taipei?$format=JSON`,
      `${API}/v1/Parking/OnStreet/ParkingSegmentAvailability/City/Taipei?$format=JSON`,
    ]);
    expect(result.json.items).toEqual([
      {
        distanceMeters: 6,
        name: '臺北市災害應變中心地下停車場',
        kind: 'car park',
        address: '臺北市信義區莊敬路391巷11弄2號B1',
        freeSpaces: 9,
        totalSpaces: 169,
        fullness: 'spaces free',
        status: 'open',
        charging: 'charging',
        fare: '依現場公告為準',
        ev: true,
        id: 'TPE0567',
        lat: 25.02885,
        lon: 121.5659,
        updated: '2026-10-21T10:08:50+08:00',
      },
    ]);
  });

  it('counts scooter spaces, and keeps unknown and full places with want "any"', async () => {
    const t = await setup();
    const scooter = await t.call('parking_nearby', { ...NEAR_TPE0567, vehicle: 'scooter' });
    expect(scooter.json.items[0]).toMatchObject({
      id: 'TPE0567',
      freeSpaces: 43,
      totalSpaces: 197,
    });
    const everything = await t.call('parking_nearby', {
      ...NEAR_TPE0567,
      want: 'any',
      radiusMeters: 5000,
      limit: 10,
    });
    expect(everything.json.items.map((i) => [i.id, i.status, i.freeSpaces])).toEqual([
      ['TPE0567', 'open', 9],
      ['2047514', 'open', 0],
    ]);
    const space = await t.call('parking_nearby', { ...NEAR_TPE0567, radiusMeters: 5000 });
    expect(space.json.items.map((i) => i.id)).toEqual(['TPE0567']);
  });

  it('keeps a car park without live data as unknown, and filters by kind', async () => {
    const t = await setup();
    const result = await t.call('parking_nearby', {
      lat: 25.08197,
      lon: 121.51653,
      city: 'Taipei',
      kind: 'offStreet',
    });
    expect(result.json.items).toEqual([
      expect.objectContaining({ id: 'TPE0448', status: 'no live data', distanceMeters: 0 }),
    ]);
    expect(result.json.items[0]?.freeSpaces).toBeUndefined();
  });

  it('reads a city with on-street parking only, and its broken breakdown', async () => {
    const t = await setup();
    const result = await t.call('parking_nearby', {
      lat: 25.03273,
      lon: 121.48806,
      city: '新北市',
    });
    expect(result.isError).toBe(false);
    expect(result.json).toMatchObject({ city: 'NewTaipei' });
    expect(result.json.items).toEqual([
      expect.objectContaining({
        id: '6018000',
        kind: 'on-street',
        freeSpaces: 7,
        totalSpaces: 30,
        fullness: 'almost full',
        fare: '40元(09:00-17:00)',
      }),
    ]);
  });
});

describe('parking_search', () => {
  it('finds places by name, road, or a live record without a car park', async () => {
    const t = await setup();
    const byName = await t.call('parking_search', { city: 'Taipei', keyword: '災害應變' });
    expect(byName.json.items.map((i) => i.id)).toEqual(['TPE0567']);
    const byRoad = await t.call('parking_search', { city: 'Taipei', keyword: '龍江路' });
    expect(byRoad.json.items).toEqual([
      expect.objectContaining({ id: '2047514', fullness: 'full', freeSpaces: 0 }),
    ]);
    const liveOnly = await t.call('parking_search', { city: 'Taipei', keyword: '府前廣場' });
    expect(liveOnly.json.items).toEqual([
      expect.objectContaining({ id: 'TPE0096', freeSpaces: 351, status: 'open' }),
    ]);
  });
});
