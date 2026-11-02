import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  TdxApiError,
  type BusFare,
  type BusFirstLastTripInfo,
  type BusRouteFare,
  type BusRouteFareStop,
  type BusSchedule,
  type BusStop,
  type BusStopOfRoute,
} from 'tdx-taiwan';
import { z } from 'zod';
import { authorityCode } from '../core/cities.js';
import type { ToolContext } from '../core/context.js';
import { ToolInputError } from '../core/errors.js';
import { FARE_CLASS } from '../core/fares.js';
import { arrayOf, name } from '../core/format.js';
import { search } from '../core/names.js';
import { list } from '../core/respond.js';
import { date, limit, take } from '../core/schemas.js';
import { taipeiNow } from '../core/time.js';
import { defineTool } from '../core/tool.js';
import {
  busCity,
  busScope,
  direction,
  DIRECTION,
  inDirection,
  INTERCITY,
  noRoute,
  routeName,
} from './bus.js';
import { runsOn, WEEKDAYS } from './bus-service.js';

/** 票種. */
const TICKET: Record<number, string> = {
  1: 'single',
  2: 'return',
  3: 'smartCard',
  4: 'multiRide',
  5: 'pass30Days',
  6: 'pass60Days',
  7: 'earlyBird',
  8: 'pass90Days',
};
/** 費率等級: the shared classes plus the bus-only ones. */
const BUS_FARE_CLASS: Record<number, string> = {
  ...FARE_CLASS,
  8: 'group',
  9: 'militaryPolice',
  10: 'halfFare',
};
const PRICING: Record<number, string> = { 0: 'by section', 1: 'by stop', 2: 'by stage' };

const stopInput = (end: string) =>
  z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      `Where to travel ${end}: part of a stop name, or a city, e.g. "臺北轉運站", "岡山", "高雄".`,
    );

