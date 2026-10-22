import { afterEach, describe, expect, it } from 'vitest';
import { connect, loadFixture, type Route } from '../helpers.js';

const name = (Zh_tw: string, En: string) => ({ Zh_tw, En });
const TRTC_STATIONS = [
  { StationID: 'BL12', StationName: name('台北車站', 'Taipei Main Station') },
  { StationID: 'R10', StationName: name('台北車站', 'Taipei Main Station') },
  { StationID: 'BL22', StationName: name('南港', 'Nangang') },
  { StationID: 'BL01', StationName: name('頂埔', 'Dingpu') },
];

const ROUTES: Route[] = [
  ['/v2/Rail/Metro/Station/TRTC', TRTC_STATIONS],
  ['/v2/Rail/Metro/LiveBoard/TRTC', loadFixture('metro-live-board.json')],
  ['/v2/Rail/Metro/ODFare/TRTC', loadFixture('metro-od-fare.json')],
  ['/v2/Rail/Metro/FirstLastTimetable/TRTC', loadFixture('metro-first-last-timetable.json')],
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

describe('metro_live_board', () => {
  it('narrows the board to one station', async () => {
    const t = await setup();
    const result = await t.call('metro_live_board', { system: 'TRTC', station: 'Nangang' });
    expect(result.json.items).toEqual([
      {
        station: '南港 / Nangang',
        line: '板南線 / Bannan Line',
        to: '亞東醫院 / Far Eastern Hospital',
        arrival: 'arriving now',
        minutes: 0,
      },
    ]);
  });

  it('explains an empty Taipei board', async () => {
    const t = await setup();
    const result = await t.call('metro_live_board', { system: 'TRTC', station: '頂埔' });
    expect(result.json.total).toBe(0);
    expect(result.json.note).toMatch(/only arriving trains/);
  });

  it('turns service status into words', async () => {
    const t = await setup();
    const result = await t.call('metro_live_board', { system: 'TRTC' });
    expect(result.json.items.map((i) => i.arrival)).toContain('last train has passed');
  });
});

describe('metro_fare', () => {
  it('queries every ID of a station on two lines', async () => {
    const t = await setup();
    const result = await t.call('metro_fare', { system: 'TRTC', from: '台北車站', to: 'Dingpu' });
    expect(t.apiUrls.at(-1)).toMatch(
      /ODFare\/TRTC\?\$filter=\(OriginStationID eq 'BL12' or OriginStationID eq 'R10'\) and \(DestinationStationID eq 'BL01'\)&\$top=1&/,
    );
    expect(result.json).toEqual({
      system: 'TRTC',
      from: '台北車站 / Taipei Main Station',
      to: '頂埔 / Dingpu',
      distanceKm: 15.99,
      prices: {
        adult: 40,
        'child (NWT residents)': 16,
        'child (TPE residents)': 16,
        senior: 16,
      },
    });
  });

  it('rejects the same station', async () => {
    const t = await setup();
    const result = await t.call('metro_fare', { system: 'TRTC', from: '台北車站', to: 'BL12' });
    expect(result.text).toMatch(/same station/);
  });
});

describe('metro_first_last_train', () => {
  it('lists first and last trains per direction', async () => {
    const t = await setup();
    const result = await t.call('metro_first_last_train', { system: 'TRTC', station: '台北車站' });
    expect(result.json.items[0]).toEqual({
      station: '台北車站 / Taipei Main Station',
      line: 'BL',
      toward: '頂埔 / Dingpu',
      first: '06:00',
      last: '00:49',
      days: 'daily',
    });
  });
});
