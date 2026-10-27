import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  odata,
  type BusAlert,
  type BusEstimatedTimeOfArrival,
  type BusNews,
  type BusRoute,
  type BusServiceDay,
  type BusSpecialDay,
  type BusStation,
  type BusTimetable,
} from 'tdx-taiwan';
import { z } from 'zod';
import type { ToolContext } from '../core/context.js';
import { ToolInputError } from '../core/errors.js';
import { arrayOf, HEADING, name, plain, realTime } from '../core/format.js';
import { normalize, search } from '../core/names.js';
import { list } from '../core/respond.js';
import { after, date, limit, take } from '../core/schemas.js';
import { startTime, taipeiNow } from '../core/time.js';
import { defineTool } from '../core/tool.js';
import {
  arrival,
  busCity,
  busScope,
  direction,
  DIRECTION,
  inDirection,
  INTERCITY,
  laterBuses,
  minutes,
  ROUTE_FIELDS,
  routeName,
} from './bus.js';

const ALERT_STATUS: Record<number, string> = { 0: 'suspended', 1: 'normal', 2: 'disrupted' };
const ALERT_CAUSE: Record<number, string> = {
  1: 'accident',
  2: 'maintenance',
  3: 'technical problem',
  4: 'construction',
  5: 'medical emergency',
  6: 'weather',
  7: 'demonstration',
  8: 'police activity',
  9: 'holiday',
  10: 'strike',
  11: 'event',
};
const ALERT_EFFECT: Record<number, string> = {
  1: 'detour, stops skipped',
  2: 'extra service',
  3: 'reduced service',
  4: 'no service',
  5: 'modified service',
  6: 'stop moved',
  7: 'significant delays',
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

export function registerBusServiceTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, 'bus_stop_arrivals', {
    title: 'Buses arriving at a stop',
    description:
      'Every bus due at one stop, all routes at once, soonest first: minutes to arrival, ' +
      'where each bus is heading, and the buses after it. Give the stationUID from ' +
      'bus_stops_nearby, or the stop name. Example: city "Taipei", stationUID "TPE1895"; or ' +
      'city "Taipei", stop "臺北車站(鄭州)".',
    input: {
      city: busCity,
      stationUID: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe('Station ID from bus_stops_nearby, e.g. "TPE1895" (one side of the street).'),
      stop: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          'Exact stop name in Chinese or English, e.g. "臺北車站(鄭州)"; matches the stops ' +
            'of that name on both sides of the street.',
        ),
      limit: limit(30, 'arrivals'),
    },
    run: async (args) => {
      const where = busScope(args.city);
      if (!args.stationUID && !args.stop) {
        throw new ToolInputError(
          'Give stationUID (from bus_stops_nearby) or stop (the stop name).',
        );
      }
      let station: BusStation | undefined;
      let filter: string;
      if (args.stationUID) {
        const uid = args.stationUID.toUpperCase();
        const query = { filter: `StationUID eq ${odata.str(uid)}` };
        [station] =
          where === INTERCITY
            ? await ctx.tdx.bus.interCity.stations(query)
            : await ctx.tdx.bus.stations(where, query);
        if (!station) {
          throw new ToolInputError(
            `No bus station ${uid} in ${where}. Find station IDs with bus_stops_nearby; coach ` +
              'stations (THB…) need city "InterCity".',
          );
        }
        const stops = [...new Set(arrayOf(station.Stops).map((s) => s.StopUID))];
        filter = stops.map((uid) => `StopUID eq ${odata.str(uid)}`).join(' or ');
      } else {
        filter = stopNameFilter(args.stop ?? '');
      }
      const [etas, routes] = await Promise.all([
        where === INTERCITY
          ? ctx.tdx.bus.interCity.eta({ filter })
          : ctx.tdx.bus.eta(where, { filter }),
        where === INTERCITY
          ? ctx.tdx.bus.interCity.routes({ select: ROUTE_FIELDS })
          : ctx.tdx.bus.routes(where, { select: ROUTE_FIELDS }),
      ]);
      if (!etas.length && !station) {
        throw new ToolInputError(
          `No stop named "${args.stop}" in ${where}. Stop names must match exactly; find the ` +
            'stops near a place with bus_stops_nearby.',
        );
      }
      const routeByUid = new Map(routes.map((r) => [r.RouteUID, r]));
      const stopNames = new Set(etas.map((e) => e.StopName?.Zh_tw));
      const items = [...etas]
        .sort((a, b) => sortKey(a) - sortKey(b))
        .map((e) => ({
          route: name(e.RouteName),
          toward: toward(routeByUid.get(e.RouteUID ?? ''), e.Direction),
          direction: DIRECTION[e.Direction],
          subRoute: e.SubRouteName?.Zh_tw !== e.RouteName?.Zh_tw ? name(e.SubRouteName) : undefined,
          // Only worth saying when the name matched stops on both sides of the street.
          stop: stopNames.size > 1 ? name(e.StopName) : undefined,
          arrival: arrival(e),
          minutes: minutes(e.EstimateTime),
          laterBusesMinutes: laterBuses(e),
          plate: e.PlateNumb && e.PlateNumb !== '-1' ? e.PlateNumb : undefined,
          lastBus: e.IsLastBus === true ? true : undefined,
        }));
      return list(items, take(ctx, args.limit, 30), {
        city: where,
        stop: station
          ? name({
              Zh_tw: station.StationName.Zh_tw,
              En: station.Stops?.find((s) => s.StopName.En)?.StopName.En,
            })
          : args.stop,
        heading: station?.Bearing ? (HEADING[station.Bearing] ?? station.Bearing) : undefined,
        updated: etas
          .map((e) => e.SrcUpdateTime ?? e.UpdateTime)
          .sort()
          .at(-1),
        note: items.length ? undefined : 'No arrival estimates at this stop right now.',
      });
    },
  });

  defineTool(server, 'bus_timetable', {
    title: 'Bus timetable',
    description:
      'Scheduled departures of a bus route on a day, from its first stop or a given stop, or ' +
      'how often it runs for routes run by frequency. Use it for planning ahead and for ' +
      'coaches and rural routes; use bus_eta for live arrivals. Kaohsiung publishes no ' +
      'timetables. Example: city "InterCity", routeName "1610", stop "臺北轉運站".',
    input: {
      city: busCity,
      routeName,
      stop: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe('Part of a stop name, to list departures from that stop (default: first stop).'),
      direction,
      date,
      after,
      limit: limit(30, 'departures'),
    },
    run: async (args) => {
      const where = busScope(args.city);
      const schedules = (
        where === INTERCITY
          ? await ctx.tdx.bus.interCity.schedule(args.routeName)
          : await ctx.tdx.bus.schedule(where, args.routeName)
      ).filter(inDirection(args.direction));
      if (!schedules.length) {
        throw new ToolInputError(
          `TDX has no timetable for route "${args.routeName}" in ${where}` +
            (where === 'Kaohsiung'
              ? ' (Kaohsiung publishes none); use bus_eta for live arrivals.'
              : '. Check the name with bus_route_search, or use bus_eta for live arrivals.'),
        );
      }
      const day = args.date ?? taipeiNow().date;
      const start = startTime(day, args.after);
      const departures = [];
      const headways = [];
      let stopFound = !args.stop;
      for (const s of schedules) {
        const subRoute = name(s.SubRouteName);
        const dir = DIRECTION[s.Direction];
        const trips = arrayOf(s.Timetables).filter((t) => runsOn(t, day));
        const stopName = args.stop ? matchStop(trips, args.stop) : undefined;
        if (stopName) stopFound = true;
        for (const trip of trips) {
          const calls = [...trip.StopTimes].sort((a, b) => a.StopSequence - b.StopSequence);
          const call = stopName ? calls.find((c) => c.StopName.Zh_tw === stopName) : calls[0];
          // A trip's last stop is where it ends, not a departure.
          if (!call || call === calls.at(-1)) continue;
          const departs = call.DepartureTime || call.ArrivalTime;
          if (!departs || departs < start) continue;
          departures.push({
            departs,
            stop: name(call.StopName),
            toward: name(calls.at(-1)?.StopName),
            subRoute,
            direction: dir,
          });
        }
        for (const band of arrayOf(s.Frequencys).filter((f) => runsOn(f, day))) {
          if (band.EndTime < start) continue;
          headways.push({
            from: band.StartTime,
            to: band.EndTime,
            everyMinutes:
              band.MinHeadwayMins === band.MaxHeadwayMins
                ? `${band.MinHeadwayMins}`
                : `${band.MinHeadwayMins}–${band.MaxHeadwayMins}`,
            subRoute,
            direction: dir,
          });
        }
      }
      if (!stopFound) {
        const stops = [
          ...new Set(
            schedules.flatMap((s) =>
              arrayOf(s.Timetables).flatMap((t) => t.StopTimes.map((c) => c.StopName.Zh_tw)),
            ),
          ),
        ];
        throw new ToolInputError(
          `No stop on route ${args.routeName} matches "${args.stop}"` +
            (stops.length
              ? `. Its stops include: ${stops.slice(0, 40).join('、')}.`
              : '; this route publishes headways only, not stop times.'),
        );
      }
      departures.sort((a, b) => a.departs.localeCompare(b.departs));
      headways.sort((a, b) => a.from.localeCompare(b.from));
      return list(departures, take(ctx, args.limit, 30), {
        city: where,
        route: args.routeName,
        date: day,
        after: start,
        headways: headways.length ? headways : undefined,
        note:
          departures.length || headways.length
            ? headways.length && !departures.length
              ? 'This route runs by frequency: buses leave the first stop at these intervals.'
              : undefined
            : `No scheduled departures on ${day} after ${start}.`,
      });
    },
  });

  defineTool(server, 'bus_alerts', {
    title: 'Bus service alerts',
    description:
      'Current and upcoming bus detours, suspensions, moved stops and extra services in a ' +
      'city or on the InterCity coaches, with the routes and stops they affect, plus the ' +
      'latest operator news. Example: city "Taipei"; or city "Taipei", route "307".',
    input: {
      city: busCity,
      route: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe('Only alerts that affect this route, e.g. "307".'),
      keyword: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe('Only alerts mentioning this, e.g. a stop or a road ("市政府", "遊行").'),
      limit: limit(20, 'alerts'),
    },
    run: async (args) => {
      const where = busScope(args.city);
      const [alerts, news] = await Promise.all([
        where === INTERCITY ? ctx.tdx.bus.interCity.alerts() : ctx.tdx.bus.alerts(where),
        (where === INTERCITY ? ctx.tdx.bus.interCity.news() : ctx.tdx.bus.news(where)).catch(
          (): BusNews[] => [],
        ),
      ]);
      const now = Date.now();
      let found = alerts.filter((a) => {
        const end = realTime(a.EndTime);
        return a.Status !== 1 && (!end || Date.parse(end) >= now);
      });
      if (args.route) found = found.filter((a) => affectsRoute(a, args.route ?? ''));
      if (args.keyword) {
        found = search(
          found,
          (a) => [
            a.Title,
            plain(a.Description),
            ...arrayOf(a.Scope.Stops).map((s) => s.StopName?.Zh_tw),
            ...arrayOf(a.Scope.Routes).map((r) => r.RouteName?.Zh_tw),
          ],
          args.keyword,
        );
      }
      // Alerts in force first, newest first (long-running stop moves sink); then upcoming ones,
      // soonest first.
      const started = (a: BusAlert) => Date.parse(a.StartTime) <= now;
      const items = [...found]
        .sort((a, b) =>
          started(a) !== started(b)
            ? Number(started(b)) - Number(started(a))
            : started(a)
              ? b.StartTime.localeCompare(a.StartTime)
              : a.StartTime.localeCompare(b.StartTime),
        )
        .map(describeAlert);
      const filtered = Boolean(args.route || args.keyword);
      return list(items, take(ctx, args.limit, 20), {
        city: where,
        news: filtered
          ? undefined
          : [...news]
              .sort((a, b) => b.PublishTime.localeCompare(a.PublishTime))
              .slice(0, 5)
              .map((n) => ({
                title: n.Title,
                published: realTime(n.PublishTime),
                url: n.NewsURL || undefined,
              })),
        note: items.length
          ? undefined
          : filtered
            ? 'No current bus alert matches.'
            : 'No current bus alerts: buses run as scheduled.',
      });
    },
  });
}