export function registerBusInfoTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, 'bus_fare', {
    title: 'Bus fares',
    description:
      'What a bus route costs, per passenger type and ticket (cash single ticket, smart card ' +
      'such as EasyCard): the fare between two stops for coaches and routes priced by ' +
      'distance, or the fare per section for city routes. Example: city "InterCity", ' +
      'routeName "1610", from "臺北", to "高雄"; or city "Taipei", routeName "307".',
    input: {
      city: busCity,
      routeName,
      from: stopInput('from'),
      to: stopInput('to'),
      direction,
      limit: limit(20, 'fares'),
    },
    run: async (args) => {
      const where = busScope(args.city);
      const fares =
        where === INTERCITY
          ? await ctx.tdx.bus.interCity.fares(args.routeName)
          : await ctx.tdx.bus.fares(where, args.routeName);
      if (!fares.length) throw noRoute(args.routeName, where);

      const pairs = fares.flatMap((f) => farePairs(f).filter(inDirection(args.direction)));
      let wanted: FareMatch[] = pairs.filter(
        (p) => matches(p.from, args.from) && matches(p.to, args.to),
      );
      if ((args.from || args.to) && pairs.length && !wanted.length) {
        // No fare stage has that name: find the stops on the route, then their stages.
        const routes = await stopLists(ctx, where, args.routeName);
        wanted = pairsViaStops(pairs, routes, args.from, args.to);
        if (!wanted.length) {
          const stops = [...new Set(pairs.flatMap((p) => [p.from.StopName, p.to.StopName]))];
          throw new ToolInputError(
            `No fare on route ${args.routeName} matches` +
              `${args.from ? ` from "${args.from}"` : ''}${args.to ? ` to "${args.to}"` : ''}` +
              `${args.direction ? ` (${args.direction})` : ''}. Give a stop on the route or a ` +
              `city; fares are listed between these stops: ${stops.slice(0, 40).join('、')}.`,
          );
        }
      }
      const sold = wanted.filter((p) => Object.keys(fareTable(p.Fares)).length);
      if (wanted.length && !sold.length && (args.from || args.to)) {
        throw new ToolInputError(
          `TDX lists no ticket on sale on route ${args.routeName} for this trip ` +
            `(${[...new Set(wanted.map((p) => `${p.from.StopName} → ${p.to.StopName}`))].join('、')}): ` +
            'the coach may not carry passengers between these stops.',
        );
      }

      const items = [
        ...fares.flatMap((f) => sectionItems(f, args.direction)),
        ...sold.map((p) => ({
          subRoute: p.subRoute,
          pricing: p.pricing,
          direction: DIRECTION[p.Direction],
          from: p.from.StopName,
          to: p.to.StopName,
          boarding: p.boarding,
          alighting: p.alighting,
          estimated: p.boarding || p.alighting ? true : undefined,
          fares: fareTable(p.Fares),
        })),
      ];
      const merged = mergeSubRoutes(items);
      const pricing = new Set(fares.map((f) => f.FarePricingType));
      return list(merged, take(ctx, args.limit, 20), {
        city: where,
        route: args.routeName,
        note: [
          pricing.has(0)
            ? 'Section fares: pay once per section ridden; a trip across a buffer zone ' +
              '(緩衝區) between two sections pays one more section.'
            : undefined,
          pricing.has(2) ? 'Coach fares are set between fare stages (計費站).' : undefined,
          merged.some((i) => i.estimated)
            ? 'estimated: boarding or alighting is not a fare stage, so the fare shown is ' +
              'from the stage before boarding to the stage after alighting; the operator may ' +
              'charge less.'
            : undefined,
          merged.some((i) => 'smartCard' in (i.fares as object))
            ? 'smartCard is the price with an e-ticket card (EasyCard, iPASS); single is cash.'
            : undefined,
        ]
          .filter(Boolean)
          .join(' '),
      });
    },
  });

  defineTool(server, 'bus_first_last', {
    title: 'First and last bus',
    description:
      'When the first and the last bus of a route leave on a day, per direction and ' +
      'sub-route. Taipei, New Taipei and Tainan publish no first/last list, so there it is ' +
      'worked out from the timetable. Example: city "Taichung", routeName "300"; or city ' +
      '"InterCity", routeName "1610".',
    input: { city: busCity, routeName, direction, date },
    run: async (args) => {
      const where = busScope(args.city);
      const day = args.date ?? taipeiNow().date;
      const weekday = WEEKDAYS[new Date(`${day}T12:00:00+08:00`).getUTCDay()] ?? 'Monday';
      const published = (await firstLastTrips(ctx, where, args.routeName)).filter(
        inDirection(args.direction),
      );
      let items: Array<Record<string, unknown>>;
      let source: string;
      if (published.length) {
        source = 'first/last trip list';
        items = published.flatMap((info) =>
          info.FirstLastTrips.filter((t) => t.ServiceDay[weekday] === 1).map((t) => ({
            subRoute: name(info.SubRouteName),
            direction: DIRECTION[info.Direction],
            first: t.FirstTripDepTime,
            last: t.LastTripDepTime,
          })),
        );
      } else {
        source = 'timetable';
        const schedules = (
          where === INTERCITY
            ? await ctx.tdx.bus.interCity.schedule(args.routeName)
            : await ctx.tdx.bus.schedule(where, args.routeName)
        ).filter(inDirection(args.direction));
        if (!schedules.length) throw noRoute(args.routeName, where);
        items = schedules.flatMap((s) => {
          const span = scheduleSpan(s, day);
          return span
            ? [{ subRoute: name(s.SubRouteName), direction: DIRECTION[s.Direction], ...span }]
            : [];
        });
      }
      items.sort(
        (a, b) =>
          String(a.direction).localeCompare(String(b.direction)) ||
          String(a.first).localeCompare(String(b.first)),
      );
      return list(items, ctx.maxItems, {
        city: where,
        route: args.routeName,
        date: day,
        weekday,
        source,
        note: items.length
          ? 'Times are departures from the first stop of each sub-route.'
          : `Route ${args.routeName} has no service listed on ${day} (${weekday}).`,
      });
    },
  });
}

/** The stop lists of a route, or `[]` if TDX has none: the fares are still worth showing. */
async function stopLists(
  ctx: ToolContext,
  where: string,
  route: string,
): Promise<BusStopOfRoute[]> {
  try {
    return where === INTERCITY
      ? await ctx.tdx.bus.interCity.stopsOfRoute(route)
      : await ctx.tdx.bus.stopsOfRoute(where, route);
  } catch (error) {
    if (error instanceof TdxApiError && error.status < 500) return [];
    throw error;
  }
}

