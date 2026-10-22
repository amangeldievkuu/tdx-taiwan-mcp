import { describe, expect, it } from 'vitest';
import { normalizeCity } from '../../src/core/cities.js';

describe('normalizeCity', () => {
  it.each([
    ['Taipei', 'Taipei'],
    ['taipei', 'Taipei'],
    ['New Taipei City', 'NewTaipei'],
    ['new-taipei', 'NewTaipei'],
    ['Hsinchu County', 'HsinchuCounty'],
    ['臺北市', 'Taipei'],
    ['台北市', 'Taipei'],
    ['台北', 'Taipei'],
    ['新竹', 'Hsinchu'],
    ['新竹縣', 'HsinchuCounty'],
    ['臺東縣', 'TaitungCounty'],
  ])('%s → %s', (input, code) => {
    expect(normalizeCity(input)).toBe(code);
  });

  it('passes unknown values through, trimmed', () => {
    expect(normalizeCity(' Atlantis ')).toBe('Atlantis');
  });
});
