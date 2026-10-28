import { afterEach, describe, expect, it, vi } from 'vitest';
import { API, connect, type Route } from '../helpers.js';

function station(StationID: string, Zh_tw: string, En: string) {
  return { StationID, StationName: { Zh_tw, En }, StationPosition: {} };
}

/** Run times of a route as TDX lists them: one direction, adjacent stations in order. */
function route(LineID: string, RouteID: string, ids: string[], runTime: number, stopTime = 0) {
  return {
    LineID,
    RouteID,
    TrainType: 1,
    TravelTimes: ids.slice(1).map((to, i) => ({
      Sequence: i + 1,
      FromStationID: ids[i],
      FromStationName: {},
      ToStationID: to,
      ToStationName: {},
      RunTime: runTime,
      StopTime: stopTime,
    })),
  };
}

function transfer(
  FromStationID: string,
  FromLineID: string,
  ToStationID: string,
  ToLineID: string,
  TransferTime: number,
) {
  return { FromStationID, FromLineID, ToStationID, ToLineID, TransferTime };
}

/** A route's ordered stations, as `/v2/Rail/Metro/StationOfRoute` gives them. */
function stopList(LineID: string, RouteID: string, ids: string[]) {
  return {
    LineID,
    RouteID,
    Direction: 0,
    Stations: ids.map((StationID, i) => ({ Sequence: i + 1, StationID, StationName: {} })),
  };
}

// A small Taipei: BL and R cross at 台北車站 (two IDs, 4 min apart), the G line has a branch
// shuttle from 七張 to 小碧潭, and New Taipei's Y line meets BL at 板橋 (NTMC's own transfer).
const NAMES: Record<string, string> = {
  BL07: '板橋',
  BL11: '西門',
  BL12: '台北車站',
  BL13: '善導寺',
  R09: '中山',
  R10: '台北車站',
  R11: '台大醫院',
  R12: '廣慈',
  G03: '七張',
  G03A: '小碧潭',
  G04: '大坪林',
  Y16: '板橋',
  Y17: '新埔民生',
  Z01: '孤島',
};
const TRTC_STATIONS = Object.entries(NAMES)
  .filter(([id]) => !id.startsWith('Y'))
  .map(([id, zh]) => station(id, zh, id));
const NTMC_STATIONS = [
  station('Y16', '板橋', 'Banqiao'),
  station('Y17', '新埔民生', 'Xinpu Minsheng'),
];

