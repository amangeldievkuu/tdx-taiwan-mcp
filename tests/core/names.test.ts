import { describe, expect, it } from 'vitest';
import { ToolInputError } from '../../src/core/errors.js';
import { normalize, resolve, search } from '../../src/core/names.js';

describe('normalize', () => {
  it('folds 台 to 臺, case, width, spaces and punctuation', () => {
    expect(normalize('台北車站')).toBe(normalize('臺北車站'));
    expect(normalize('ＭＲＴ Ximen Sta.')).toBe('mrtximensta');
    expect(normalize('臺北車站(忠孝西路)')).toBe('臺北車站忠孝西路');
  });

  it('treats "Station" and "Sta." alike', () => {
    expect(normalize('Taipei Main Station')).toBe(normalize('Taipei Main Sta.'));
  });
});

describe('search', () => {
  const routes = ['紅50', '307西藏三民', '307', '紅5', '綠1'];

  it('ranks exact, then prefix, then contains matches, keeping input order on ties', () => {
    expect(search(routes, (r) => [r], '307')).toEqual(['307', '307西藏三民']);
    expect(search(routes, (r) => [r], '紅5')).toEqual(['紅5', '紅50']);
    expect(search(routes, (r) => [r], '三民')).toEqual(['307西藏三民']);
  });

  it('tries every name and ignores missing ones', () => {
    const items = [
      { zh: '捷運西門站', en: null },
      { zh: '撫遠街', en: 'Fuyuan St.' },
    ];
    expect(search(items, (i) => [i.zh, i.en], 'fuyuan')).toEqual([items[1]]);
  });

  it('returns nothing when nothing matches', () => {
    expect(search(routes, (r) => [r], '999')).toEqual([]);
  });
});

describe('search with station suffixes', () => {
  it('matches 臺北 for "台北車站" and Taipei for "Taipei Main Station"', () => {
    const items = [
      { zh: '臺北', en: 'Taipei' },
      { zh: '新北投', en: 'Xinbeitou' },
    ];
    expect(search(items, (i) => [i.zh, i.en], '台北車站')).toEqual([items[0]]);
    expect(search(items, (i) => [i.zh, i.en], 'Taipei Main Station')).toEqual([items[0]]);
  });
});

describe('resolve', () => {
  const stations = [
    { id: '1000', zh: '臺北', en: 'Taipei' },
    { id: '1210', zh: '新竹', en: 'Hsinchu' },
    { id: '1190', zh: '北新竹', en: 'North Hsinchu' },
    { id: 'BL12', zh: '台北車站', en: 'Taipei Main Station' },
    { id: 'R10', zh: '台北車站', en: 'Taipei Main Station' },
    { id: '3300', zh: '臺中', en: 'Taichung' },
    { id: '3360', zh: '彰化', en: 'Changhua' },
  ];
  const options = {
    names: (s: (typeof stations)[number]) => [s.zh, s.en],
    ids: (s: (typeof stations)[number]) => [s.id],
    label: 'station',
  };

  it('prefers an ID, then an exact name over partial ones', () => {
    expect(resolve(stations, 'r10', options).map((s) => s.id)).toEqual(['R10']);
    expect(resolve(stations, '新竹', options).map((s) => s.id)).toEqual(['1210']);
    expect(resolve(stations, 'hsinchu', options).map((s) => s.id)).toEqual(['1210']);
  });

  it('returns every station sharing the matched name', () => {
    expect(resolve(stations, '台北車站', options).map((s) => s.id)).toEqual(['BL12', 'R10']);
  });

  it('returns every best match under different names with many', () => {
    const many = { ...options, many: true };
    expect(resolve(stations, '臺', many).map((s) => s.id)).toEqual(['1000', 'BL12', 'R10', '3300']);
  });

  it('accepts a unique partial match', () => {
    expect(resolve(stations, '彰', options).map((s) => s.id)).toEqual(['3360']);
  });

  it('rejects ambiguous partial matches, listing them', () => {
    expect(() => resolve(stations, '竹', options)).toThrow(ToolInputError);
    expect(() => resolve(stations, '竹', options)).toThrow(
      '"竹" matches several stations: 新竹、北新竹',
    );
  });

  it('lists known names when nothing matches', () => {
    expect(() => resolve(stations, '花蓮', options)).toThrow(
      /^No station matches "花蓮"\. Known: 臺北、新竹/,
    );
  });
});