/** First/last trips of a route; `[]` where TDX does not publish them (Taipei answers 400). */
async function firstLastTrips(
  ctx: ToolContext,
  where: string,
  route: string,
): Promise<BusFirstLastTripInfo[]> {
  try {
    if (where !== INTERCITY) return await ctx.tdx.bus.firstLastTrips(where, route);
    // No per-route path for coaches: filter the cached full list.
    const all = await ctx.tdx.bus.interCity.firstLastTrips();
    return all.filter((info) => info.RouteName.Zh_tw === route);
  } catch (error) {
    if (error instanceof TdxApiError && (error.status === 400 || error.status === 404)) return [];
    throw error;
  }
}

/** First and last departure from the first stop on `day`, from fixed trips or headway bands. */
function scheduleSpan(s: BusSchedule, day: string): { first: string; last: string } | undefined {
  const times = [
    ...arrayOf(s.Timetables)
      .filter((t) => runsOn(t, day))
      .map((t) => {
        const first = [...t.StopTimes].sort((a, b) => a.StopSequence - b.StopSequence)[0];
        return first?.DepartureTime || first?.ArrivalTime;
      }),
    ...arrayOf(s.Frequencys)
      .filter((f) => runsOn(f, day))
      .flatMap((f) => [f.StartTime, f.EndTime]),
  ]
    .filter((t): t is string => Boolean(t))
    .sort();
  const first = times[0];
  const last = times.at(-1);
  return first && last ? { first, last } : undefined;
}

interface FarePair {
  subRoute: string | undefined;
  subRouteID: string | null | undefined;
  pricing: string;
  Direction: number;
  from: BusRouteFareStop;
  to: BusRouteFareStop;
  Fares: BusFare[];
}

/** A fare pair, with the stops asked for when they are not the fare stages themselves. */
interface FareMatch extends FarePair {
  boarding?: string;
  alighting?: string;
}

/**
 * Fares for stops that are not named in the fare list: each keyword picks stops on the
 * sub-route by name, or else every stop in the city it names (`高雄`). Boarding is charged
 * from the stage at or before the stop, alighting to the stage at or after it.
 */
