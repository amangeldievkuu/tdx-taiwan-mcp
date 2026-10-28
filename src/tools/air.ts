import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  odata,
  TdxApiError,
  type AirArrival,
  type AirDeparture,
  type AirFlight,
  type AirGeneralSchedule,
  type AirMetar,
} from 'tdx-taiwan';
import { z } from 'zod';
import type { ToolContext } from '../core/context.js';
import { ToolInputError } from '../core/errors.js';
import { fareTable } from '../core/fares.js';
import { compact, name } from '../core/format.js';
import { search } from '../core/names.js';
import { list, ok } from '../core/respond.js';
import { after, date, limit, take } from '../core/schemas.js';
import { clock, duration, minutesBetween, startTime, taipeiNow } from '../core/time.js';
import { defineTool } from '../core/tool.js';
import { findAirport, TAIWAN_AIRPORTS } from './air-airports.js';

/** `CI100`, `ci 0100`, `B7 8751`, `7C2101`, or the digits alone. */
const FLIGHT = /^([A-Za-z]{2}|[A-Za-z]\d|\d[A-Za-z])?\s*-?\s*0*(\d{1,4})$/;

/** Remark keywords, first match wins: TPE writes `出發DEPARTED`, the domestic airports `已飛`. */
const REMARKS: Array<[RegExp, string]> = [
  [/取消|CANCEL/i, 'cancelled'],
  [/延誤|DELAY/i, 'delayed'],
  // Before "departed": TSA writes 預計出發 for a flight that has not left.
  [/預計|ESTIMATE/i, 'expected'],
  [/已飛|出發|DEPARTED/i, 'departed'],
  [/已到|抵達|到站|ARRIVED|LANDED/i, 'arrived'],
  [/登機|BOARD/i, 'boarding'],
  [/報到|CHECK/i, 'check-in'],
  [/準時|ON TIME/i, 'on time'],
  [/更改|改時|CHANG/i, 'time changed'],
];

/** The domestic airlines with daily schedules and fares on TDX. */
const DOMESTIC_AIRLINES: Record<string, string> = {
  AE: '華信航空 / Mandarin Airlines',
  B7: '立榮航空 / UNI Air',
  DA: '德安航空 / Daily Air',
};
const SCHEDULE_REMARK: Record<string, string> = { X: 'cancelled', S: 'code share' };
const SEATS: Record<number, string> = { 1: 'available', 2: 'fewer than 5 left', 3: 'sold out' };
const CABIN: Record<number, string> = {
  1: 'first',
  2: 'business',
  3: 'premium economy',
  4: 'economy',
};
const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
const FARE_CLASS = {
  8: 'militaryPolice',
  9: 'countyDisabled',
  10: 'countyCompanion',
  11: 'promotion',
};

const airport = (role: string) =>
  z
    .string()
    .trim()
    .min(1)
    .describe(
      `${role} Taiwan airport: IATA code (TPE, TSA, KHH, KNH) or name (松山, 金門, Hualien).`,
    );

