import { afterEach, describe, expect, it } from 'vitest';
import { API, connect, type Route } from '../helpers.js';

function pair(id: string, description: string, distance: number) {
  const [start, end] = id.split('-');
  return {
    ETagPairID: id,
    StartETagGantryID: start,
    EndETagGantryID: end,
    Description: description,
    Distance: distance,
    Geometry: 'LINESTRING (121 25, 121.1 25.1)',
  };
}

function live(id: string, flows: Array<[type: number, seconds: number, kmh: number]>) {
  return {
    ETagPairID: id,
    StartETagStatus: 0,
    EndETagStatus: 0,
    Flows: flows.map(([VehicleType, TravelTime, SpaceMeanSpeed]) => ({
      VehicleType,
      TravelTime,
      StandardDeviation: 0,
      SpaceMeanSpeed,
      VehicleCount: 10,
    })),
    StartTime: '2026-10-27T15:40:00+08:00',
    EndTime: '2026-10-27T15:45:00+08:00',
    DataCollectTime: '2026-10-27T15:45:00+08:00',
  };
}

// 林口 → 桃園, then either straight on to 新竹 (jammed) or over 國道3號 via 大溪 (faster).
// 新竹 → 竹南 has no live time. Every pair runs one way only.
const PAIRS = {
  ETagPairs: [
    pair('01F0410S-01F0490S', '林口-桃園', 8),
    pair('01F0490S-01F0950S', '桃園-新竹', 46),
    pair('01F0490S-03F0590S', '桃園-大溪', 20),
    pair('03F0590S-03F0950S', '大溪-新竹&新竹系統', 30),
    pair('01F0950S-01F1100S', '新竹-竹南', 15),
  ],
};
const LIVE = {
  ETagPairLives: [
    live('01F0410S-01F0490S', [
      [31, 300, 96],
      [5, 420, 70],
    ]),
    live('01F0490S-01F0950S', [[31, 3600, 46]]),
    // No car (31) reading: the 小貨車 (32) time stands in.
    live('01F0490S-03F0590S', [
      [31, 0, 0],
      [32, 900, 80],
    ]),
    live('03F0590S-03F0950S', [[31, 1200, 90]]),
  ],
};

const ROUTES: Route[] = [
  ['/v2/Road/Traffic/ETagPair/Freeway', PAIRS],
  ['/v2/Road/Traffic/Live/ETag/Freeway', LIVE],
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

describe('traffic_travel_time', () => {
  it('takes the fastest route, not the shortest, with each segment', async () => {
    const t = await setup();
    const result = await t.call('traffic_travel_time', { from: '林口交流道', to: '新竹' });
    expect(t.apiUrls.sort()).toEqual([
      `${API}/v2/Road/Traffic/ETagPair/Freeway?$format=JSON`,
      `${API}/v2/Road/Traffic/Live/ETag/Freeway?$format=JSON`,
    ]);
    expect(result.json).toEqual({
      from: '林口',
      to: '新竹&新竹系統',
      travelTime: '40m',
      minutes: 40,
      distanceKm: 58,
      averageSpeedKmh: 87,
      roads: ['國道1號', '國道3號'],
      segments: [
        { road: '國道1號', between: '林口-桃園', km: 8, time: '5m', speedKmh: 96 },
        { road: '國道1號', between: '桃園-大溪', km: 20, time: '15m', speedKmh: 80 },
        { road: '國道3號', between: '大溪-新竹&新竹系統', km: 30, time: '20m', speedKmh: 90 },
      ],
      updated: '2026-10-27T15:45:00+08:00',
    });
  });

  it('estimates a segment without a live time, and says so', async () => {
    const t = await setup();
    const result = await t.call('traffic_travel_time', { from: '新竹', to: '竹南' });
    expect(result.json).toMatchObject({
      travelTime: '10m',
      segments: [{ between: '新竹-竹南', km: 15, time: '10m', estimated: true }],
      note: '1 of 1 segments have no live car time and assume 90 km/h.',
    });
  });

  it('reports unknown and identical interchanges, and pairs with no route', async () => {
    const t = await setup();
    const unknown = await t.call('traffic_travel_time', { from: 'Atlantis', to: '新竹' });
    expect(unknown.text).toMatch(/^No freeway interchange matches "Atlantis"/);
    const same = await t.call('traffic_travel_time', { from: '新竹', to: '新竹' });
    expect(same.text).toBe('"新竹" and "新竹" are the same interchange.');
    const backwards = await t.call('traffic_travel_time', { from: '竹南', to: '林口' });
    expect(backwards.text).toBe("No freeway route from 竹南 to 林口 in TDX's eTag data.");
  });
});
