import { afterEach, describe, expect, it, vi } from 'vitest';
import { API, connect, loadFixture, type Route } from '../helpers.js';

/** A station as the station lists give it, with what the name lookup needs. */
function station(StationID: string, Zh_tw: string, En: string) {
  return { StationID, StationName: { Zh_tw, En }, StationPosition: {} };
}

// The station lists hold the stations the timetable, exit and facility fixtures belong to.
const METRO_STATIONS = [station('BL01', '頂埔', 'Dingpu'), station('BR13', '大直', 'Dazhi')];
const THSR_STATIONS = [station('0990', '南港', 'Nangang'), station('1000', '台北', 'Taipei')];
const TRA_STATIONS = {
  Stations: [
    station('1000', '臺北', 'Taipei'),
    station('0900', '基隆', 'Keelung'),
    station('7250', '龜山', 'Guishan'),
  ],
};

const ROUTES: Route[] = [
  ['/v2/Rail/Metro/Station/TRTC', METRO_STATIONS],
  ["StationTimeTable/TRTC?$filter=StationID eq 'BR13'", []],
  ['/v2/Rail/Metro/StationTimeTable/TRTC', loadFixture('metro-station-timetable-trtc.json')],
  ['/v2/Rail/Metro/StationExit/TRTC', loadFixture('metro-station-exit-trtc.json')],
  ['/v2/Rail/Metro/StationFacility/TRTC', loadFixture('metro-station-facility-trtc.json')],
  ['/v2/Rail/Metro/Frequency/TRTC', loadFixture('metro-frequency-trtc.json')],
  // Exits and facilities before the station lists, whose paths are their prefix.
  ['/v2/Rail/THSR/StationExit', loadFixture('thsr-station-exit.json')],
  ['/v2/Rail/THSR/Station', THSR_STATIONS],
  ['/v2/Rail/THSR/DailyTimetable/Station/1000/', loadFixture('thsr-station-timetable.json')],
  ['/v3/Rail/TRA/StationExit', loadFixture('tra-station-exit.json')],
  ['/v3/Rail/TRA/StationFacility', loadFixture('tra-station-facility.json')],
  ['/v3/Rail/TRA/Station', TRA_STATIONS],
  ['/v3/Rail/TRA/DailyStationTimetable/', loadFixture('tra-station-timetable.json')],
  ['/v3/Rail/AFR/Station', loadFixture('afr-station.json')],
  ['/v3/Rail/AFR/ODFare/360/to/361', loadFixture('afr-od-fare.json')],
  ['/v3/Rail/AFR/TrainType', loadFixture('afr-train-type.json')],
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

describe('rail_station_departures', () => {
  it("lists today's TRA departures, leaving out trains that end here", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T04:00:00+08:00'));
    const t = await setup();
    const result = await t.call('rail_station_departures', {
      system: 'TRA',
      station: '台北',
      after: '05:00',
    });
    expect(t.apiUrls).toContain(
      `${API}/v3/Rail/TRA/DailyStationTimetable/Today/Station/1000?$format=JSON`,
    );
    expect(result.json).toMatchObject({ station: '臺北 / Taipei', date: '2026-10-21', total: 2 });
    expect(result.json.items[0]).toMatchObject({
      departs: '05:26',
      trainNo: '4128',
      type: '區間 Local',
      direction: '順行 clockwise',
    });
  });

  it('reads another day of TRA from the daily list, filtered on the station', async () => {
    const t = await setup();
    await t.call('rail_station_departures', { system: 'TRA', station: '1000', date: '2026-11-03' });
    expect(t.apiUrls).toContain(
      `${API}/v3/Rail/TRA/DailyStationTimetable/TrainDate/2026-11-03?$filter=StationID eq '1000'` +
        '&$format=JSON',
    );
  });

  it('lists THSR departures with their terminus, and filters on it', async () => {
    const t = await setup();
    const result = await t.call('rail_station_departures', {
      system: 'THSR',
      station: 'Taipei',
      date: '2026-10-22',
      toward: 'Zuoying',
    });
    expect(result.json.items).toEqual([
      { departs: '06:26', trainNo: '0803', toward: '左營 / Zuoying', direction: 'southbound' },
      { departs: '06:30', trainNo: '0203', toward: '左營 / Zuoying', direction: 'southbound' },
    ]);
    const north = await t.call('rail_station_departures', {
      system: 'THSR',
      station: 'Taipei',
      date: '2026-10-22',
      toward: '南港',
    });
    expect(north.json).toMatchObject({
      total: 0,
      note: 'No departures from this station on 2026-10-22 after 00:00 toward "南港".',
    });
  });

  it('uses the metro timetable of the day of the week', async () => {
    const t = await setup();
    const saturday = await t.call('rail_station_departures', {
      system: 'TRTC',
      station: '頂埔',
      date: '2026-10-24',
    });
    expect(t.apiUrls).toContain(
      `${API}/v2/Rail/Metro/StationTimeTable/TRTC?$filter=StationID eq 'BL01'&$format=JSON`,
    );
    expect(saturday.json.items).toEqual([
      { departs: '06:00', line: 'BL', toward: '南港展覽館 / Taipei Nangang Exhibition Center' },
      expect.objectContaining({ departs: '06:07' }),
      expect.objectContaining({ departs: '06:15' }),
    ]);
    const monday = await t.call('rail_station_departures', {
      system: 'TRTC',
      station: '頂埔',
      date: '2026-10-26',
    });
    expect(monday.json.total).toBe(0);
  });

  it('points Wenhu line stations to metro_frequency', async () => {
    const t = await setup();
    const result = await t.call('rail_station_departures', { system: 'TRTC', station: '大直' });
    expect(result.json.note).toBe(
      'The Wenhu line (文湖線) runs by frequency and has no timetable; see metro_frequency.',
    );
  });
});

