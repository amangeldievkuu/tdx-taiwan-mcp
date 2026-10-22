import { describe, expect, it } from 'vitest';
import { normalize, search } from '../../src/core/names.js';

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
