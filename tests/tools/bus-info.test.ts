import { afterEach, describe, expect, it } from 'vitest';
import { API, connect, loadFixture, type Route } from '../helpers.js';

const ROUTES: Route[] = [
  ['/v2/Bus/RouteFare/City/Taipei/307', loadFixture('bus-route-fare-taipei-307.json')],
  ['/v2/Bus/RouteFare/InterCity/1610', loadFixture('bus-intercity-route-fare-1610.json')],
  ['/v2/Bus/FirstLastTripInfo/City/Taichung/1', loadFixture('bus-first-last-taichung.json')],
  ['/v2/Bus/FirstLastTripInfo/InterCity', loadFixture('bus-first-last-intercity.json')],
  [
    '/v2/Bus/FirstLastTripInfo/City/Taipei',
    () => new Response('{"Message":"not supported"}', { status: 400 }),
  ],
  ['/v2/Bus/Schedule/City/Taipei/307', loadFixture('bus-schedule-taipei-307.json')],
  ['/v2/Bus/Schedule/InterCity/1610', loadFixture('bus-schedule-intercity-1610.json')],
];

/** Coach 1610's outbound stops (trimmed live data, 2026-11-02): stages 4, 5 and 9 have fares. */
const STOPS_1610 = [
  ['289792', '臺北轉運站', 'Taipei Bus Station', 'TPE'],
  ['310063', '經國轉運站', 'Jingguo Bus Station', 'TAO'],
  ['301900', '中壢服務區', 'Zhongli Service Area', 'TAO'],
  ['266076', '中港轉運站', 'Zhonggang Bus Station', 'TXG'],
  ['266161', '岡山站', 'Gangshan Station', 'KHH'],
  ['268482', '楠梓站', 'Nanzi Station', 'KHH'],
  ['310062', '捷運苓雅運動園區站', 'MRT Lingya Sports Park Station', 'KHH'],
  ['305496', '大順三路口', 'Dashun 3rd Rd.', 'KHH'],
  ['308696', '建國客運站', 'Jianguo Bus Station', 'KHH'],
] as const;
const STOP_OF_ROUTE_1610 = [
  {
    RouteUID: 'THB1610',
    RouteID: '1610',
    RouteName: { Zh_tw: '1610', En: '1610' },
    SubRouteUID: 'THB161001',
    SubRouteID: '161001',
    SubRouteName: { Zh_tw: '1610', En: '1610' },
    Direction: 0,
    Stops: STOPS_1610.map(([id, zh, en, city], i) => ({
      StopUID: `THB${id}`,
      StopID: id,
      StopName: { Zh_tw: zh, En: en },
      StopBoarding: 0,
      StopSequence: i + 1,
      StopPosition: { PositionLon: 121, PositionLat: 24 },
      StationID: id,
      LocationCityCode: city,
    })),
    UpdateTime: '2026-11-02T09:37:40+08:00',
    VersionID: 1,
  },
];

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
});

async function setup(routes = ROUTES) {
  const t = await connect(routes);
  close = t.close;
  return t;
}