export function registerAirTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, 'flight_status', {
    title: 'Flight status',
    description:
      'Live status of a flight to or from Taiwan: scheduled, estimated and actual times, delay, ' +
      'terminal, gate and status (on time, delayed, departed, cancelled, ...). TDX lists ' +
      'flights around today. Example: flight "CI100"; or "B7 8751".',
    input: {
      flight: z
        .string()
        .trim()
        .regex(FLIGHT, 'Use an airline code and number, e.g. CI100')
        .describe('Flight number with its airline code, e.g. "CI100", "BR 857", "AE1262".'),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
        .optional()
        .describe('Only this flight date, YYYY-MM-DD (default: every date TDX lists).'),
    },
    run: async (args) => {
      const [, code, digits = ''] = FLIGHT.exec(args.flight) ?? [];
      const airline = code?.toUpperCase();
      const [flights, airports, airlines] = await Promise.all([
        ctx.tdx.air.flights(digits),
        airportNames(ctx),
        airlineNames(ctx),
      ]);
      const sameNumber = flights.filter((f) => !args.date || f.FlightDate === args.date);
      const found = sameNumber
        .filter((f) => !airline || f.AirlineID === airline)
        .sort((a, b) =>
          (a.ScheduleDepartureTime ?? '').localeCompare(b.ScheduleDepartureTime ?? ''),
        );
      const others = [...new Set(sameNumber.map((f) => `${f.AirlineID}${f.FlightNumber}`))].filter(
        (f) => !airline || !f.startsWith(airline),
      );
      const label = `${airline ?? ''}${digits}`;
      return list(
        found.map((f) => describeFlight(f, airports, airlines)),
        ctx.maxItems,
        {
          flight: label,
          note: found.length
            ? undefined
            : `No ${label} in TDX's flight list${args.date ? ` on ${args.date}` : ''}` +
              (others.length ? `; it lists ${others.join(', ')}.` : '.'),
        },
      );
    },
  });

  defineTool(server, 'flight_board', {
    title: 'Airport departures and arrivals',
    description:
      "An airport's live departure or arrival board for passenger flights: times, delay, " +
      'status, terminal and gate, from an hour ago on for today, with the current weather. ' +
      'Covers the Taiwan airports. Example: airport "TSA", direction "departures", ' +
      'otherAirport "金門".',
    input: {
      airport: airport('The'),
      direction: z
        .enum(['departures', 'arrivals'])
        .optional()
        .describe('"departures" (default) or "arrivals".'),
      otherAirport: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe('Only flights to (or, for arrivals, from) this airport: IATA code or name.'),
      airline: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9]{2}$/, 'Use the 2-character IATA airline code')
        .optional()
        .describe('Only this airline, IATA code, e.g. "BR".'),
      date,
      after,
      limit: limit(20, 'flights'),
    },
    run: async (args) => {
      const here = findAirport(args.airport);
      const arrivals = args.direction === 'arrivals';
      const now = taipeiNow();
      const day = args.date ?? now.date;
      const start = args.after ?? (day === now.date ? earlier(now.time, 60) : '00:00');
      const [board, airports, [weather]] = await Promise.all([
        arrivals ? ctx.tdx.air.arrivals(here.id) : ctx.tdx.air.departures(here.id),
        airportNames(ctx),
        ctx.tdx.air.metar(here.id).catch((): AirMetar[] => []),
      ]);
      const others = args.otherAirport ? otherAirports(args.otherAirport, airports) : undefined;
      const airline = args.airline?.toUpperCase();
      const threshold = `${day}T${start}`;
      const items = board
        .map((f) => (arrivals ? arrivalRow(f as AirArrival) : departureRow(f as AirDeparture)))
        .filter(
          (r) =>
            !r.flight.IsCargo &&
            r.flight.FlightDate === day &&
            (!airline || r.flight.AirlineID === airline) &&
            (!others || others.has(r.other)) &&
            (!r.scheduled || r.scheduled >= threshold || (r.estimated ?? '') >= threshold),
        )
        // Flights without a scheduled time (TSA lists some) go last.
        .sort((a, b) => ((a.scheduled ?? '~') < (b.scheduled ?? '~') ? -1 : 1))
        .map((r) => ({
          flight: `${r.flight.AirlineID}${r.flight.FlightNumber}`,
          [arrivals ? 'from' : 'to']: airportLabel(r.other, airports),
          ...timing(r.scheduled, r.estimated, r.actual, r.remark, day),
          terminal: text(r.flight.Terminal),
          gate: text(r.flight.Gate),
          checkCounter: text(r.flight.CheckCounter),
          baggageClaim: text(r.flight.BaggageClaim),
          aircraft: text(r.flight.AcType),
        }));
      return list(items, take(ctx, args.limit, 20), {
        airport: `${here.id} ${here.zh} / ${here.en}`,
        direction: arrivals ? 'arrivals' : 'departures',
        date: day,
        after: start,
        weather: weather && describeWeather(weather),
      });
    },
  });

  defineTool(server, 'flight_schedule', {
    title: 'Flight schedule',
    description:
      'Scheduled flights between two airports on a day. Between Taiwan airports: the domestic ' +
      'flights of Mandarin Airlines, UNI Air and Daily Air with cancellations and fares in ' +
      'NT$. To or from abroad: the published international timetable, code-share numbers ' +
      'grouped under one flight. Use flight_status or flight_board for live status. Example: ' +
      'from "松山", to "金門", date "2026-11-02"; or from "TPE", to "NRT".',
    input: {
      from: airport('Departure').describe(
        'Departure airport: a Taiwan airport (TPE, 松山, 金門) or any IATA code or name abroad ' +
          '(NRT, HND, Tokyo).',
      ),
      to: airport('Arrival').describe(
        'Arrival airport: a Taiwan airport (TSA, 高雄) or any IATA code or name abroad (HKG, Osaka).',
      ),
      date,
      after,
      limit: limit(20, 'flights'),
    },
    run: async (args) => {
      const domesticFrom = tryAirport(args.from);
      const domesticTo = tryAirport(args.to);
      if (!domesticFrom || !domesticTo) {
        // Abroad, or a name for several airports ("Taipei"): match each end as a set of codes.
        const names = await airportNames(ctx);
        const fromIds = otherAirports(args.from, names);
        const toIds = otherAirports(args.to, names);
        const taiwan = new Set(TAIWAN_AIRPORTS.map((a) => a.id));
        if ([...fromIds, ...toIds].every((id) => taiwan.has(id))) {
          // Both in Taiwan after all: let the lookup say which name is ambiguous.
          findAirport(args.from);
          findAirport(args.to);
        }
        return international(ctx, names, fromIds, toIds, args);
      }
      const from = domesticFrom;
      const to = domesticTo;
      if (from.id === to.id) {
        throw new ToolInputError(`"${args.from}" and "${args.to}" are the same airport.`);
      }
      const day = args.date ?? taipeiNow().date;
      const start = startTime(day, args.after);
      const route = `${from.id}-${to.id}`;
      const failed: string[] = [];
      const perAirline = await Promise.all(
        Object.keys(DOMESTIC_AIRLINES).map(async (airline) => {
          try {
            const [flights, fares] = await Promise.all([
              ctx.tdx.air.dailySchedule(airline, { filter: `FlightDate eq '${day}'` }),
              ctx.tdx.air.routeFares(airline),
            ]);
            return {
              flights: flights.filter((f) => f.AirRouteID === route),
              fares: fares.find((f) => f.AirRouteID === route)?.Fares,
            };
          } catch {
            failed.push(airline);
            return { flights: [], fares: undefined };
          }
        }),
      );
      const items = perAirline
        .flatMap((a) => a.flights)
        .filter((f) => f.DepartureTime >= start)
        .sort((a, b) => clock(a.DepartureTime) - clock(b.DepartureTime))
        .map((f) => ({
          flight: `${f.AirlineID}${f.FlightNumber}`,
          airline: DOMESTIC_AIRLINES[f.AirlineID] ?? f.AirlineID,
          departs: f.DepartureTime,
          arrives: f.ArrivalTime,
          duration: duration(f.DepartureTime, f.ArrivalTime.replace('+1', '')),
          aircraft: f.AircraftType && f.AircraftType !== 'N/A' ? f.AircraftType : undefined,
          via: f.TransitAirports?.map((t) => t.TransitAirportID),
          status: SCHEDULE_REMARK[f.FlightRemark],
        }));
      const fares = Object.fromEntries(
        Object.keys(DOMESTIC_AIRLINES).flatMap((airline, i) => {
          const entries = perAirline[i]?.fares;
          // Domestic flights have one cabin; `fareTable` would read the air cabin codes as rail cars.
          return entries?.length
            ? [
                [
                  airline,
                  fareTable(
                    entries.map((f) => ({ ...f, CabinClass: undefined })),
                    FARE_CLASS,
                  ),
                ],
              ]
            : [];
        }),
      );
      const notes = [
        items.length
          ? undefined
          : `No scheduled AE, B7 or DA flight from ${from.id} to ${to.id} on ${day} after ${start}.`,
        failed.length ? `TDX did not answer for ${failed.join(', ')}.` : undefined,
      ].filter(Boolean);
      return list(items, take(ctx, args.limit, 20), {
        from: `${from.id} ${from.zh} / ${from.en}`,
        to: `${to.id} ${to.zh} / ${to.en}`,
        date: day,
        after: start,
        fares: Object.keys(fares).length ? fares : undefined,
        note: notes.length ? notes.join(' ') : undefined,
      });
    },
  });

  defineTool(server, 'flight_seats', {
    title: 'Domestic flight seats',
    description:
      'Whether seats are left on a domestic flight of Mandarin Airlines (AE), UNI Air (B7) or ' +
      'Daily Air (DA): available, fewer than 5 left, or sold out, per cabin when the airline ' +
      'says. TDX asks the airline live, so this can take up to 30 s, and UNI Air allows few ' +
      'requests; call it for one flight at a time. Example: flight "AE1273", date "2026-11-02".',
    input: {
      flight: z
        .string()
        .trim()
        .regex(FLIGHT, 'Use an airline code and number, e.g. AE1273')
        .describe('Domestic flight with its airline code: AE, B7 or DA, e.g. "AE1273", "B7 8751".'),
      date,
    },
    run: async (args) => {
      const [, code, digits = ''] = FLIGHT.exec(args.flight) ?? [];
      const airline = code?.toUpperCase();
      if (!airline || !(airline in DOMESTIC_AIRLINES)) {
        throw new ToolInputError(
          'TDX has seat availability only for Mandarin Airlines (AE), UNI Air (B7) and Daily ' +
            'Air (DA); give the flight with one of those codes, e.g. AE1273.',
        );
      }
      const day = args.date ?? taipeiNow().date;
      // The same query flight_schedule makes, so the day's schedule is usually cached.
      const flights = await ctx.tdx.air.dailySchedule(airline, {
        filter: `FlightDate eq '${day}'`,
      });
      const flight = flights.find((f) => Number(f.FlightNumber) === Number(digits));
      if (!flight) {
        throw new ToolInputError(`${airline}${digits} is not in ${airline}'s schedule for ${day}.`);
      }
      let seats;
      try {
        seats = await ctx.tdx.air.seatAvailability(
          airline,
          flight.AirRouteID,
          day,
          flight.FlightNumber,
        );
      } catch (error) {
        if (error instanceof TdxApiError && error.status >= 500) {
          throw new ToolInputError(
            `The airline did not answer TDX in time (HTTP ${error.status}); try again in a minute.`,
          );
        }
        throw error;
      }
      const [status] = seats;
      return ok({
        flight: `${airline}${flight.FlightNumber}`,
        route: flight.AirRouteID,
        date: day,
        departs: flight.DepartureTime,
        arrives: flight.ArrivalTime,
        cancelled: flight.FlightRemark === 'X' || undefined,
        seats: status ? SEATS[status.SeatStatus] : undefined,
        seatsLeft:
          status?.TotalSeats !== undefined && status.SoldSeats !== undefined
            ? status.TotalSeats - status.SoldSeats
            : undefined,
        cabins: status?.CabinSeats?.map((c) => ({
          cabin: CABIN[c.CabinClass] ?? `cabin ${c.CabinClass}`,
          seats: SEATS[c.SeatStatus],
          seatsLeft: c.TotalSeats - c.SoldSeats,
        })),
        updated: status?.UpdateTime,
        note: status ? undefined : 'The airline returned no seat data for this flight.',
      });
    },
  });
}

