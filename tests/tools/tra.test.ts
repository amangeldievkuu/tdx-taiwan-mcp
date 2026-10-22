import { afterEach, describe, expect, it } from 'vitest';
import { API, connect, loadFixture, type Route } from '../helpers.js';

const BANQIAO = { StationID: '1020', StationName: { Zh_tw: '板橋', En: 'Banqiao' } };
const stations = loadFixture('tra-station.json') as { Stations: unknown[] };

const ROUTES: Route[] = [
  ['/v3/Rail/TRA/Station?', { ...stations, Stations: [...stations.Stations, BANQIAO] }],
  ['/v3/Rail/TRA/DailyTrainTimetable/OD/1000/to/4400/', loadFixture('tra-timetable.json')],
  ['/v3/Rail/TRA/ODFare/1000/to/4400', loadFixture('tra-od-fare.json')],
  ['/v3/Rail/TRA/StationLiveBoard/Station/1020', loadFixture('tra-station-live-board.json')],
  ['/v3/Rail/TRA/DailyTrainTimetable/Today/TrainNo/1006', loadFixture('tra-daily-timetable.json')],
  ['/v3/Rail/TRA/TrainLiveBoard/TrainNo/1006', loadFixture('tra-train-live-board.json')],
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

describe('tra_timetable', () => {
  it('lists trains with type, times and facilities', async () => {
    const t = await setup();
    const result = await t.call('tra_timetable', {
      from: '台北',
      to: 'Kaohsiung',
      date: '2026-10-22',
      after: '00:00',
    });
    expect(t.apiUrls).toContain(
      `${API}/v3/Rail/TRA/DailyTrainTimetable/OD/1000/to/4400/2026-10-22?$format=JSON`,
    );
    expect(result.json).toMatchObject({ from: '臺北 / Taipei', to: '高雄 / Kaohsiung', total: 2 });
    expect(result.json.items[0]).toEqual({
      trainNo: '103',
      type: '自強 Tze-Chiang',
      departs: '06:27',
      arrives: '11:34',
      duration: '5h 07m',
      headsign: '往潮州',
      line: 'coast line (海線)',
      wheelchair: true,
    });
  });
});

describe('tra_fare', () => {
  it('keeps the shorter way round per train type', async () => {
    const t = await setup();
    const result = await t.call('tra_fare', { from: '臺北', to: '高雄' });
    expect(result.json.items).toEqual([
      {
        trainType: '自強 Tze-Chiang',
        distanceKm: 371.4,
        prices: { adult: 994, child: 497, senior: 497 },
      },
      {
        trainType: '區間 Local',
        distanceKm: 371.4,
        prices: { adult: 640, child: 320, senior: 320 },
      },
    ]);
  });
});

describe('tra_live_board', () => {
  it('shows delay and status per train', async () => {
    const t = await setup();
    const result = await t.call('tra_live_board', { station: '板橋' });
    expect(t.apiUrls).toContain(`${API}/v3/Rail/TRA/StationLiveBoard/Station/1020?$format=JSON`);
    expect(result.json.items[0]).toEqual({
      trainNo: '270',
      type: '自強 Tze-Chiang',
      to: '花蓮 / Hualien',
      arrives: '09:45',
      departs: '09:47',
      delayMinutes: 4,
      status: 'delayed',
      line: 'mountain line (山線)',
    });
  });
});

describe('tra_train', () => {
  it('combines today’s stops with the live position', async () => {
    const t = await setup();
    const result = await t.call('tra_train', { trainNo: '1006' });
    expect(result.json).toMatchObject({
      trainNo: '1006',
      type: '區間快 Fast Local',
      from: '潮州 / Chaozhou',
      to: '七堵 / Qidu',
      bikes: true,
      live: { position: 'departed from 社頭 / Shetou', delayMinutes: 1 },
    });
    expect((result.json.stops as unknown[]).length).toBe(46);
    // "每日行駛。" alone is dropped.
    expect(result.json.note).toBeUndefined();
  });
});