/** Exact match on the Chinese name (with 台 and 臺 both tried) or on the English name. */
function stopNameFilter(input: string): string {
  // bus_stops_nearby shows `中文 / English`; either half is a name.
  const value = input.split(' / ')[0]?.trim() ?? input;
  if (/^[\x20-\x7e]+$/.test(value)) return `StopName/En eq ${odata.str(value)}`;
  const variants = [
    ...new Set([value, value.replaceAll('台', '臺'), value.replaceAll('臺', '台')]),
  ];
  return variants.map((v) => `StopName/Zh_tw eq ${odata.str(v)}`).join(' or ');
}

/** Soonest first: by minutes, then buses not yet departed or without an estimate. */
function sortKey(e: BusEstimatedTimeOfArrival): number {
  if (e.EstimateTime != null && (e.StopStatus ?? 0) === 0) return e.EstimateTime;
  return e.EstimateTime != null ? 100_000 + e.EstimateTime : 1_000_000 + (e.StopStatus ?? 0);
}

/** The route's terminal in the bus's direction: its destination outbound, its origin inbound. */
function toward(route: BusRoute | undefined, dir: number): string | undefined {
  if (!route) return undefined;
  if (dir === 0)
    return name({ Zh_tw: route.DestinationStopNameZh, En: route.DestinationStopNameEn });
  if (dir === 1) return name({ Zh_tw: route.DepartureStopNameZh, En: route.DepartureStopNameEn });
  return undefined;
}