/** A Taiwan airport, or `undefined` when the input names none or several. */
function tryAirport(input: string) {
  try {
    return findAirport(input);
  } catch {
    return undefined;
  }
}

/**
 * Flights to or from abroad on a day, from the published international timetable: rows valid
 * on that date and weekday, code-shares (same times, same terminal) merged into one flight.
 */
async function international(
  ctx: ToolContext,
  names: Map<string, string>,
  fromIds: Set<string>,
  toIds: Set<string>,
  args: { date?: string; after?: string; limit?: number },
) {
  const day = args.date ?? taipeiNow().date;
  const start = startTime(day, args.after);
  const weekday = WEEKDAYS[new Date(`${day}T12:00:00+08:00`).getUTCDay()] ?? 'Monday';
  const anyOf = (field: string, ids: Set<string>) =>
    [...ids].map((id) => `${field} eq ${odata.str(id)}`).join(' or ');
  const [rows, airlines] = await Promise.all([
    ctx.tdx.air.generalSchedule('International', {
      filter: [anyOf('DepartureAirportID', fromIds), anyOf('ArrivalAirportID', toIds)],
    }),
    airlineNames(ctx),
  ]);
  const groups = new Map<
    string,
    { row: AirGeneralSchedule; flights: string[]; airlines: string[] }
  >();
  for (const row of rows) {
    if (row.ScheduleStartDate > day || day > row.ScheduleEndDate || !row[weekday]) continue;
    if (row.DepartureTime < start) continue;
    const key = [
      row.DepartureAirportID,
      row.ArrivalAirportID,
      row.DepartureTime,
      row.ArrivalTime,
      row.Terminal ?? '',
    ].join('|');
    const group = groups.get(key) ?? { row, flights: [], airlines: [] };
    if (!group.flights.includes(row.FlightNumber)) group.flights.push(row.FlightNumber);
    const airline = airlines.get(row.AirlineID) ?? row.AirlineID;
    if (!group.airlines.includes(airline)) group.airlines.push(airline);
    groups.set(key, group);
  }
  const items = [...groups.values()]
    .sort((a, b) => a.row.DepartureTime.localeCompare(b.row.DepartureTime))
    .map(({ row, flights, airlines: carriers }) => ({
      departs: row.DepartureTime,
      arrives: row.ArrivalTime,
      from: fromIds.size > 1 ? row.DepartureAirportID : undefined,
      to: toIds.size > 1 ? row.ArrivalAirportID : undefined,
      flights,
      airlines: carriers,
      terminal: text(row.Terminal),
    }));
  const label = (ids: Set<string>) => [...ids].map((id) => airportLabel(id, names)).join('、');
  return list(items, take(ctx, args.limit, 20), {
    from: label(fromIds),
    to: label(toIds),
    date: day,
    after: start,
    note: items.length
      ? 'Published timetable; one entry per departure, with its code-share flight numbers. ' +
        'Times are local at each airport.'
      : `No scheduled flight from ${label(fromIds)} to ${label(toIds)} on ${day} after ${start} ` +
        "in TDX's international timetable, which misses some airports (Songshan); flight_board " +
        "shows an airport's flights today.",
  });
}

