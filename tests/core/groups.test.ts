import { describe, expect, it } from 'vitest';
import { parseToolGroups, TOOL_GROUPS } from '../../src/core/groups.js';

describe('parseToolGroups', () => {
  it('loads every group by default, or for all', () => {
    expect(parseToolGroups(undefined)).toEqual({ groups: [...TOOL_GROUPS], unknown: [] });
    expect(parseToolGroups('')).toEqual({ groups: [...TOOL_GROUPS], unknown: [] });
    expect(parseToolGroups(' ALL ').groups).toEqual([...TOOL_GROUPS]);
  });

  it('takes a list, in any order, case or separator', () => {
    expect(parseToolGroups('Rail, bus').groups).toEqual(['bus', 'rail']);
    expect(parseToolGroups('flight ferry').groups).toEqual(['flight', 'ferry']);
  });

  it('leaves out excluded groups, from every group or from a list', () => {
    expect(parseToolGroups('-road,-raw').groups).toEqual([
      'bike',
      'bus',
      'rail',
      'flight',
      'ferry',
      'parking',
      'ev',
    ]);
    expect(parseToolGroups('bus,rail,-rail').groups).toEqual(['bus']);
    expect(parseToolGroups('all,-bike').groups).not.toContain('bike');
    expect(parseToolGroups('-all').groups).toEqual([]);
  });

  it('reports unknown names', () => {
    expect(parseToolGroups('bus,trains,-boats')).toEqual({
      groups: ['bus'],
      unknown: ['trains', 'boats'],
    });
    expect(parseToolGroups('trains')).toEqual({ groups: [], unknown: ['trains'] });
  });
});
