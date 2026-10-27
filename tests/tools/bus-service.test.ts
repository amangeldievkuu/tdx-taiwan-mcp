import { afterEach, describe, expect, it, vi } from 'vitest';
import { API, connect, loadFixture, type Route } from '../helpers.js';

/** The two routes of the ETA fixture, with the terminals the tool shows as `toward`. */
const ROUTE_LIST = [
  {
    RouteUID: 'TPE10181',
    RouteName: { Zh_tw: '205', En: '205' },
    DepartureStopNameZh: '東園',
    DestinationStopNameZh: '中崙',
  },
  {
    RouteUID: 'TPE10415',
    RouteName: { Zh_tw: '221', En: '221' },
    DepartureStopNameZh: '南港',
    DestinationStopNameZh: '中和',
  },
];

const ROUTES: Route[] = [
  ['/v2/Bus/Station/City/Taipei', loadFixture('bus-station-taipei.json')],
  ['/v2/Bus/EstimatedTimeOfArrival/City/Taipei', loadFixture('bus-eta-stop-taipei.json')],
  ['/v2/Bus/Route/City/Taipei', ROUTE_LIST],
  ['/v2/Bus/Schedule/City/Taipei/307', loadFixture('bus-schedule-taipei-307.json')],
  ['/v2/Bus/Schedule/City/Kaohsiung', []],
  ['/v2/Bus/Schedule/InterCity/1610', loadFixture('bus-schedule-intercity-1610.json')],
  ['/v2/Bus/Alert/City/Taipei', loadFixture('bus-alert-taipei.json')],
  ['/v2/Bus/News/City/Taipei', loadFixture('bus-news-taipei.json')],
  ['/v2/Bus/Alert/InterCity', loadFixture('bus-alert-intercity.json')],
  ['/v2/Bus/News/InterCity', []],
];

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await close?.();
});

async function setup(routes = ROUTES) {
  const t = await connect(routes);
  close = t.close;
  return t;
}

describe('bus_stop_arrivals', () => {
  it('lists every route due at a station, soonest first, with where each is heading', async () => {
    const t = await setup();
    const result = await t.call('bus_stop_arrivals', { city: 'Taipei', stationUID: 'tpe1000082' });
    expect(t.apiUrls).toContain(
      `${API}/v2/Bus/Station/City/Taipei?$filter=StationUID eq 'TPE1000082'&$format=JSON`,
    );
    expect(t.apiUrls).toContain(
      `${API}/v2/Bus/EstimatedTimeOfArrival/City/Taipei?$filter=StopUID eq 'TPE34726' or ` +
        "StopUID eq 'TPE35854' or StopUID eq 'TPE35979'&$format=JSON",
    );
    expect(result.json).toMatchObject({
      city: 'Taipei',
      stop: '臺北車站(忠孝) / Taipei Main Sta. (Zhongxiao)',
      heading: 'westbound',
    });
    expect(result.json.items).toEqual([
      {
        route: '221',
        toward: '中和',
        direction: 'outbound',
        arrival: '2 min',
        minutes: 2,
      },
      { route: '205', toward: '中崙', direction: 'outbound', arrival: '8 min', minutes: 8 },
    ]);
  });

  it('finds the stops by name, with 台 or 臺 and the English half dropped', async () => {
    const t = await setup();
    const result = await t.call('bus_stop_arrivals', {
      city: 'Taipei',
      stop: '台北車站(忠孝) / Taipei Main Sta. (Zhongxiao)',
    });
    expect(t.apiUrls[0]).toBe(
      `${API}/v2/Bus/EstimatedTimeOfArrival/City/Taipei?$filter=StopName/Zh_tw eq ` +
        "'台北車站(忠孝)' or StopName/Zh_tw eq '臺北車站(忠孝)'&$format=JSON",
    );
    expect(result.json.items.map((i) => i.route)).toEqual(['221', '205']);
  });

  it('reports a missing input, an unknown station and an unknown stop name', async () => {
    const t = await setup([
      ['/v2/Bus/Station/City/Taipei', []],
      ['/v2/Bus/EstimatedTimeOfArrival/City/Taipei', []],
      ['/v2/Bus/Route/City/Taipei', []],
    ]);
    const nothing = await t.call('bus_stop_arrivals', { city: 'Taipei' });
    expect(nothing.text).toBe('Give stationUID (from bus_stops_nearby) or stop (the stop name).');
    const station = await t.call('bus_stop_arrivals', { city: 'Taipei', stationUID: 'TPE0' });
    expect(station.text).toMatch(/^No bus station TPE0 in Taipei/);
    const stop = await t.call('bus_stop_arrivals', { city: 'Taipei', stop: '火星' });
    expect(stop.text).toMatch(/^No stop named "火星" in Taipei/);
  });
});