describe('bus_fare', () => {
  it('gives section fares per ticket and passenger, with the buffer zones', async () => {
    const t = await setup();
    const result = await t.call('bus_fare', { city: '臺北市', routeName: '307' });
    expect(t.apiUrls).toEqual([
      `${API}/v2/Bus/RouteFare/City/Taipei/307?$filter=RouteName eq '307'&$format=JSON`,
    ]);
    expect(result.json.items).toEqual([
      {
        subRoutes: ['307莒光往板橋前站'],
        pricing: 'by section',
        fares: {
          single: {
            adult: 15,
            student: 15,
            child: 8,
            senior: 8,
            disabled: 8,
            companion: 8,
            militaryPolice: 15,
          },
          smartCard: {
            adult: 15,
            student: 12,
            child: 8,
            senior: 8,
            disabled: 8,
            companion: 8,
            militaryPolice: 12,
          },
        },
        bufferZones: [{ direction: 'inbound', section: 1, from: '萬大國小', to: '中和國稅局' }],
      },
    ]);
    expect(result.json.note).toMatch(/buffer zone.*smartCard/);

    const outbound = await t.call('bus_fare', {
      city: 'Taipei',
      routeName: '307',
      direction: 'outbound',
    });
    expect(outbound.json.items[0]?.bufferZones).toBeUndefined();
  });

  it('gives coach stage fares between two stops, keyed by the fare names', async () => {
    const t = await setup();
    const result = await t.call('bus_fare', {
      city: 'InterCity',
      routeName: '1610',
      from: '中港',
      to: '岡山',
    });
    expect(result.json.items).toEqual([
      {
        subRoutes: ['1610'],
        pricing: 'by stage',
        direction: 'outbound',
        from: '中港轉運站',
        to: '岡山站',
        fares: {
          single: {
            全票_原價_四排座: 259,
            全票_優惠_四排座: 259,
            全票_優惠_三排座: 300,
            全票_原價_三排座: 322,
            半票_不分時段_四排座: 130,
            半票_不分時段_三排座: 161,
          },
        },
      },
    ]);
    expect(result.json.note).toMatch(/fare stages/);
    expect(result.json.note).not.toMatch(/smartCard/);
  });

  it('charges a stop between fare stages to the next stage, and flags it', async () => {
    const t = await setup([...ROUTES, ['/v2/Bus/StopOfRoute/InterCity/1610', STOP_OF_ROUTE_1610]]);
    const result = await t.call('bus_fare', {
      city: 'InterCity',
      routeName: '1610',
      from: '中港',
      to: 'Dashun',
    });
    expect(result.json.items).toEqual([
      expect.objectContaining({
        from: '中港轉運站',
        to: '建國客運站',
        alighting: '大順三路口 / Dashun 3rd Rd.',
        estimated: true,
      }),
    ]);
    expect(result.json.items[0]?.boarding).toBeUndefined();
    expect(result.json.note).toMatch(/estimated: .*stage after alighting/);
  });

  it('takes city names for the ends of a coach trip', async () => {
    const t = await setup([...ROUTES, ['/v2/Bus/StopOfRoute/InterCity/1610', STOP_OF_ROUTE_1610]]);
    const result = await t.call('bus_fare', {
      city: 'InterCity',
      routeName: '1610',
      from: '台中',
      to: '高雄',
    });
    // "Station" matches most stops; only the fare stages among them are used.
    const named = await t.call('bus_fare', {
      city: 'InterCity',
      routeName: '1610',
      from: 'Zhonggang',
      to: 'Station',
    });
    expect(named.json.items.map((i) => i.to)).toEqual(['岡山站', '建國客運站']);
    // Only the fare stages in Kaohsiung, not every stop there.
    expect(result.json.items.map((i) => [i.from, i.to, i.estimated ?? false])).toEqual([
      ['中港轉運站', '岡山站', false],
      ['中港轉運站', '建國客運站', false],
    ]);
  });

  it('says when no ticket is sold for the trip', async () => {
    const fares = loadFixture('bus-intercity-route-fare-1610.json') as Array<{
      StageFares: Array<{ Fares: Array<{ Price: number }> }>;
    }>;
    for (const stage of fares[0]?.StageFares ?? []) for (const f of stage.Fares) f.Price = -1;
    const t = await setup([['/v2/Bus/RouteFare/InterCity/1610', fares]]);
    const result = await t.call('bus_fare', {
      city: 'InterCity',
      routeName: '1610',
      from: '中港',
      to: '岡山',
    });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/no ticket on sale .*中港轉運站 → 岡山站/);

    const all = await t.call('bus_fare', { city: 'InterCity', routeName: '1610' });
    expect(all.json.items).toEqual([]);
  });

  it('lists the fare stops when none matches', async () => {
    const t = await setup();
    const result = await t.call('bus_fare', { city: 'InterCity', routeName: '1610', from: '臺北' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/No fare on route 1610 matches from "臺北".*中港轉運站、岡山站/);

    // 臺北轉運站 comes before every stage that has a fare in this list.
    const t2 = await setup([...ROUTES, ['/v2/Bus/StopOfRoute/InterCity/1610', STOP_OF_ROUTE_1610]]);
    const before = await t2.call('bus_fare', {
      city: 'InterCity',
      routeName: '1610',
      from: '臺北',
    });
    expect(before.isError).toBe(true);
    expect(before.text).toMatch(/Give a stop on the route or a city/);
  });

  it('reports a route without fares', async () => {
    const t = await setup([['/v2/Bus/RouteFare/City/Taipei/', []]]);
    const result = await t.call('bus_fare', { city: 'Taipei', routeName: '999' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/No data for route "999" in Taipei/);
  });
});

describe('bus_first_last', () => {
  it('reads the first/last list for the weekday of the date', async () => {
    const t = await setup();
    const result = await t.call('bus_first_last', {
      city: 'Taichung',
      routeName: '1',
      date: '2026-11-02',
    });
    expect(result.json).toMatchObject({
      weekday: 'Monday',
      source: 'first/last trip list',
      items: [{ subRoute: '1', direction: 'outbound', first: '06:30', last: '22:00' }],
    });
  });

  it('filters the coach list by route and notes a day without service', async () => {
    const t = await setup();
    const result = await t.call('bus_first_last', {
      city: 'InterCity',
      routeName: '0968',
      date: '2026-11-01',
    });
    expect(t.apiUrls).toEqual([`${API}/v2/Bus/FirstLastTripInfo/InterCity?$format=JSON`]);
    expect(result.json.items).toEqual([]);
    expect(result.json.note).toMatch(/no service listed on 2026-11-01 \(Sunday\)/);
  });

  it('works it out from the timetable where TDX publishes no list', async () => {
    const t = await setup();
    const result = await t.call('bus_first_last', {
      city: 'Taipei',
      routeName: '307',
      date: '2026-11-02',
    });
    expect(result.json.source).toBe('timetable');
    expect(result.json.items).toEqual([
      { subRoute: '307莒光往板橋前站 / 307', direction: 'inbound', first: '05:00', last: '06:00' },
      { subRoute: '307莒光往撫遠街 / 307', direction: 'outbound', first: '05:00', last: '06:00' },
    ]);

    // A coach route missing from the list falls back too.
    const coach = await t.call('bus_first_last', {
      city: 'InterCity',
      routeName: '1610',
      date: '2026-11-02',
    });
    expect(coach.json).toMatchObject({ source: 'timetable', items: [{ first: '11:00' }] });
  });

  it('passes other TDX errors through', async () => {
    const t = await setup([
      ['/v2/Bus/FirstLastTripInfo/', () => new Response('{}', { status: 500 })],
    ]);
    const result = await t.call('bus_first_last', { city: 'Taichung', routeName: '1' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/HTTP 500/);
  });
});