/** Whether a trip or headway band runs on `day`: special days first, then the week pattern. */
function runsOn(
  item: { ServiceDay?: BusServiceDay; SpecialDays?: BusSpecialDay[] },
  day: string,
): boolean {
  for (const special of arrayOf(item.SpecialDays)) {
    const period = special.DatePeriod;
    const inPeriod =
      period?.StartDate && period.EndDate && period.StartDate <= day && day <= period.EndDate;
    if (special.Dates?.includes(day) || inPeriod) return special.ServiceStatus !== 2;
  }
  if (!item.ServiceDay) return true;
  const weekday = WEEKDAYS[new Date(`${day}T12:00:00+08:00`).getUTCDay()] ?? 'Monday';
  return item.ServiceDay[weekday] === 1;
}

/** The Chinese name of the stop on these trips that best matches `input`. */
function matchStop(trips: readonly BusTimetable[], input: string): string | undefined {
  const names = [...new Set(trips.flatMap((t) => t.StopTimes.map((c) => c.StopName)))];
  const unique = [...new Map(names.map((n) => [n.Zh_tw, n])).values()];
  return search(unique, (n) => [n.Zh_tw, n.En], input)[0]?.Zh_tw;
}

/** Whether the alert names the route in its scope, or as a whole word in its text. */
function affectsRoute(alert: BusAlert, route: string): boolean {
  const wanted = normalize(route);
  const scoped = [
    ...arrayOf(alert.Scope.Routes).map((r) => r.RouteName?.Zh_tw),
    ...arrayOf(alert.Scope.SubRoutes).map((r) => r.SubRouteName?.Zh_tw),
  ].some((n) => n && normalize(n) === wanted);
  if (scoped) return true;
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const word = new RegExp(`(^|[^0-9A-Za-z])${escaped}($|[^0-9A-Za-z])`);
  return word.test(`${alert.Title} ${plain(alert.Description) ?? ''}`);
}