const ROUTES: Route[] = [
  ['/v2/Rail/Metro/Station/TRTC', TRTC_STATIONS],
  ['/v2/Rail/Metro/Station/NTMC', NTMC_STATIONS],
  [
    '/v2/Rail/Metro/S2STravelTime/TRTC',
    [
      route('BL', 'BL-1', ['BL07', 'BL11', 'BL12', 'BL13'], 120, 20),
      route('R', 'R-1', ['R09', 'R10', 'R11'], 100, 20),
      route('G', 'G-1', ['G03', 'G04'], 120),
      route('G', 'G-3', ['G03A', 'G03'], 120),
    ],
  ],
  ['/v2/Rail/Metro/S2STravelTime/NTMC', [route('Y', 'Y-1', ['Y16', 'Y17'], 120, 25)]],
  [
    '/v2/Rail/Metro/LineTransfer/TRTC',
    [transfer('BL12', 'BL', 'R10', 'R', 4), transfer('G03', 'G', 'G03', 'G', 3)],
  ],
  ['/v2/Rail/Metro/LineTransfer/NTMC', [transfer('Y16', 'Y', 'BL07', 'BL', 5)]],
  [
    '/v2/Rail/Metro/Line/TRTC',
    [
      { LineID: 'BL', LineName: { Zh_tw: '板南線', En: 'Bannan Line' } },
      { LineID: 'R', LineName: { Zh_tw: '淡水信義線', En: 'Tamsui-Xinyi Line' } },
    ],
  ],
  [
    // The stop lists know the R line runs on to 廣慈, which the run times predate.
    '/v2/Rail/Metro/StationOfRoute/TRTC',
    [
      stopList('BL', 'BL-1', ['BL07', 'BL11', 'BL12', 'BL13']),
      stopList('R', 'R-1', ['R09', 'R10', 'R11', 'R12']),
    ],
  ],
  [
    '/v2/Rail/Metro/Line/NTMC',
    [{ LineID: 'Y', LineName: { Zh_tw: '環狀線', En: 'Circular Line' } }],
  ],
  [
    '/v2/Rail/Metro/Frequency/TRTC',
    ['BL', 'R'].map((LineID) => ({
      LineID,
      RouteID: `${LineID}-1`,
      ServiceDay: { Monday: true, Tuesday: true, Wednesday: true, Thursday: true, Friday: true },
      OperationTime: { StartTime: '06:00', EndTime: '24:00' },
      Headways: [
        {
          PeakFlag: '0',
          StartTime: '09:00',
          EndTime: '17:00',
          MinHeadwayMins: LineID === 'R' ? 4 : 6,
          MaxHeadwayMins: LineID === 'R' ? 6 : 8,
        },
      ],
    })),
  ],
  ['/v2/Rail/Metro/Frequency/NTMC', []],
  [
    '/v2/Rail/Metro/Station/TYMC',
    [
      station('A1', '台北車站', 'Taipei Main Station'),
      station('A2', '三重', 'Sanchong'),
      station('A3', '新北產業園區', 'New Taipei Industrial Park'),
    ],
  ],
  [
    '/v2/Rail/Metro/S2STravelTime/TYMC',
    [
      {
        LineID: 'A',
        RouteID: '',
        TrainType: 1,
        TravelTimes: [
          { FromStationID: 'A1', ToStationID: 'A2', RunTime: 300 },
          { FromStationID: 'A1', ToStationID: 'A3', RunTime: 600 },
        ],
      },
      {
        LineID: 'A',
        RouteID: '',
        TrainType: 2,
        TravelTimes: [{ FromStationID: 'A1', ToStationID: 'A3', RunTime: 480 }],
      },
    ],
  ],
  [
    '/v2/Rail/Metro/Frequency/TYMC',
    [
      {
        LineID: 'A',
        RouteID: 'A-1',
        TrainType: 0,
        ServiceDay: { Wednesday: true },
        OperationTime: { StartTime: '05:30', EndTime: '00:30' },
        Headways: [
          {
            PeakFlag: '1',
            StartTime: '05:30',
            EndTime: '00:30',
            MinHeadwayMins: 15,
            MaxHeadwayMins: 15,
          },
        ],
      },
    ],
  ],
  ['/v2/Rail/Metro/', []],
];

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await close?.();
});

async function setup() {
  const t = await connect(ROUTES);
  close = t.close;
  return t;
}

/** A day that is not today: no current headway, so no waits. */
const LATER = '2030-01-02';