/** One board row, read the same way for departures and arrivals. */
interface Row {
  flight: AirDeparture | AirArrival;
  /** The far end: the destination of a departure, the origin of an arrival. */
  other: string;
  scheduled: string | undefined;
  estimated: string | undefined;
  actual: string | undefined;
  remark: string | undefined;
}

function departureRow(f: AirDeparture): Row {
  return {
    flight: f,
    other: f.ArrivalAirportID,
    scheduled: f.ScheduleDepartureTime,
    estimated: f.EstimatedDepartureTime,
    actual: f.ActualDepartureTime,
    remark: f.DepartureRemark,
  };
}

function arrivalRow(f: AirArrival): Row {
  return {
    flight: f,
    other: f.DepartureAirportID,
    scheduled: f.ScheduleArrivalTime,
    estimated: f.EstimatedArrivalTime,
    actual: f.ActualArrivalTime,
    remark: f.ArrivalRemark,
  };
}

function describeFlight(
  f: AirFlight,
  airports: Map<string, string>,
  airlines: Map<string, string>,
) {
  const leg = (
    scheduled: string | undefined,
    estimated: string | undefined,
    actual: string | undefined,
    remark: string | undefined,
    terminal: string | undefined,
    gate: string | undefined,
  ) =>
    compact({
      ...timing(scheduled, estimated, actual, remark, f.FlightDate),
      terminal: text(terminal),
      gate: text(gate),
    });
  return {
    flight: `${f.AirlineID}${f.FlightNumber}`,
    airline: airlines.get(f.AirlineID) ?? f.AirlineID,
    date: f.FlightDate,
    from: airportLabel(f.DepartureAirportID, airports),
    to: airportLabel(f.ArrivalAirportID, airports),
    departure: leg(
      f.ScheduleDepartureTime,
      f.EstimatedDepartureTime,
      f.ActualDepartureTime,
      f.DepartureRemark,
      f.DepartureTerminal,
      f.DepartureGate,
    ),
    arrival: leg(
      f.ScheduleArrivalTime,
      f.EstimatedArrivalTime,
      f.ActualArrivalTime,
      f.ArrivalRemark,
      f.ArrivalTerminal,
      f.ArrivalGate,
    ),
    checkCounter: text(f.CheckCounter),
    baggageClaim: text(f.BaggageClaim),
    aircraft: text(f.AcType),
  };
}