describe('rail_station_info', () => {
  it('lists metro exits nearest to a destination first, with the station maps', async () => {
    const t = await setup();
    const result = await t.call('rail_station_info', {
      system: 'TRTC',
      station: '頂埔',
      lat: 24.95931,
      lon: 121.419,
    });
    expect(result.json.items.map((i) => [i.exit, i.distanceMeters])).toEqual([
      ['頂埔站出口2 / Dingpu Exit 2', 0],
      ['頂埔站出口1 / Dingpu Exit 1', 67],
    ]);
    expect(result.json.items[1]).toMatchObject({
      where: '中央路4段約100號旁',
      stairs: true,
      escalator: 'exit only',
      elevator: true,
    });
    expect(result.json.facilities).toBeUndefined();
    expect(result.json.maps).toEqual([
      'https://web.metro.taipei/img/ALL/INFOPDF/076.pdf',
      'https://web.metro.taipei/img/ALL/Route2200/076.jpg',
    ]);
  });

  it('reads THSR and TRA exits, and skips facilities without a description', async () => {
    const t = await setup();
    const thsr = await t.call('rail_station_info', { system: 'THSR', station: '南港' });
    expect(thsr.json.items.map((i) => [i.exit, i.escalator])).toEqual([
      ['北出口 / North Exit', 'yes'],
      ['南出口 / South Exit', 'yes'],
    ]);
    const keelung = await t.call('rail_station_info', { system: 'TRA', station: '基隆' });
    expect(keelung.json.items).toEqual([
      expect.objectContaining({
        exit: '南站 (中山一路) / S Station (Zhongshan 1st Rd.)',
        stairs: false,
        escalator: 'both ways',
      }),
    ]);
    const guishan = await t.call('rail_station_info', { system: 'TRA', station: '龜山' });
    expect(guishan.json).toMatchObject({ total: 0, note: 'TDX lists no exits for this station.' });
    expect(guishan.json.facilities).toBeUndefined();
    expect(guishan.json.maps).toHaveLength(1);
  });
});

describe('metro_frequency', () => {
  it("gives the headways of the day's kind, by line", async () => {
    const t = await setup();
    const weekday = await t.call('metro_frequency', {
      system: 'TRTC',
      line: 'bl',
      date: '2026-10-26',
    });
    expect(weekday.json).toMatchObject({ days: '平日', total: 1 });
    expect(weekday.json.items[0]).toMatchObject({
      line: 'BL',
      route: 'BL-1',
      hours: '06:00–24:00',
    });
    expect((weekday.json.items[0]?.headways as unknown[])[0]).toEqual({
      from: '06:00',
      to: '07:00',
      everyMinutes: '8–10',
    });
    const saturday = await t.call('metro_frequency', { system: 'TRTC', date: '2026-10-24' });
    expect(saturday.json.days).toBe('假日');
    const red = await t.call('metro_frequency', { system: 'TRTC', line: 'R', date: '2026-10-26' });
    expect(red.json.note).toBe('TDX lists no frequency for line R of TRTC on a Monday.');
  });
});

describe('afr_fare', () => {
  it('lists fares per train type, named from the train type list', async () => {
    const t = await setup();
    const result = await t.call('afr_fare', { from: '嘉義', to: '北門' });
    expect(result.json).toMatchObject({ from: '嘉義 / Chiayi', to: '北門 / Beimen' });
    expect(result.json.items).toEqual([
      { trainType: '中興號 / Jungshing Express', prices: { adult: 45, student: 23 } },
      { trainType: '阿里山號 / Alishan Express', prices: { adult: 50, student: 25 } },
    ]);
    const same = await t.call('afr_fare', { from: '嘉義', to: '360' });
    expect(same.text).toBe('"嘉義" and "360" are the same AFR station.');
  });
});