describe('metro_travel_time', () => {
  it('changes lines at an interchange with two station IDs', async () => {
    const t = await setup();
    const result = await t.call('metro_travel_time', {
      system: 'TRTC',
      from: '中山',
      to: '善導寺',
      date: LATER,
    });
    expect(t.apiUrls).toContain(`${API}/v2/Rail/Metro/S2STravelTime/TRTC?$format=JSON`);
    expect(t.apiUrls).toContain(`${API}/v2/Rail/Metro/S2STravelTime/NTMC?$format=JSON`);
    expect(result.json).toEqual({
      system: 'TRTC',
      from: '中山 / R09',
      to: '善導寺 / BL13',
      // 120 s riding, 4 min walking, 140 s riding.
      travelTime: '8m',
      minutes: 8,
      transfers: 1,
      legs: [
        {
          line: '淡水信義線 / Tamsui-Xinyi Line',
          from: '中山 / R09',
          to: '台北車站 / R10',
          toward: '廣慈 / R12',
          stops: 1,
          minutes: 2,
        },
        {
          line: '板南線 / Bannan Line',
          from: '台北車站 / BL12',
          to: '善導寺 / BL13',
          toward: '善導寺 / BL13',
          stops: 1,
          minutes: 2,
        },
      ],
      changes: [
        {
          at: '台北車站 / R10',
          fromLine: '淡水信義線 / Tamsui-Xinyi Line',
          toLine: '板南線 / Bannan Line',
          walkMinutes: 4,
        },
      ],
      note: 'Riding and walking time only; waits depend on when you start (see metro_frequency).',
    });
  });

  it('estimates a stretch the run times lack, from its line', async () => {
    const t = await setup();
    const result = await t.call('metro_travel_time', {
      system: 'TRTC',
      from: '中山',
      to: '廣慈',
      date: LATER,
    });
    expect(result.json).toMatchObject({
      // Two known stretches of 120 s, and one estimated at their mean.
      minutes: 6,
      legs: [{ to: '廣慈 / R12', stops: 3, estimated: true }],
    });
    expect(result.json.note).toMatch(/that part is estimated from the line’s other stretches\.$/);
  });

  it('crosses into New Taipei lines through the NTMC transfer', async () => {
    const t = await setup();
    const result = await t.call('metro_travel_time', {
      system: 'TRTC',
      from: '新埔民生',
      to: '西門',
      date: LATER,
    });
    expect(result.json).toMatchObject({
      transfers: 1,
      legs: [
        { line: '環狀線 / Circular Line', from: '新埔民生 / Xinpu Minsheng', to: '板橋 / Banqiao' },
        {
          line: '板南線 / Bannan Line',
          from: '板橋 / BL07',
          to: '西門 / BL11',
          toward: '善導寺 / BL13',
        },
      ],
      changes: [{ at: '板橋 / Banqiao', walkMinutes: 5 }],
    });
  });

  it('counts the change of train onto a branch shuttle', async () => {
    const t = await setup();
    const result = await t.call('metro_travel_time', {
      system: 'TRTC',
      from: '小碧潭',
      to: '大坪林',
      date: LATER,
    });
    expect(result.json).toMatchObject({
      minutes: 7,
      transfers: 1,
      legs: [{ from: '小碧潭 / G03A' }, { from: '七張 / G03', to: '大坪林 / G04' }],
      changes: [{ at: '七張 / G03', walkMinutes: 3 }],
    });
  });

  it("adds today's headways and the expected wait", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T10:00:00+08:00'));
    const t = await setup();
    const result = await t.call('metro_travel_time', {
      system: 'TRTC',
      from: '中山',
      to: '善導寺',
    });
    expect(result.json.legs).toEqual([
      expect.objectContaining({ trainsEvery: '4–6 min' }),
      expect.objectContaining({ trainsEvery: '6–8 min' }),
    ]);
    // Half the mean headway of each boarding: 2.5 + 3.5.
    expect(result.json).toMatchObject({ waitMinutes: 6, withWaitsMinutes: 14 });
    expect(result.json.note).toBeUndefined();
  });

  it('gives the airport line as express and local options, across midnight bands', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T23:50:00+08:00'));
    const t = await setup();
    const both = await t.call('metro_travel_time', {
      system: 'TYMC',
      from: '台北車站',
      to: '新北產業園區',
    });
    expect(both.json).toEqual({
      system: 'TYMC',
      from: '台北車站 / Taipei Main Station',
      to: '新北產業園區 / New Taipei Industrial Park',
      minutes: 8,
      options: [
        {
          trainType: 'express',
          travelTime: '8m',
          minutes: 8,
          trainsEvery: '15 min',
          waitMinutes: 8,
        },
        {
          trainType: 'local',
          travelTime: '10m',
          minutes: 10,
          trainsEvery: '15 min',
          waitMinutes: 8,
        },
      ],
      note: 'Express trains stop only at the main stations; locals stop everywhere.',
    });
    const local = await t.call('metro_travel_time', { system: 'TYMC', from: 'A1', to: '三重' });
    expect(local.json.options).toEqual([
      expect.objectContaining({ trainType: 'local', minutes: 5 }),
    ]);
  });

  it('reports the same station, an unknown one and an unreachable one', async () => {
    const t = await setup();
    const same = await t.call('metro_travel_time', { system: 'TRTC', from: '台北車站', to: 'R10' });
    expect(same.text).toBe('"台北車站" and "R10" are the same station.');
    const unknown = await t.call('metro_travel_time', { system: 'TRTC', from: '火星', to: '西門' });
    expect(unknown.text).toMatch(/^No TRTC station matches "火星"/);
    const island = await t.call('metro_travel_time', { system: 'TRTC', from: '孤島', to: '西門' });
    expect(island.text).toBe("No route from 孤島 / Z01 to 西門 / BL11 in TDX's TRTC data.");
  });
});
