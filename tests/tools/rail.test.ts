import { afterEach, describe, expect, it } from 'vitest';
import { connect, loadFixture } from '../helpers.js';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
});

async function setup() {
  const t = await connect([
    ['/v2/Rail/THSR/Station', loadFixture('thsr-station.json')],
    ['/v2/Rail/THSR/AlertInfo', loadFixture('thsr-alert.json')],
    ['/v3/Rail/TRA/Alert', loadFixture('tra-alert.json')],
    ['/v2/Rail/Metro/Alert/TRTC', loadFixture('metro-alert-trtc.json')],
  ]);
  close = t.close;
  return t;
}

describe('rail_station_search', () => {
  it('sorts by distance from a coordinate', async () => {
    const t = await setup();
    const result = await t.call('rail_station_search', { system: 'THSR', lat: 22.7, lon: 120.3 });
    expect(result.json.items.map((i) => i.id)).toEqual(['1070', '1000']);
    expect(result.json.items[0]?.distanceMeters).toBeLessThan(2_000);
  });

  it('filters by keyword', async () => {
    const t = await setup();
    const result = await t.call('rail_station_search', { system: 'THSR', keyword: 'zuo' });
    expect(result.json.items).toEqual([
      expect.objectContaining({
        id: '1070',
        name: '左營 / Zuoying',
        address: '高雄市左營區高鐵路105號',
      }),
    ]);
  });
});

describe('rail_alerts', () => {
  it.each([
    ['THSR', '全線營運正常(Normal)'],
    ['TRA', '全線營運正常'],
    ['TRTC', '正常營運'],
  ])('reports normal service for %s', async (system, title) => {
    const t = await setup();
    const result = await t.call('rail_alerts', { system });
    expect(result.json.items).toEqual([expect.objectContaining({ title, status: 'normal' })]);
    // Placeholder times and descriptions that repeat the title are left out.
    expect(result.json.items[0]?.start).toBeUndefined();
    expect(result.json.items[0]?.description).toBeUndefined();
  });
});