function describeWeather(m: AirMetar) {
  return {
    observed: m.ObservationTime,
    description: name(m.WeatherDescription),
    temperature: text(m.Temperature),
    wind: text(`${m.WindDirection} ${m.WindSpeed}`),
    visibility: text(m.Visibility),
    ceiling: text(m.Ceiling),
  };
}

/**
 * Times of one leg as `HH:mm` on `day`, the delay and the status. The actual time is shown only
 * once the remark says the flight has gone: TSA fills it with the scheduled time before then.
 */
function timing(
  scheduled: string | undefined,
  estimated: string | undefined,
  actual: string | undefined,
  remark: string | undefined,
  day: string,
) {
  const status = flightStatus(remark);
  const gone = status === 'departed' || status === 'arrived';
  const done = gone ? actual : undefined;
  return {
    scheduled: localTime(scheduled, day),
    estimated: !gone && estimated !== scheduled ? localTime(estimated, day) : undefined,
    actual: localTime(done, day),
    delayMinutes: status === 'cancelled' ? undefined : minutesBetween(scheduled, done ?? estimated),
    status,
  };
}

/** A remark as a status word, or the remark itself when no keyword matches. */
export function flightStatus(remark: string | null | undefined): string | undefined {
  const value = remark?.trim();
  if (!value) return undefined;
  return REMARKS.find(([pattern]) => pattern.test(value))?.[1] ?? value;
}