export function pairsViaStops(
  pairs: readonly FarePair[],
  routes: readonly BusStopOfRoute[],
  from: string | undefined,
  to: string | undefined,
): FareMatch[] {
  const groups = new Map<string, FarePair[]>();
  for (const p of pairs) {
    const key = `${p.subRouteID ?? ''}|${p.Direction}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const found = new Map<string, FareMatch>();
  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;
    const { subRouteID, Direction } = first;
    const route =
      routes.find((r) => r.Direction === Direction && r.SubRouteID === subRouteID) ??
      (subRouteID ? undefined : routes.find((r) => r.Direction === Direction));
    if (!route) continue;
    const stops = route.Stops;
    const seqOf = (stage: BusRouteFareStop) =>
      stage.Sequence ?? stops.find((s) => s.StopID === stage.StopID)?.StopSequence;
    const stages = [
      ...new Map(
        group
          .flatMap((p) => [p.from, p.to])
          .map((stage) => [seqOf(stage), stage] as const)
          .filter((e): e is readonly [number, BusRouteFareStop] => e[0] !== undefined),
      ).entries(),
    ].sort((a, b) => a[0] - b[0]);
    const isStage = (stop: BusStop) => stages.some(([seq]) => seq === stop.StopSequence);
    const origins = pickStops(stops, from, isStage);
    const destinations = pickStops(stops, to, isStage);
    for (const o of origins) {
      for (const d of destinations) {
        if (o.StopSequence >= d.StopSequence) continue;
        const board = stages.filter(([seq]) => seq <= o.StopSequence).at(-1);
        const alight = stages.find(([seq]) => seq >= d.StopSequence);
        if (!board || !alight || board[0] >= alight[0]) continue;
        const pair = group.find((p) => seqOf(p.from) === board[0] && seqOf(p.to) === alight[0]);
        if (!pair) continue;
        const match: FareMatch = {
          ...pair,
          boarding: board[0] === o.StopSequence ? undefined : (name(o.StopName) ?? undefined),
          alighting: alight[0] === d.StopSequence ? undefined : (name(d.StopName) ?? undefined),
        };
        const key = JSON.stringify([
          match.subRoute,
          match.Direction,
          board[0],
          alight[0],
          match.boarding,
          match.alighting,
        ]);
        found.set(key, match);
      }
    }
  }
  return [...found.values()];
}

/**
 * Stops whose name matches the keyword, else the stops in the city it names (`高雄`); of
 * those, only the fare stages when there are any, as a rider means the main stations. No
 * keyword: every stop.
 */
function pickStops(
  stops: readonly BusStop[],
  keyword: string | undefined,
  isStage: (stop: BusStop) => boolean,
): readonly BusStop[] {
  if (!keyword) return stops;
  const preferStages = (found: readonly BusStop[]) => {
    const stages = found.filter(isStage);
    return stages.length ? stages : found;
  };
  const byName = search(stops, (s) => [s.StopName.Zh_tw, s.StopName.En], keyword);
  if (byName.length) return preferStages(byName);
  const city = authorityCode(keyword);
  return city ? preferStages(stops.filter((s) => s.LocationCityCode === city)) : [];
}

/** The stop-to-stop (OD) or stage-to-stage fares of a sub-route. */
function farePairs(f: BusRouteFare): FarePair[] {
  const subRoute = subRouteOf(f);
  const subRouteID = f.IsForAllSubRoutes === 1 ? undefined : f.SubRouteID;
  const pricing = PRICING[f.FarePricingType] ?? `type ${f.FarePricingType}`;
  return [
    ...arrayOf(f.ODFares).map((o) => ({
      subRoute,
      subRouteID,
      pricing,
      Direction: o.Direction,
      from: o.OriginStop,
      to: o.DestinationStop,
      Fares: o.Fares,
    })),
    ...arrayOf(f.StageFares).map((s) => ({
      subRoute,
      subRouteID,
      pricing,
      Direction: s.Direction,
      from: s.OriginStage,
      to: s.DestinationStage,
      Fares: s.Fares,
    })),
  ];
}

/** Section fares of a sub-route, with the buffer zones in the wanted direction. */
function sectionItems(f: BusRouteFare, dir: 'outbound' | 'inbound' | undefined) {
  if (f.IsFreeBus === 1) return [{ subRoute: subRouteOf(f), pricing: 'free', fares: {} }];
  return arrayOf(f.SectionFares).map((s) => {
    const zones = arrayOf(s.BufferZones)
      .filter(inDirection(dir))
      .map((z) => ({
        direction: DIRECTION[z.Direction],
        section: z.SectionSequence,
        from: z.FareBufferZoneOrigin.StopName,
        to: z.FareBufferZoneDestination.StopName,
      }));
    return {
      subRoute: subRouteOf(f),
      pricing: 'by section',
      fares: fareTable(s.Fares),
      bufferZones: zones.length ? zones : undefined,
    };
  });
}

function subRouteOf(f: BusRouteFare): string | undefined {
  return f.IsForAllSubRoutes === 1 ? 'all' : (f.SubRouteName ?? f.RouteName ?? undefined);
}

/**
 * Prices as `{ ticket: { passenger: price } }`. Coach fares carry their own names
 * (`全票_原價_四排座`), which then replace the passenger type. Unsold tickets (-1) are left out.
 */
export function fareTable(fares: readonly BusFare[]): Record<string, Record<string, number>> {
  const table: Record<string, Record<string, number>> = {};
  for (const fare of fares) {
    if (fare.Price < 0) continue;
    const ticket = TICKET[fare.TicketType] ?? `ticket ${fare.TicketType}`;
    const key = fare.FareName || BUS_FARE_CLASS[fare.FareClass] || `class ${fare.FareClass}`;
    (table[ticket] ??= {})[key] = fare.Price;
  }
  return table;
}

/** One item per distinct fare, listing every sub-route that charges it. */
function mergeSubRoutes(items: ReadonlyArray<{ subRoute: string | undefined }>) {
  const byFare = new Map<string, { subRoutes: string[] } & Record<string, unknown>>();
  for (const { subRoute, ...rest } of items) {
    const key = JSON.stringify(rest);
    const entry = byFare.get(key) ?? { subRoutes: [], ...rest };
    if (subRoute && !entry.subRoutes.includes(subRoute)) entry.subRoutes.push(subRoute);
    byFare.set(key, entry);
  }
  return [...byFare.values()];
}

function matches(stop: BusRouteFareStop, keyword: string | undefined): boolean {
  return !keyword || search([stop.StopName], (n) => [n], keyword).length > 0;
}
