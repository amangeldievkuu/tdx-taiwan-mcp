import { afterEach, describe, expect, it } from 'vitest';
import { API, connect, loadFixture, type Route } from '../helpers.js';

interface Wrapper {
  StopOfRoutes: unknown[];
  [key: string]: unknown;
}

/** A route's stop list in one direction, as `/v3/Ship/StopOfRoute` gives it. */
function stopList(
  routeId: string,
  routeName: string,
  direction: number,
  ports: Array<[id: string, zh: string, en: string]>,
) {
  return {
    RouteID: routeId,
    RouteName: { Zh_tw: routeName },
    Operators: [],
    Direction: direction,
    Stops: ports.map(([PortID, Zh_tw, En], i) => ({
      StopSequence: i + 1,
      PortID,
      PortName: { Zh_tw, En },
    })),
  };
}

const CHIKAN: [string, string, string] = ['TW028', '赤崁漁港', 'Chihkan'];
const JIBEI: [string, string, string] = ['TW027', '吉貝漁港', 'Ceiba'];
const DONGGANG: [string, string, string] = ['TWDNK', '東港', 'Donggang'];
const LIUQIU: [string, string, string] = ['TW001', '小琉球白沙港', 'Liuqiu Baisha'];
const DAFU: [string, string, string] = ['TW002', '小琉球大福漁港', 'Liuqiu Dafu'];
const KEELUNG: [string, string, string] = ['TWKEL', '基隆港', 'Keelung'];
const DONGYIN: [string, string, string] = ['TW011', '東引中柱港', 'Tungyeng Chungchu'];
const NANGAN: [string, string, string] = ['TW007', '南竿福澳港', 'Nankan Fuao'];

const stops = loadFixture('ship-stop-of-route.json') as Wrapper;
const NATIONWIDE_STOPS = {
  ...stops,
  StopOfRoutes: [
    ...stops.StopOfRoutes,
    stopList('CKJB', '赤崁漁港-吉貝漁港', 0, [CHIKAN, JIBEI]),
    stopList('DGLQ', '東港-小琉球', 0, [DONGGANG, LIUQIU]),
    stopList('DGLQ', '東港-小琉球', 1, [LIUQIU, DONGGANG]),
    stopList('DFLQ', '東港-小琉球大福', 1, [DAFU, DONGGANG]),
    stopList('KLMT', '基隆－馬祖(東引-南竿)', 0, [KEELUNG, DONGYIN, NANGAN]),
  ],
};
const PENGHU_STOPS = {
  UpdateInterval: -1,
  VersionID: 1,
  StopOfRoutes: [
    stopList('NANHAI', '馬公-望安-七美', 0, [
      ['TWMZG03', '馬公第三漁港', 'Makung 3rd Port'],
      ['TWWOT', '望安港', 'Wonan'],
      ['TWCMJ', '澎湖七美漁港', 'Chi Mei'],
    ]),
  ],
};

/** A daily timetable with one trip per entry of `trips`: `[[port, arrives, departs], ...]`. */
function daily(routeId: string, day: string, trips: Array<Array<[string, string, string]>>) {
  return {
    RouteID: routeId,
    RouteName: { Zh_tw: routeId },
    OperatorID: 'MPB1',
    Date: day,
    Direction: 0,
    TimeTables: trips.map((calls, t) => ({
      TripID: String(t + 1),
      StopTimes: calls.map(([PortID, ArrivalTime, DepartureTime], i) => ({
        StopSequence: i + 1,
        PortID,
        PortName: {},
        ArrivalTime,
        DepartureTime,
        TravelTime: 30,
      })),
    })),
  };
}

