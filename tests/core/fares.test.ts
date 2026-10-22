import { describe, expect, it } from 'vitest';
import { fareTable } from '../../src/core/fares.js';

describe('fareTable', () => {
  it('groups single-journey fares by cabin and passenger type', () => {
    expect(
      fareTable(
        [
          { TicketType: 1, FareClass: 1, CabinClass: 1, Price: 1490 },
          { TicketType: 1, FareClass: 1, CabinClass: 2, Price: 2440 },
          { TicketType: 1, FareClass: 9, CabinClass: 1, Price: 745 },
          { TicketType: 8, FareClass: 1, CabinClass: 1, Price: 1415 },
        ],
        { 9: 'statutoryDiscount' },
      ),
    ).toEqual({
      standard: { adult: 1490, statutoryDiscount: 745 },
      business: { adult: 2440 },
    });
  });

  it('is flat with one cabin, and keys residents-only prices', () => {
    expect(
      fareTable([
        { TicketType: 1, FareClass: 1, Price: 40 },
        { TicketType: 1, FareClass: 3, CitizenCode: 'TPE', Price: 16 },
        { TicketType: 1, FareClass: 4, CitizenCode: 'OTHERS', Price: 16 },
      ]),
    ).toEqual({ adult: 40, 'child (TPE residents)': 16, senior: 16 });
  });
});
