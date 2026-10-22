import { afterEach, describe, expect, it } from 'vitest';
import { API, connect, loadFixture, type Route } from '../helpers.js';

const EXACT_307 = "$filter=RouteName/Zh_tw eq '307'";

const ROUTES: Route[] = [
  ['/v2/Bus/Route/City/Taipei', loadFixture('bus-route-taipei-307.json')],
  ['/v2/Bus/StopOfRoute/City/Taipei/307', loadFixture('bus-stop-of-route-taipei-307.json')],
  ['/v2/Bus/EstimatedTimeOfArrival/City/Taipei/307', loadFixture('bus-eta-taipei-307.json')],
  ['/v2/Bus/RealTimeByFrequency/City/Taipei/307', loadFixture('bus-position-taipei-307.json')],
  ['/v2/Bus/Route/InterCity', loadFixture('bus-intercity-route-1610.json')],
  ['/v2/Bus/EstimatedTimeOfArrival/InterCity/1610', loadFixture('bus-intercity-eta-1610.json')],
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

describe('bus_route_search', () => {
  it('matches route names, with endpoints, operators and fare', async () => {
    const t = await setup();
    const result = await t.call('bus_route_search', { city: 'Taipei', keyword: '307' });
    expect(t.apiUrls).toHaveLength(1);
    expect(t.apiUrls[0]).toMatch(/\/v2\/Bus\/Route\/City\/Taipei\?\$select=RouteUID,RouteName,/);
    expect(result.json.items).toEqual([
      expect.objectContaining({
        route: '307',
        from: '板橋前站 / Banqiao Front Sta.',
        type: 'city bus',
        operators: '臺北客運 / Taipei Bus Co.',
        fare: '二段票',
      }),
    ]);
  });

  it('matches terminal stops too', async () => {
    const t = await setup();
    const result = await t.call('bus_route_search', { city: 'Taipei', keyword: '撫遠街' });
    expect(result.json.items[0]?.route).toBe('307');
  });

  it('searches InterCity coaches', async () => {
    const t = await setup();
    const result = await t.call('bus_route_search', { city: '國道客運', keyword: '1610' });
    expect(t.apiUrls[0]).toMatch(/\/v2\/Bus\/Route\/InterCity\?\$select=/);
    expect(result.json).toMatchObject({ city: 'InterCity', total: 1 });
    expect(result.json.items[0]?.route).toBe('1610');
    expect(result.json.items[0]?.from).toMatch(/^臺北轉運站/);
  });
});

describe('bus_route_stops', () => {
  it('lists stops in order per sub-route, matching the route name exactly', async () => {
    const t = await setup();
    const result = await t.call('bus_route_stops', { city: 'Taipei', routeName: '307' });
    expect(t.apiUrls).toEqual([
      `${API}/v2/Bus/StopOfRoute/City/Taipei/307?${EXACT_307}&$format=JSON`,
    ]);
    expect(result.json.items).toEqual([
      {
        subRoute: '307莒光往撫遠街 / 307 Juguang to Fuyuan St.',
        direction: 'outbound',
        stops: [
          '1. 板橋前站 / Banqiao Front Sta.',
          '2. 捷運西門站 / MRT Ximen Sta.',
          '3. 撫遠街 / Fuyuan St.',
        ],
      },
    ]);
  });

  it('reports an unknown route as a tool error that points to bus_route_search', async () => {
    const t = await setup([['/v2/Bus/StopOfRoute/', []]]);
    const result = await t.call('bus_route_stops', { city: 'Taipei', routeName: '9999' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/No data for route "9999" in Taipei.*bus_route_search/);
  });
});

describe('bus_eta', () => {
  it('describes each stop, ordered by direction and sequence', async () => {
    const t = await setup();
    const result = await t.call('bus_eta', { city: 'Taipei', routeName: '307' });
    expect(t.apiUrls).toEqual([
      `${API}/v2/Bus/EstimatedTimeOfArrival/City/Taipei/307?${EXACT_307}&$format=JSON`,
    ]);
    expect(result.json).toMatchObject({ city: 'Taipei', route: '307', total: 3 });
    expect(result.json.items).toEqual([
      expect.objectContaining({
        stop: '板橋前站 / Banqiao Front Sta.',
        direction: 'outbound',
        arrival: '7 min (bus not departed yet)',
        stopSequence: 1,
      }),
      expect.objectContaining({
        stop: '捷運西門站 / MRT Ximen Sta.',
        arrival: '4 min',
        minutes: 4,
        laterBusesMinutes: [13],
        plate: 'EAL-0123',
      }),
      expect.objectContaining({
        stop: '撫遠街 / Fuyuan St.',
        direction: 'inbound',
        arrival: 'last bus has passed',
        subRoute: '307莒光往板橋 / 307 Juguang to Banqiao',
      }),
    ]);
    expect(result.json.items[0]?.plate).toBeUndefined();
  });

  it('narrows to one stop and one direction', async () => {
    const t = await setup();
    const one = await t.call('bus_eta', { city: 'Taipei', routeName: '307', stop: '西門' });
    expect(one.json.items.map((i) => i.stop)).toEqual(['捷運西門站 / MRT Ximen Sta.']);
    const inbound = await t.call('bus_eta', {
      city: 'Taipei',
      routeName: '307',
      direction: 'inbound',
    });
    expect(inbound.json.total).toBe(1);
  });

  it('lists the route stops when the stop does not match', async () => {
    const t = await setup();
    const result = await t.call('bus_eta', { city: 'Taipei', routeName: '307', stop: '動物園' });
    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      'No stop on route 307 matches "動物園". Its stops include: 板橋前站、捷運西門站、撫遠街.',
    );
  });

  it('serves InterCity routes', async () => {
    const t = await setup();
    const result = await t.call('bus_eta', { city: 'InterCity', routeName: '1610' });
    expect(t.apiUrls[0]).toMatch(/\/v2\/Bus\/EstimatedTimeOfArrival\/InterCity\/1610\?/);
    expect(result.json.items.map((i) => i.arrival)).toEqual([
      'not departed yet',
      'last bus has passed',
    ]);
  });
});

describe('bus_positions', () => {
  it('lists each vehicle with position and speed', async () => {
    const t = await setup();
    const result = await t.call('bus_positions', { city: 'Taipei', routeName: '307' });
    expect(t.apiUrls).toEqual([
      `${API}/v2/Bus/RealTimeByFrequency/City/Taipei/307?${EXACT_307}&$format=JSON`,
    ]);
    expect(result.json.items[1]).toEqual({
      plate: '266-U5',
      direction: 'outbound',
      subRoute: '307莒光往撫遠街 / 307',
      lat: 25.011048,
      lon: 121.461627,
      speedKmh: 10,
      status: 'normal',
      gpsTime: '2026-10-20T17:52:51+08:00',
    });
    expect(result.json.note).toBeUndefined();
  });

  it('explains an empty result', async () => {
    const t = await setup([['/v2/Bus/RealTimeByFrequency/', []]]);
    const result = await t.call('bus_positions', { city: 'Taipei', routeName: '307' });
    expect(result.isError).toBe(false);
    expect(result.json.note).toMatch(/No vehicle is reporting/);
  });
});