describe('bus_timetable', () => {
  it('lists the scheduled departures from a stop, never from a trip’s last stop', async () => {
    const t = await setup();
    const fromStop = await t.call('bus_timetable', {
      city: 'InterCity',
      routeName: '1610',
      stop: '中正',
      date: '2026-11-02',
    });
    expect(fromStop.json).toMatchObject({ route: '1610', date: '2026-11-02', after: '00:00' });
    expect(fromStop.json.items).toEqual([
      {
        departs: '11:11',
        stop: '中正站 / JhongJheng Station',
        toward: '楠梓站 / Nanzi Station',
        subRoute: '1610',
        direction: 'inbound',
      },
    ]);
    const fromStart = await t.call('bus_timetable', {
      city: 'InterCity',
      routeName: '1610',
      date: '2026-11-02',
    });
    expect(fromStart.json.items.map((i) => i.departs)).toEqual(['11:00']);
    const atEnd = await t.call('bus_timetable', {
      city: 'InterCity',
      routeName: '1610',
      stop: '楠梓',
      date: '2026-11-02',
    });
    expect(atEnd.json).toMatchObject({
      total: 0,
      note: 'No scheduled departures on 2026-11-02 after 00:00.',
    });
  });

  it('gives the headways of the day for a route run by frequency', async () => {
    const t = await setup();
    const sunday = await t.call('bus_timetable', {
      city: 'Taipei',
      routeName: '307',
      date: '2026-11-01',
      after: '20:00',
      direction: 'outbound',
    });
    expect(sunday.json).toMatchObject({
      total: 0,
      headways: [
        { from: '05:00', to: '21:00', everyMinutes: '7–10', direction: 'outbound' },
        { from: '21:00', to: '22:10', everyMinutes: '10–15', direction: 'outbound' },
      ],
      note: 'This route runs by frequency: buses leave the first stop at these intervals.',
    });
    const monday = await t.call('bus_timetable', {
      city: 'Taipei',
      routeName: '307',
      date: '2026-11-02',
    });
    expect(monday.json.headways).toEqual([
      expect.objectContaining({ from: '05:00', to: '06:00', everyMinutes: '5–10' }),
      expect.objectContaining({ from: '05:00', to: '06:00', everyMinutes: '5–10' }),
    ]);
  });

  it('reports a city without timetables and a stop the route does not serve', async () => {
    const t = await setup();
    const kaohsiung = await t.call('bus_timetable', { city: '高雄', routeName: '紅28' });
    expect(kaohsiung.text).toMatch(/Kaohsiung publishes none/);
    const stop = await t.call('bus_timetable', {
      city: 'InterCity',
      routeName: '1610',
      stop: '花蓮',
    });
    expect(stop.text).toBe(
      'No stop on route 1610 matches "花蓮". Its stops include: 建國客運站、中正站、楠梓站.',
    );
  });
});

describe('bus_alerts', () => {
  it('lists current and upcoming alerts with their scope, and the latest news', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T12:00:00+08:00'));
    const t = await setup();
    const result = await t.call('bus_alerts', { city: '臺北市' });
    expect(result.json).toMatchObject({
      city: 'Taipei',
      news: [{ title: expect.stringMatching(/同志遊行/) as unknown }],
    });
    expect(result.json.items).toEqual([
      expect.objectContaining({
        title: '2026第二十四屆臺灣同志遊行(4/4)',
        status: 'disrupted',
        cause: 'event',
        effect: 'detour, stops skipped',
        start: '2026-10-31T20:00:00+08:00',
      }),
    ]);
    expect(result.json.items[0]?.stops).toHaveLength(3);
  });

  it('matches a route named in the alert text, as a whole word', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T12:00:00+08:00'));
    const t = await setup();
    const route = await t.call('bus_alerts', { city: 'InterCity', route: '8129' });
    expect(route.json.items).toEqual([
      expect.objectContaining({ operators: ['東台灣客運 / Easterntop Bus'] }),
    ]);
    expect(route.json.news).toBeUndefined();
    const prefix = await t.call('bus_alerts', { city: 'InterCity', route: '812' });
    expect(prefix.json).toMatchObject({ total: 0, note: 'No current bus alert matches.' });
  });

  it('drops alerts that have ended', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T12:00:00+08:00'));
    const t = await setup();
    const result = await t.call('bus_alerts', { city: 'Taipei' });
    expect(result.json).toMatchObject({
      total: 0,
      note: 'No current bus alerts: buses run as scheduled.',
    });
  });
});
