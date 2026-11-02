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

  it('lists the fare stops when none matches', async () => {
    const t = await setup();
    const result = await t.call('bus_fare', { city: 'InterCity', routeName: '1610', from: '臺北' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/No fare on route 1610 matches from "臺北".*中港轉運站、岡山站/);
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
