import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  BusCity,
  BusEstimatedTimeOfArrival,
  BusPosition,
  BusRoute,
  BusStopOfRoute,
  Field,
} from 'tdx-taiwan';
import { z } from 'zod';
import { normalizeCity } from '../core/cities.js';
import type { ToolContext } from '../core/context.js';
import { ToolInputError } from '../core/errors.js';
import { name } from '../core/format.js';
import { search } from '../core/names.js';
import { list } from '../core/respond.js';
import { city, limit, take } from '../core/schemas.js';
import { defineTool } from '../core/tool.js';

const INTERCITY = 'InterCity';

const BUS_CITIES = [
  'Taipei',
  'NewTaipei',
  'Taoyuan',
  'Taichung',
  'Tainan',
  'Kaohsiung',
  'Keelung',
  'Hsinchu',
  'HsinchuCounty',
  'MiaoliCounty',
  'ChanghuaCounty',
  'NantouCounty',
  'YunlinCounty',
  'ChiayiCounty',
  'Chiayi',
  'PingtungCounty',
  'YilanCounty',
  'HualienCounty',
  'TaitungCounty',
  'KinmenCounty',
  'PenghuCounty',
  'LienchiangCounty',
] as const satisfies readonly BusCity[];

const DIRECTION: Record<number, string> = {
  0: 'outbound',
  1: 'inbound',
  2: 'loop',
  10: 'circular',
  255: 'unknown',
};
const ROUTE_TYPE: Record<number, string> = {
  11: 'city bus',
  12: 'highway coach',
  13: 'freeway coach',
  14: 'shuttle',
};
const STOP_STATUS: Record<number, string> = {
  2: 'not stopping here (traffic control)',
  3: 'last bus has passed',
  4: 'not operating today',
};
const VEHICLE_STATUS: Record<number, string> = {
  0: 'normal',
  1: 'accident',
  2: 'breakdown',
  3: 'congestion',
  4: 'emergency',
  5: 'refuelling',
  90: 'unknown',
  91: 'direction unknown',
  98: 'off route',
  99: 'not in service',
};

/** Fields the route search needs; one `$select` keeps the cached route list small. */
const ROUTE_FIELDS: Field<BusRoute>[] = [
  'RouteUID',
  'RouteName',
  'BusRouteType',
  'Operators',
  'DepartureStopNameZh',
  'DepartureStopNameEn',
  'DestinationStopNameZh',
  'DestinationStopNameEn',
  'TicketPriceDescriptionZh',
];

const busCity = city([...BUS_CITIES, INTERCITY]).describe(
  `City: a TDX code (${BUS_CITIES.join(', ')}) or its Chinese name (臺北市, 新北市, ...), or ` +
    '"InterCity" for 公路客運 / 國道客運 coaches between cities.',
);
const routeName = z
  .string()
  .trim()
  .min(1)
  .describe(
    'Exact route name as TDX lists it, e.g. "307", "紅5", "1610". Find it with bus_route_search.',
  );
const direction = z
  .enum(['outbound', 'inbound'])
  .optional()
  .describe('Only one direction: "outbound" (去程) or "inbound" (返程). Default: both.');

