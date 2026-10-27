import { afterEach, describe, expect, it } from 'vitest';
import { flightStatus } from '../../src/tools/air.js';
import { API, connect, loadFixture, type Route } from '../helpers.js';

const TSA_BOARD = (loadFixture('air-fids-airport-tsa.json') as Array<Record<string, unknown>>)[0];

const ROUTES: Route[] = [
  ['/v2/Air/Airport', loadFixture('air-airport.json')],
  ['/v2/Air/Airline', loadFixture('air-airline.json')],
  ['/v2/Air/FIDS/Flight/100', loadFixture('air-fids-flight.json')],
  ['/v2/Air/FIDS/Airport/Departure/TPE', loadFixture('air-fids-departure-tpe.json')],
  ['/v2/Air/FIDS/Airport/Arrival/TPE', loadFixture('air-fids-arrival-tpe.json')],
  ['/v2/Air/FIDS/Airport/Departure/TSA', TSA_BOARD?.FIDSDeparture],
  ['/v2/Air/METAR/Airport/TPE', loadFixture('air-metar-tpe.json')],
  ['/v2/Air/DailyFlightSchedule/Domestic/AE', loadFixture('air-daily-schedule-ae.json')],
  ['/v2/Air/DailyFlightSchedule/Domestic/', []],
  ['/v2/Air/RouteFare/Domestic/AE', loadFixture('air-route-fare-ae.json')],
  ['/v2/Air/RouteFare/Domestic/', []],
];

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
});

async function setup(routes = ROUTES) {
  const t = await connect(routes);
  close = t.close;
  return t;
}

describe('flightStatus', () => {
  it('reads Chinese and English remarks', () => {
    expect(flightStatus('出發DEPARTED')).toBe('departed');
    expect(flightStatus('已飛')).toBe('departed');
    expect(flightStatus('預計出發')).toBe('expected');
    expect(flightStatus('取消CANCELLED')).toBe('cancelled');
    expect(flightStatus('已到ARRIVED')).toBe('arrived');
    expect(flightStatus('其他')).toBe('其他');
    expect(flightStatus('  ')).toBeUndefined();
  });
});

describe('flight_status', () => {
  it('fetches the flight number without a filter and shapes both legs', async () => {
    const t = await setup();
    const result = await t.call('flight_status', { flight: 'CI100' });
    expect(result.isError).toBe(false);
    expect(t.apiUrls).toContain(`${API}/v2/Air/FIDS/Flight/100?$format=JSON`);
    expect(result.json.items).toEqual([
      {
        flight: 'CI100',
        airline: '中華航空 / China Airlines',
        date: '2026-10-21',
        from: 'TPE 桃園國際機場 / Taoyuan',
        to: 'NRT',
        departure: {
          scheduled: '08:50',
          actual: '09:01',
          delayMinutes: 11,
          status: 'departed',
          terminal: '2',
          gate: 'D9',
        },
        checkCounter: '7',
        aircraft: 'A330-300',
      },
    ]);
  });

  it('accepts a spaced, zero-padded number', async () => {
    const t = await setup();
    const result = await t.call('flight_status', { flight: 'ci 0100' });
    expect(result.json.items[0]?.flight).toBe('CI100');
  });

  it('names the airlines that fly the number when the airline does not', async () => {
    const t = await setup();
    const result = await t.call('flight_status', { flight: 'BR100' });
    expect(result.json).toMatchObject({
      total: 0,
      note: "No BR100 in TDX's flight list; it lists CI100.",
    });
  });

  it('rejects input that is not a flight number without calling TDX', async () => {
    const t = await setup();
    const result = await t.call('flight_status', { flight: 'hello' });
    expect(result.isError).toBe(true);
    expect(t.apiUrls).toEqual([]);
  });
});