/** `08:50` on the flight date, else `2026-10-19 23:13`. */
function localTime(value: string | undefined, day: string): string | undefined {
  if (!value) return undefined;
  return value.startsWith(`${day}T`) ? value.slice(11, 16) : value.replace('T', ' ');
}

/** `HH:mm`, `minutes` before `time`, not before midnight. */
function earlier(time: string, minutes: number): string {
  const m = Math.max(0, clock(time) - minutes);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Trimmed text, `undefined` when blank (TPE pads gates: `" A8"`, `"   "`). */
function text(value: string | null | undefined): string | undefined {
  return value?.trim() || undefined;
}

function airportLabel(id: string, airports: Map<string, string>): string {
  const label = airports.get(id);
  return label ? `${id} ${label}` : id;
}

/**
 * IATA codes that `input` names: a code, else every Taiwan airport whose name or alias matches
 * ("Taipei" is TPE and TSA), else every airport in TDX's list whose name matches.
 */
function otherAirports(input: string, airports: Map<string, string>): Set<string> {
  if (/^[A-Za-z]{3}$/.test(input)) return new Set([input.toUpperCase()]);
  const taiwan = search(TAIWAN_AIRPORTS, (a) => [a.zh, a.en, ...a.aliases], input);
  const ids = taiwan.length
    ? taiwan.map((a) => a.id)
    : search([...airports], ([, label]) => [label], input).map(([id]) => id);
  if (!ids.length) throw new ToolInputError(`No airport matches "${input}". Give its IATA code.`);
  return new Set(ids);
}

/** Airport names by IATA code (static list, cached by the client). */
async function airportNames(ctx: ToolContext): Promise<Map<string, string>> {
  const airports = await ctx.tdx.air.airports({ select: ['AirportID', 'AirportName'] });
  return new Map(
    airports.flatMap((a) => {
      const label = name(a.AirportName);
      return a.AirportID && label ? [[a.AirportID, label] as const] : [];
    }),
  );
}

/** Airline names by IATA code (static list, cached by the client). */
async function airlineNames(ctx: ToolContext): Promise<Map<string, string>> {
  const airlines = await ctx.tdx.air.airlines({ select: ['AirlineID', 'AirlineName'] });
  return new Map(
    airlines.flatMap((a) => {
      const label = name(a.AirlineName);
      return a.AirlineID && label ? [[a.AirlineID, label] as const] : [];
    }),
  );
}