export function registerBusTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, 'bus_route_search', {
    title: 'Search bus routes',
    description:
      'Bus routes whose name, or first or last stop, contains a keyword, with their endpoints, ' +
      'operators and fare. Use it to find the exact route name the other bus tools need. ' +
      'Example: city "Taipei", keyword "307"; or city "InterCity", keyword "1610".',
    input: {
      city: busCity,
      keyword: z
        .string()
        .trim()
        .min(1)
        .describe('Route name or part of it ("307", "紅"), or a terminal stop ("動物園").'),
      limit: limit(20, 'routes'),
    },
    run: async (args) => {
      const where = busScope(args.city);
      const routes =
        where === INTERCITY
          ? await ctx.tdx.bus.interCity.routes({ select: ROUTE_FIELDS })
          : await ctx.tdx.bus.routes(where, { select: ROUTE_FIELDS });
      const byName = search(routes, (r) => [r.RouteName.Zh_tw, r.RouteName.En], args.keyword);
      const named = new Set(byName);
      const byStop = search(
        routes.filter((r) => !named.has(r)),
        (r) => [
          r.DepartureStopNameZh,
          r.DepartureStopNameEn,
          r.DestinationStopNameZh,
          r.DestinationStopNameEn,
        ],
        args.keyword,
      );
      const items = [...byName, ...byStop].map((r) => ({
        route: name(r.RouteName),
        from: zhEn(r.DepartureStopNameZh, r.DepartureStopNameEn),
        to: zhEn(r.DestinationStopNameZh, r.DestinationStopNameEn),
        type: ROUTE_TYPE[r.BusRouteType],
        operators: r.Operators.map((o) => name(o.OperatorName)).join(', ') || undefined,
        fare: r.TicketPriceDescriptionZh ?? undefined,
        routeUID: r.RouteUID,
      }));
      return list(items, take(ctx, args.limit, 20), { city: where });
    },
  });

  defineTool(server, 'bus_route_stops', {
    title: 'Stops of a bus route',
    description:
      'The stops of a bus route in order, for each direction and sub-route. ' +
      'Example: city "Taipei", routeName "307", direction "outbound".',
    input: { city: busCity, routeName, direction },
    run: async (args) => {
      const where = busScope(args.city);
      const routes = (
        where === INTERCITY
          ? await ctx.tdx.bus.interCity.stopsOfRoute(args.routeName)
          : await ctx.tdx.bus.stopsOfRoute(where, args.routeName)
      ).filter(inDirection(args.direction));
      if (!routes.length) throw noRoute(args.routeName, where);
      const items = routes.map((r: BusStopOfRoute) => ({
        subRoute: name(r.SubRouteName),
        direction: DIRECTION[r.Direction ?? 255],
        stops: [...r.Stops]
          .sort((a, b) => a.StopSequence - b.StopSequence)
          .map((s) => `${s.StopSequence}. ${name(s.StopName) ?? s.StopUID}`),
      }));
      return list(items, ctx.maxItems, { city: where, route: args.routeName });
    },
  });

  defineTool(server, 'bus_eta', {
    title: 'Bus arrival times',
    description:
      'Live estimated arrival of the next buses at the stops of a route ("4 min", "arriving ' +
      'now", "last bus has passed"), with the minutes to the buses after it. Give stop to ' +
      'see one stop only. Example: city "Taipei", routeName "307", stop "西門".',
    input: {
      city: busCity,
      routeName,
      stop: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe('Part of a stop name (Chinese or English) to show only matching stops.'),
      direction,
      limit: limit(200, 'stops'),
    },
    run: async (args) => {
      const where = busScope(args.city);
      const etas =
        where === INTERCITY
          ? await ctx.tdx.bus.interCity.eta(args.routeName)
          : await ctx.tdx.bus.eta(where, args.routeName);
      if (!etas.length) throw noRoute(args.routeName, where);
      let rows = etas
        .filter(inDirection(args.direction))
        .sort((a, b) => a.Direction - b.Direction || (a.StopSequence ?? 0) - (b.StopSequence ?? 0));
      if (args.stop) {
        const matched = search(rows, (e) => [e.StopName?.Zh_tw, e.StopName?.En], args.stop);
        if (!matched.length) {
          const stops = [...new Set(rows.map((e) => e.StopName?.Zh_tw).filter(Boolean))];
          throw new ToolInputError(
            `No stop on route ${args.routeName} matches "${args.stop}". Its stops include: ` +
              `${stops.slice(0, 40).join('、')}${stops.length > 40 ? '…' : ''}.`,
          );
        }
        rows = matched;
      }
      const items = rows.map((e) => ({
        stop: name(e.StopName),
        direction: DIRECTION[e.Direction],
        subRoute: e.SubRouteName?.Zh_tw !== e.RouteName?.Zh_tw ? name(e.SubRouteName) : undefined,
        arrival: arrival(e),
        minutes: minutes(e.EstimateTime),
        laterBusesMinutes: laterBuses(e),
        plate: e.PlateNumb && e.PlateNumb !== '-1' ? e.PlateNumb : undefined,
        lastBus: e.IsLastBus === true ? true : undefined,
        stopSequence: e.StopSequence ?? undefined,
      }));
      return list(items, take(ctx, args.limit, 200), {
        city: where,
        route: args.routeName,
        updated: etas[0]?.SrcUpdateTime ?? etas[0]?.UpdateTime,
      });
    },
  });

  defineTool(server, 'bus_positions', {
    title: 'Live bus positions',
    description:
      'Where the buses on a route are right now: position, speed, direction and status of ' +
      'each vehicle. Example: city "Taipei", routeName "307".',
    input: { city: busCity, routeName, direction },
    run: async (args) => {
      const where = busScope(args.city);
      const positions = (
        where === INTERCITY
          ? await ctx.tdx.bus.interCity.positions(args.routeName)
          : await ctx.tdx.bus.positions(where, args.routeName)
      ).filter(inDirection(args.direction));
      const items = positions.map((p: BusPosition) => ({
        plate: p.PlateNumb,
        direction: DIRECTION[p.Direction ?? 255],
        subRoute: p.SubRouteName?.Zh_tw !== p.RouteName?.Zh_tw ? name(p.SubRouteName) : undefined,
        lat: p.BusPosition?.PositionLat ?? undefined,
        lon: p.BusPosition?.PositionLon ?? undefined,
        speedKmh: p.Speed ?? undefined,
        status: p.BusStatus == null ? undefined : VEHICLE_STATUS[p.BusStatus],
        gpsTime: p.GPSTime,
      }));
      return list(items, ctx.maxItems, {
        city: where,
        route: args.routeName,
        note: items.length
          ? undefined
          : 'No vehicle is reporting on this route now: it may not be running, or the route ' +
            'name may be wrong (check it with bus_route_search).',
      });
    },
  });
}