describe('flight_board', () => {
  it('lists passenger departures with delay, status and weather', async () => {
    const t = await setup();
    const result = await t.call('flight_board', {
      airport: '桃園',
      date: '2026-10-20',
      after: '00:00',
    });
    expect(result.json).toMatchObject({
      airport: 'TPE 桃園國際機場 / Taoyuan International Airport',
      direction: 'departures',
      date: '2026-10-20',
      weather: {
        description: '多雲時晴 / Mostly Cloudy',
        temperature: '26°C',
        wind: '40 degree 25 KT',
        visibility: '9999 M',
        ceiling: '800 FT',
      },
    });
    expect(result.json.items).toEqual([
      {
        flight: 'JX12',
        to: 'SFO',
        scheduled: '00:05',
        actual: '00:07',
        delayMinutes: 2,
        status: 'departed',
        terminal: '2',
        gate: 'D12',
        checkCounter: '9',
        aircraft: 'A350-900',
      },
      {
        flight: 'NZ78',
        to: 'AKL',
        scheduled: '18:35',
        status: 'cancelled',
        terminal: '2',
        aircraft: 'B787-9',
      },
    ]);
  });

  it('lists arrivals with trimmed gates and early arrivals', async () => {
    const t = await setup();
    const result = await t.call('flight_board', {
      airport: 'TPE',
      direction: 'arrivals',
      date: '2026-10-20',
      after: '00:00',
    });
    expect(result.json.items[0]).toMatchObject({
      flight: 'KE5759',
      from: 'ICN',
      gate: 'A8',
      delayMinutes: -2,
    });
    expect(result.json.items[1]).toMatchObject({
      flight: 'LJ763',
      actual: '2026-10-19 23:13',
      delayMinutes: -62,
      baggageClaim: '04',
    });
  });

  it('works without weather, puts flights without a time last and filters by the other airport', async () => {
    const t = await setup();
    const result = await t.call('flight_board', {
      airport: 'Songshan',
      date: '2026-10-21',
      after: '00:00',
      otherAirport: '南竿',
    });
    expect(result.isError).toBe(false);
    expect(result.json.weather).toBeUndefined();
    expect(result.json.items).toEqual([
      {
        flight: 'B78751',
        to: 'LZN',
        scheduled: '06:30',
        actual: '06:24',
        delayMinutes: -6,
        status: 'departed',
        terminal: '2',
        gate: '13',
      },
      { flight: 'B79091', to: 'LZN', status: 'expected' },
    ]);
    const none = await t.call('flight_board', {
      airport: 'TSA',
      date: '2026-10-21',
      after: '00:00',
      otherAirport: 'KNH',
    });
    expect(none.json.total).toBe(0);
  });

  it('reports ambiguous and unknown airports', async () => {
    const t = await setup();
    const taipei = await t.call('flight_board', { airport: 'Taipei' });
    expect(taipei.isError).toBe(true);
    expect(taipei.text).toMatch(/matches several Taiwan airports: 桃園國際機場、臺北松山機場/);
    const atlantis = await t.call('flight_board', { airport: 'Atlantis' });
    expect(atlantis.text).toMatch(/^No Taiwan airport matches "Atlantis"/);
    expect(t.apiUrls).toEqual([]);
  });
});

describe('flight_schedule', () => {
  it('lists the day of each domestic airline on the route, with fares', async () => {
    const t = await setup();
    const result = await t.call('flight_schedule', {
      from: 'Hualien',
      to: '高雄',
      date: '2026-10-22',
    });
    expect(t.apiUrls).toContain(
      `${API}/v2/Air/DailyFlightSchedule/Domestic/AE?$filter=FlightDate eq '2026-10-22'&$format=JSON`,
    );
    expect(result.json).toMatchObject({
      from: 'HUN 花蓮機場 / Hualien Airport',
      to: 'KHH 高雄國際機場 / Kaohsiung International Airport',
      date: '2026-10-22',
      fares: {
        AE: { adult: 2329, child: 1747, senior: 1165, militaryPolice: 2213, companion: 1165 },
      },
    });
    expect(result.json.items).toEqual([
      {
        flight: 'AE7932',
        airline: '華信航空 / Mandarin Airlines',
        departs: '20:30',
        arrives: '21:35',
        duration: '1h 05m',
        status: 'cancelled',
      },
    ]);
  });

  it('notes an empty route and an airline TDX did not answer for', async () => {
    const t = await setup([
      ['/v2/Air/DailyFlightSchedule/Domestic/DA', () => new Response('{}', { status: 500 })],
      ...ROUTES,
    ]);
    const result = await t.call('flight_schedule', { from: 'TSA', to: 'KNH', date: '2026-10-22' });
    expect(result.json.total).toBe(0);
    expect(result.json.note).toBe(
      'No scheduled AE, B7 or DA flight from TSA to KNH on 2026-10-22 after 00:00. TDX did not answer for DA.',
    );
  });
});
