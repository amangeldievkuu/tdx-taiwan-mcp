import { afterEach, describe, expect, it } from 'vitest';
import { connect, loadFixture } from '../helpers.js';

const stations = loadFixture('afr-station.json') as { Stations: unknown[] };
const LUMACHAN = { StationID: '362', StationName: { Zh_tw: '鹿麻產', En: 'Lumachan' } };

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
});

async function setup() {
  const t = await connect([
    ['/v3/Rail/AFR/Station', { ...stations, Stations: [...stations.Stations, LUMACHAN] }],
    ['/v3/Rail/AFR/GeneralTrainTimetable', loadFixture('afr-general-timetable.json')],
  ]);
  close = t.close;
  return t;
}

describe('afr_timetable', () => {
  it('lists trains between two stations', async () => {
    const t = await setup();
    const result = await t.call('afr_timetable', { from: '嘉義', to: 'Lumachan' });
    expect(result.json.items).toEqual([
      {
        trainNo: '1',
        headsign: '往十字路',
        from: '嘉義 / Chiayi',
        departs: '09:00',
        to: '鹿麻產 / Lumachan',
        arrives: '09:32',
        duration: '32m',
        note: '請參閱官網',
      },
    ]);
    expect(result.json.effective).toBe('2024-02-15');
  });

  it('finds nothing in the other direction', async () => {
    const t = await setup();
    const result = await t.call('afr_timetable', { from: '鹿麻產', to: '嘉義' });
    expect(result.json.total).toBe(0);
    expect(result.json.note).toMatch(/No regular train/);
  });
});
