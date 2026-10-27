import { describe, expect, it } from 'vitest';
import {
  clockOf,
  duration,
  hhmm,
  minutesBetween,
  padTime,
  startTime,
  taipeiNow,
} from '../../src/core/time.js';

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

describe('minutesBetween', () => {
  it('counts minutes between local flight times, across days and backwards', () => {
    expect(minutesBetween('2026-10-21T08:50', '2026-10-21T09:01')).toBe(11);
    expect(minutesBetween('2026-10-20T00:15', '2026-10-19T23:13')).toBe(-62);
    expect(minutesBetween('2026-10-21T08:50', undefined)).toBeUndefined();
  });
});

describe('padTime and clockOf', () => {
  it('pads ferry times and reads the clock of a timestamp', () => {
    expect(padTime('6:15')).toBe('06:15');
    expect(padTime('15:00')).toBe('15:00');
    expect(padTime('')).toBeUndefined();
    expect(clockOf('2026-10-21T11:10:00+08:00')).toBe('11:10');
    expect(clockOf(undefined)).toBeUndefined();
  });
});
