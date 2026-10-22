import { describe, expect, it } from 'vitest';
import { duration, hhmm, startTime, taipeiNow } from '../../src/core/time.js';

describe('taipeiNow', () => {
  it('gives the date and time in Taiwan, whatever the machine time zone', () => {
    expect(taipeiNow(new Date('2026-10-20T16:30:00Z'))).toEqual({
      date: '2026-10-21',
      time: '00:30',
    });
    expect(taipeiNow(new Date('2026-10-21T03:05:00Z'))).toEqual({
      date: '2026-10-21',
      time: '11:05',
    });
  });
});

describe('duration', () => {
  it('formats hours and minutes, across midnight', () => {
    expect(duration('06:26', '08:40')).toBe('2h 14m');
    expect(duration('09:00', '09:45')).toBe('45m');
    expect(duration('23:30', '01:05')).toBe('1h 35m');
    expect(duration('09:00', null)).toBeUndefined();
  });
});

describe('hhmm', () => {
  it('drops seconds', () => {
    expect(hhmm('09:47:30')).toBe('09:47');
    expect(hhmm(null)).toBeUndefined();
  });
});

describe('startTime', () => {
  const now = { date: '2026-10-21', time: '11:05' };
  it('uses after, else now for today, else midnight', () => {
    expect(startTime('2026-10-21', '08:00', now)).toBe('08:00');
    expect(startTime('2026-10-21', undefined, now)).toBe('11:05');
    expect(startTime('2026-10-22', undefined, now)).toBe('00:00');
  });
});