/** `InterCity` (also 公路客運 / 國道客運) or a TDX city code. */
function busScope(input: string): string {
  return /^(inter-?city|公路客運|國道客運)$/i.test(input.trim()) ? INTERCITY : normalizeCity(input);
}

function inDirection(dir: 'outbound' | 'inbound' | undefined) {
  return (item: { Direction?: number | null }): boolean =>
    dir === undefined || item.Direction === (dir === 'outbound' ? 0 : 1);
}

function noRoute(route: string, where: string): ToolInputError {
  return new ToolInputError(
    `No data for route "${route}" in ${where}. Route names must match exactly; find the right ` +
      'one with bus_route_search.',
  );
}

function zhEn(zh: string | null | undefined, en: string | null | undefined): string | undefined {
  return name({ Zh_tw: zh, En: en });
}

function minutes(seconds: number | null | undefined): number | undefined {
  return seconds == null ? undefined : Math.floor(seconds / 60);
}

/** Readable arrival for one stop, from its stop status and estimate. */
function arrival(e: BusEstimatedTimeOfArrival): string {
  const status = e.StopStatus ?? 0;
  const special = STOP_STATUS[status];
  if (special) return special;
  const min = minutes(e.EstimateTime);
  if (status === 1) {
    const next = e.NextBusTime?.slice(11, 16) ?? e.ScheduledTime ?? undefined;
    if (min !== undefined) return `${min} min (bus not departed yet)`;
    return next ? `not departed yet; next bus at ${next}` : 'not departed yet';
  }
  if (min === undefined) return 'no estimate';
  return min === 0 ? 'arriving now' : `${min} min`;
}

/** Minutes to the buses after the first, when the source sends several estimates. */
function laterBuses(e: BusEstimatedTimeOfArrival): number[] | undefined {
  const later = (e.Estimates ?? [])
    .map((x) => minutes(x.EstimateTime))
    .filter((m): m is number => m !== undefined)
    .sort((a, b) => a - b)
    .slice(1);
  return later.length ? later : undefined;
}
