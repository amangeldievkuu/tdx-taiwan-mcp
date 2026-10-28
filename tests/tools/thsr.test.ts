import { afterEach, describe, expect, it } from 'vitest';
import { API, connect, loadFixture, type Route } from '../helpers.js';

const ROUTES: Route[] = [
  ['/v2/Rail/THSR/Station', loadFixture('thsr-station.json')],
  ['/v2/Rail/THSR/DailyTimetable/OD/1000/to/1070/', loadFixture('thsr-timetable.json')],
  [
    '/v2/Rail/THSR/AvailableSeatStatus/Train/OD/1000/to/1070/',
    loadFixture('thsr-od-seat-status.json'),
  ],
  ['/v2/Rail/THSR/ODFare/1000/to/1070', loadFixture('thsr-od-fare.json')],
  ['/v2/Rail/THSR/DailyTimetable/TrainNo/0108/', loadFixture('thsr-daily-timetable.json')],
  ['/v2/Rail/THSR/DailyTimetable/TrainNo/', []],
  ['/v2/Rail/THSR/DailyFreeSeatingCar/TrainDate/', loadFixture('thsr-free-seating-car.json')],
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

describe('thsr_timetable', () => {
  it('resolves names, sorts by departure and computes travel time', async () => {
    const t = await setup();
    const result = await t.call('thsr_timetable', {
      from: '台北車站',
      to: 'Zuoying',
      date: '2026-10-21',
    });
    expect(t.apiUrls).toContain(
      `${API}/v2/Rail/THSR/DailyTimetable/OD/1000/to/1070/2026-10-21?$format=JSON`,
    );
    expect(result.json).toMatchObject({
      from: '台北 / Taipei',
      to: '左營 / Zuoying',
      date: '2026-10-21',
      after: '00:00',
    });
    expect(result.json.items).toEqual([
      {
        trainNo: '0803',
        departs: '06:26',
        arrives: '08:40',
        duration: '2h 14m',
        direction: 'southbound',
        runs: '南港 → 左營',
      },
      expect.objectContaining({ trainNo: '0203', departs: '06:30', duration: '1h 45m' }),
    ]);
  });

  it('applies after, and accepts station IDs and codes', async () => {
    const t = await setup();
    const result = await t.call('thsr_timetable', {
      from: 'TPE',
      to: '1070',
      date: '2026-10-21',
      after: '06:28',
    });
    expect(result.json.items.map((i) => i.trainNo)).toEqual(['0203']);
  });

  it('rejects the same station twice and unknown stations', async () => {
    const t = await setup();
    const same = await t.call('thsr_timetable', { from: '台北', to: 'Taipei' });
    expect(same.isError).toBe(true);
    expect(same.text).toMatch(/same THSR station/);
    const unknown = await t.call('thsr_timetable', { from: '花蓮', to: '台北' });
    expect(unknown.text).toBe('No THSR station matches "花蓮". Known: 台北、左營.');
  });
});

describe('thsr_seats', () => {
  it('joins seat status with departure times', async () => {
    const t = await setup();
    const result = await t.call('thsr_seats', {
      from: '台北',
      to: '左營',
      date: '2026-10-22',
      after: '00:00',
    });
    expect(result.json.items).toEqual([
      { trainNo: '0112', standard: 'available', business: 'available' },
    ]);
    expect(result.json.updated).toBe('2026-10-22T10:00:02+08:00');
  });
});

describe('thsr_fare', () => {
  it('returns single-journey prices per car and passenger type', async () => {
    const t = await setup();
    const result = await t.call('thsr_fare', { from: '台北', to: '左營' });
    expect(result.json).toEqual({
      from: '台北 / Taipei',
      to: '左營 / Zuoying',
      prices: {
        standard: { adult: 1490, statutoryDiscount: 745 },
        business: { adult: 2440, statutoryDiscount: 1220 },
        nonReserved: { adult: 1445, statutoryDiscount: 720 },
      },
    });
  });
});

describe('thsr_train', () => {
  it('pads the train number and lists its stops', async () => {
    const t = await setup();
    const result = await t.call('thsr_train', { trainNo: '108', date: '2026-10-22' });
    expect(t.apiUrls.sort()).toEqual([
      `${API}/v2/Rail/THSR/DailyFreeSeatingCar/TrainDate/2026-10-22?$format=JSON`,
      `${API}/v2/Rail/THSR/DailyTimetable/TrainNo/0108/TrainDate/2026-10-22?$format=JSON`,
    ]);
    expect(result.json).toMatchObject({
      trainNo: '0108',
      direction: 'northbound',
      from: '左營 / Zuoying',
      to: '南港 / Nangang',
      nonReservedCars: [10, 11, 12],
    });
    expect((result.json.stops as unknown[])[1]).toEqual({
      station: '台中 / Taichung',
      arrives: '08:37',
      departs: '08:39',
    });
  });

  it('reports a train that does not run', async () => {
    const t = await setup();
    const result = await t.call('thsr_train', { trainNo: '9999', date: '2026-10-22' });
    expect(result.text).toBe('No THSR train 9999 runs on 2026-10-22.');
  });
});