function describeAlert(a: BusAlert) {
  const description = plain(a.Description);
  const stops = [...new Set(arrayOf(a.Scope.Stops).map((s) => name(s.StopName)))];
  const routes = [
    ...new Set([
      ...arrayOf(a.Scope.Routes).map((r) => r.RouteName?.Zh_tw),
      ...arrayOf(a.Scope.SubRoutes).map((r) => r.SubRouteName?.Zh_tw),
    ]),
  ].filter(Boolean);
  const operators = arrayOf(a.Scope.Operators).map((o) => name(o.OperatorName) ?? o.OperatorID);
  return {
    title: a.Title,
    status: a.Status == null ? undefined : ALERT_STATUS[a.Status],
    cause: a.Cause == null ? undefined : ALERT_CAUSE[a.Cause],
    effect: a.Effect == null ? undefined : ALERT_EFFECT[a.Effect],
    routes: routes.length ? routes : undefined,
    stops: stops.length
      ? stops.length > 10
        ? [...stops.slice(0, 10), `… ${stops.length - 10} more`]
        : stops
      : undefined,
    operators: operators.length ? operators : undefined,
    description: description && description !== a.Title ? description.slice(0, 500) : undefined,
    start: realTime(a.StartTime),
    end: realTime(a.EndTime),
    department: a.Department || undefined,
    url: a.AlertURL || undefined,
  };
}