const ROUTES: Route[] = [
  ['/v3/Ship/StopOfRoute/Domestic/City/PenghuCounty', PENGHU_STOPS],
  ['/v3/Ship/StopOfRoute', NATIONWIDE_STOPS],
  [
    '/v3/Ship/DailySchedule/Domestic/City/PenghuCounty/NANHAI',
    loadFixture('ship-daily-schedule-penghu.json'),
  ],
  ['/v3/Ship/DailySchedule/CKJB', loadFixture('ship-daily-schedule.json')],
  [
    '/v3/Ship/DailySchedule/DGLQ',
    {
      UpdateInterval: -1,
      VersionID: 1,
      DailySchedules: [
        daily('DGLQ', '2026-10-21', [
          [
            ['TW001', '', '7:40'],
            ['TWDNK', '8:10', ''],
          ],
          [
            ['TW001', '', '11:10'],
            ['TWDNK', '11:40', ''],
          ],
        ]),
      ],
    },
  ],
  [
    '/v3/Ship/DailySchedule/FGGI',
    {
      UpdateInterval: -1,
      VersionID: 1,
      DailySchedules: ['2026-10-21', '2026-10-25'].map((day) =>
        daily('FGGI', day, [
          [
            ['TWTTT', '', '9:30'],
            ['TWGNI', '10:20', ''],
          ],
        ]),
      ),
    },
  ],
  [
    '/v3/Ship/DailySchedule/DFLQ',
    {
      UpdateInterval: -1,
      VersionID: 1,
      DailySchedules: [
        daily('DFLQ', '2026-10-21', [
          [
            ['TW002', '', '9:00'],
            ['TWDNK', '9:25', ''],
          ],
        ]),
      ],
    },
  ],
  ['/v3/Ship/Alert/Domestic/City/PenghuCounty', { UpdateInterval: -1, Alerts: [] }],
  ['/v3/Ship/Alert', loadFixture('ship-alert.json')],
  ['/v3/Ship/ShipLiveBoard', loadFixture('ship-live-board.json')],
  ['/v3/Ship/Route', loadFixture('ship-route.json')],
  ['/v3/Ship/ODFare/TWKEL/to/TW007', loadFixture('ship-od-fare-between.json')],
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

describe('ferry_timetable', () => {
  it('pairs each call at the departure port with the next call at the arrival port', async () => {
    const t = await setup();
    const result = await t.call('ferry_timetable', {
      from: '赤崁',
      to: '吉貝',
      date: '2026-11-17',
    });
    expect(t.apiUrls).toContain(`${API}/v3/Ship/DailySchedule/CKJB?$format=JSON`);
    expect(result.json).toMatchObject({
      from: '赤崁漁港 / Chihkan',
      to: '吉貝漁港 / Ceiba',
      date: '2026-11-17',
      after: '00:00',
    });
    expect(result.json.alerts).toBeUndefined();
    expect(result.json.items).toEqual([
      {
        departs: '06:15',
        arrives: '06:35',
        duration: '20m',
        route: '赤崁漁港-吉貝漁港 / Chikan Village-Jibei Village',
        trip: '001',
      },
      expect.objectContaining({ departs: '11:15', arrives: '11:35' }),
      expect.objectContaining({ departs: '17:00', arrives: '17:20' }),
    ]);
    const back = await t.call('ferry_timetable', {
      from: 'Ceiba',
      to: 'Chihkan',
      date: '2026-11-17',
      after: '10:00',
    });
    expect(back.json.items.map((i) => [i.departs, i.arrives])).toEqual([
      ['13:30', '13:50'],
      ['17:30', '17:50'],
    ]);
  });

  it('reads county-run lines with city, and hints at city without it', async () => {
    const t = await setup();
    const result = await t.call('ferry_timetable', {
      from: '馬公',
      to: '七美',
      city: '澎湖縣',
      date: '2026-11-27',
    });
    expect(result.json.items).toEqual([
      {
        departs: '09:30',
        arrives: '11:35',
        duration: '2h 05m',
        route: '馬公-望安-七美 / TWMZG03-TWTNM-TWCMJ',
        trip: '0011',
      },
    ]);
    const nationwide = await t.call('ferry_timetable', { from: '馬公', to: '七美' });
    expect(nationwide.isError).toBe(true);
    expect(nationwide.text).toMatch(/^No ferry port matches "馬公".*need city/);
    const taichung = await t.call('ferry_timetable', { from: 'a', to: 'b', city: 'Taichung' });
    expect(taichung.text).toMatch(/^"Taichung" has no county ferry feed/);
  });

  it('adds the live status of today’s sailings', async () => {
    const t = await setup();
    const result = await t.call('ferry_timetable', {
      from: 'TW001',
      to: '東港',
      date: '2026-10-21',
      after: '00:00',
    });
    expect(result.json.items).toEqual([
      {
        departs: '07:40',
        arrives: '08:10',
        duration: '30m',
        route: 'DGLQ',
        trip: '1',
        status: 'on time',
      },
      {
        departs: '11:10',
        arrives: '11:40',
        duration: '30m',
        route: 'DGLQ',
        trip: '2',
        status: 'departed',
        actual: '12:53',
      },
    ]);
  });

  it('takes an island with two ports as both, and says which port each sailing uses', async () => {
    const t = await setup();
    const result = await t.call('ferry_timetable', {
      from: '小琉球',
      to: '東港',
      date: '2026-10-21',
      after: '08:00',
    });
    expect(result.json.from).toBe('小琉球白沙港 / Liuqiu Baisha、小琉球大福漁港 / Liuqiu Dafu');
    expect(result.json.items.map((i) => [i.departs, i.from, i.to])).toEqual([
      ['09:00', '小琉球大福漁港 / Liuqiu Dafu', undefined],
      ['11:10', '小琉球白沙港 / Liuqiu Baisha', undefined],
    ]);
  });

  it('attaches the alerts in force on the day', async () => {
    const t = await setup();
    const during = await t.call('ferry_timetable', {
      from: '富岡',
      to: '綠島',
      date: '2026-10-21',
      after: '00:00',
    });
    expect(during.json.alerts).toEqual([
      {
        title: '受薔琵颱風影響，115年10月21日10時以後至23日富岡往返綠島船班全部停航。',
        status: 'disrupted',
        level: 'severe',
        cause: '天災',
        effect: 'sailings cancelled',
        routes: ['臺東(富岡)-綠島 / Fugang,Taitung－Green Island,Taitung'],
        start: '2026-10-19T16:23:00+08:00',
        end: '2026-10-23T23:55:00+08:00',
        published: '2026-10-19T16:28:05+08:00',
      },
    ]);
    const later = await t.call('ferry_timetable', { from: '富岡', to: '綠島', date: '2026-10-25' });
    expect(later.json.alerts).toBeUndefined();
    expect(later.json.items.map((i) => i.departs)).toEqual(['09:30']);
  });

  it('reports a pair of ports no route serves', async () => {
    const t = await setup();
    const result = await t.call('ferry_timetable', { from: '綠島', to: '吉貝' });
    expect(result.text).toMatch(/^No ferry route calls at both 綠島南寮漁港/);
  });
});

describe('ferry_live_board', () => {
  it('merges departures and arrivals by time', async () => {
    const t = await setup();
    const result = await t.call('ferry_live_board', { port: '小琉球' });
    expect(result.json).toMatchObject({
      port: '小琉球白沙港 / little Liuqiu port',
      date: '2026-10-21',
      updated: '2026-10-21T15:36:19+08:00',
    });
    expect(result.json.items).toEqual([
      {
        kind: 'arrival',
        time: '07:30',
        from: '東港 / Donggang Yanpu Fishing Port',
        route: 'DGLQ',
        vessel: '光輝 / GUANG HUI',
        status: 'on time',
      },
      expect.objectContaining({ kind: 'departure', time: '07:40', status: 'on time' }),
      expect.objectContaining({ kind: 'arrival', time: '07:40' }),
      {
        kind: 'departure',
        time: '11:10',
        to: '東港 / Donggang Yanpu Fishing Port',
        route: 'DGLQ',
        vessel: '藍白3號 / Leuco Sapphire No.3',
        status: 'departed',
        actual: '12:53',
      },
    ]);
    const byId = await t.call('ferry_live_board', { port: 'TW001' });
    expect(byId.json.total).toBe(4);
  });

  it('points to ferry_timetable for a port without a board', async () => {
    const t = await setup();
    const result = await t.call('ferry_live_board', { port: '綠島' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/For other ports, use ferry_timetable\.$/);
  });
});

describe('ferry_fare', () => {
  it('lists the fares of the port pair, cheapest single tickets first', async () => {
    const t = await setup();
    const result = await t.call('ferry_fare', { from: '基隆', to: '南竿' });
    expect(t.apiUrls).toContain(`${API}/v3/Ship/ODFare/TWKEL/to/TW007?$format=JSON`);
    expect(result.json).toMatchObject({
      from: '基隆港 / Keelung',
      to: '南竿福澳港 / Nankan Fuao',
      total: 6,
    });
    expect(result.json.items[0]).toEqual({
      route: '基隆－馬祖(東引-南竿) / Keelung-Matsu(Dongyin Township-Nangan Township)',
      ticket: '半票',
      cabin: '無障礙臥鋪',
      passenger: 'companion',
      type: 'single',
      price: 525,
    });
    expect(result.json.items.map((i) => i.price)).toEqual([525, 630, 840, 1050, 1575, 1890]);
  });
});

describe('ferry_alerts', () => {
  it('lists alerts, filtered by route or port name', async () => {
    const t = await setup();
    const all = await t.call('ferry_alerts');
    expect(all.json.items).toHaveLength(1);
    const greenIsland = await t.call('ferry_alerts', { keyword: '綠島' });
    expect(greenIsland.json.items[0]).toMatchObject({
      status: 'disrupted',
      effect: 'sailings cancelled',
    });
    const penghu = await t.call('ferry_alerts', { keyword: '澎湖' });
    expect(penghu.json).toMatchObject({ total: 0, note: 'No ferry alert mentions "澎湖".' });
  });
});
