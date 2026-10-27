import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  ShipAlert,
  ShipCity,
  ShipDepartureLiveBoard,
  ShipLiveBoard,
  ShipLiveBoardName,
  ShipStopOfRoute,
} from 'tdx-taiwan';
import { z } from 'zod';
import { normalizeCity } from '../core/cities.js';
import type { ToolContext } from '../core/context.js';
import { ToolInputError } from '../core/errors.js';
import { FARE_CLASS } from '../core/fares.js';
import { ALERT_LEVEL, type AnyName, arrayOf, name, plain, realTime } from '../core/format.js';
import { resolve, search } from '../core/names.js';
import { list } from '../core/respond.js';
import { after, date, limit, take } from '../core/schemas.js';
import { clockOf, duration, padTime, startTime, taipeiNow } from '../core/time.js';
import { defineTool } from '../core/tool.js';

/** Cities with county-run ferry feeds (藍色公路); TDX has data for the first five. */
const SHIP_CITIES = [
  'PenghuCounty',
  'Kaohsiung',
  'NewTaipei',
  'Taipei',
  'KinmenCounty',
  'LienchiangCounty',
  'PingtungCounty',
  'TaitungCounty',
  'NantouCounty',
] as const satisfies readonly ShipCity[];

const ALERT_STATUS: Record<number, string> = { 0: 'suspended', 1: 'normal', 2: 'disrupted' };
const ALERT_EFFECT: Record<number, string> = {
  1: 'rerouted',
  2: 'extra sailings',
  3: 'fewer sailings',
  4: 'sailings cancelled',
  5: 'sailings changed',
  6: 'port skipped',
  7: 'major delay',
};
const TICKET_TYPE: Record<number, string> = {
  1: 'single',
  2: 'return',
  3: 'e-ticket',
  4: 'multi-ride',
};
const FERRY_FARE_CLASS: Record<number, string> = {
  ...FARE_CLASS,
  9: 'militaryPolice',
  254: 'other',
};

const port = (role: string) =>
  z
    .string()
    .trim()
    .min(1)
    .describe(`${role} port: name (綠島, 富岡, 小琉球, 基隆, 南竿) or port ID (TWGNI).`);

const shipCity = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe(
    'Leave out for the nationwide ferries (outlying islands, 小三通). For lines run by a ' +
      `county or city, its code: ${SHIP_CITIES.slice(0, 5).join(', ')} (Penghu inter-island ` +
      'boats, 旗津 ferry, 淡水 blue highway, 金門 local ferries).',
  );

/** A port, with every name the stop lists give it. */
interface Port {
  id: string;
  names: AnyName[];
}

/** What a port name stands for: one port, or the ports of one island (小琉球: 白沙, 大福). */
interface Place {
  ports: Port[];
  ids: Set<string>;
  label: string;
}

/** Most ports one name may stand for; more is an ambiguous name. */
const MAX_PORTS = 3;

export function registerShipTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, 'ferry_timetable', {
    title: 'Ferry timetable',
    description:
      'Ferry sailings from one port to another on a day, with times and, for today, live ' +
      'status (on time, departed, cancelled) and service alerts such as typhoon suspensions. ' +
      'Example: from "富岡", to "綠島"; or from "馬公", to "七美", city "PenghuCounty".',
    input: {
      from: port('Departure'),
      to: port('Arrival'),
      city: shipCity,
      date,
      after,
      limit: limit(20, 'sailings'),
    },
    run: async (args) => {
      const city = shipCityOf(args.city);
      const stops = await stopLists(ctx, city);
      const [from, to] = placePair(stops, args.from, args.to, city);
      const day = args.date ?? taipeiNow().date;
      const start = startTime(day, args.after);
      const routeIds = [...new Set(stops.map((r) => r.RouteID))].filter((id) => {
        const calls = stopsOf(stops, id);
        return [...from.ids].some((p) => calls.has(p)) && [...to.ids].some((p) => calls.has(p));
      });
      if (!routeIds.length) {
        throw new ToolInputError(
          `No ${city ? `${city} ` : ''}ferry route calls at both ${from.label} and ` +
            `${to.label}.${city ? '' : ` ${CITY_HINT}`}`,
        );
      }
      const [schedules, live, alerts] = await Promise.all([
        Promise.all(
          routeIds.map((id) =>
            city ? ctx.tdx.ship.domestic.dailySchedule(city, id) : ctx.tdx.ship.dailySchedule(id),
          ),
        ),
        city ? undefined : ctx.tdx.ship.liveBoard().catch(() => undefined),
        (city ? ctx.tdx.ship.domestic.alerts(city) : ctx.tdx.ship.alerts()).catch(() => undefined),
      ]);
      const boards = new Map(
        arrayOf(live?.ShipLiveBoardses)
          .filter((b) => b.ShipDate?.slice(0, 10) === day)
          .map((b) => [b.PortID, b]),
      );
      const sailings = schedules
        .flatMap((s) => arrayOf(s.DailySchedules))
        .filter((s) => s.Date.replaceAll('/', '-') === day)
        .flatMap((s) =>
          arrayOf(s.TimeTables).flatMap((trip) => {
            const calls = [...trip.StopTimes].sort((a, b) => a.StopSequence - b.StopSequence);
            // Loop trips call at the same ports again and again: pair each departure from
            // `from` with the next call at `to`.
            return calls.flatMap((call, i) => {
              if (!from.ids.has(call.PortID) || !call.DepartureTime) return [];
              const next = calls.slice(i + 1).find((c) => to.ids.has(c.PortID) && c.ArrivalTime);
              if (!next) return [];
              return [
                {
                  route: s.RouteID,
                  routeName: name(s.RouteName),
                  fromPort: call.PortID,
                  toPort: next.PortID,
                  departs: padTime(call.DepartureTime) ?? '',
                  arrives: padTime(next.ArrivalTime),
                  trip: trip.TripID,
                },
              ];
            });
          }),
        )
        .filter((s) => s.departs >= start)
        .sort((a, b) => a.departs.localeCompare(b.departs));
      const items = sailings.map((s) => {
        const status = boards
          .get(s.fromPort)
          ?.DepartureLiveBoards?.find(
            (d) => d.RouteID === s.route && clockOf(d.ScheduledDepartureTime) === s.departs,
          );
        return {
          departs: s.departs,
          arrives: s.arrives,
          duration: duration(s.departs, s.arrives),
          from: portOf(from, s.fromPort),
          to: portOf(to, s.toPort),
          route: s.routeName ?? s.route,
          trip: s.trip,
          ...(status && liveDeparture(status)),
        };
      });
      const inForce = arrayOf(alerts?.Alerts).filter(
        (a) =>
          a.Status !== 1 &&
          alertCovers(a, day) &&
          (a.Scope?.Routes?.some((r) => routeIds.includes(r.RouteID)) ||
            a.Scope?.Ports?.some((p) => from.ids.has(p.PortID) || to.ids.has(p.PortID))),
      );
      return list(items, take(ctx, args.limit, 20), {
        from: from.label,
        to: to.label,
        date: day,
        after: start,
        alerts: inForce.length ? inForce.map(describeAlert) : undefined,
        note: items.length
          ? undefined
          : `No sailing from ${from.label} to ${to.label} on ${day} after ${start} in TDX's ` +
            'daily timetables; sailings depend on the season and the weather.',
      });
    },
  });

  defineTool(server, 'ferry_live_board', {
    title: 'Ferry port live board',
    description:
      "A ferry port's live departures and arrivals for today: scheduled, estimated and actual " +
      'times, vessel and status (on time, departed, cancelled with the reason). About 25 ' +
      'ports have a board (小琉球, 東港, 綠島, 富岡, 南竿, 金門水頭, ...); use ferry_timetable for ' +
      'the others. Example: port "小琉球".',
    input: { port: port('The'), limit: limit(40, 'sailings') },
    run: async (args) => {
      const [live, { Routes: routes }] = await Promise.all([
        ctx.tdx.ship.liveBoard(),
        ctx.tdx.ship.routes(),
      ]);
      let boards: ShipLiveBoard[];
      try {
        boards = resolve(
          arrayOf(live.ShipLiveBoardses).filter((b) => b.PortID),
          args.port,
          {
            names: (b) => [b.PortName?.ZhTw, b.PortName?.En],
            ids: (b) => [b.PortID],
            label: 'ferry port with a live board',
            many: true,
          },
        );
        if (boards.length > MAX_PORTS)
          throw ambiguous(
            args.port,
            boards.map((b) => boardName(b.PortName)),
          );
      } catch (error) {
        if (error instanceof ToolInputError) {
          throw new ToolInputError(`${error.message} For other ports, use ferry_timetable.`);
        }
        throw error;
      }
      const routeName = new Map(arrayOf(routes).map((r) => [r.RouteID, name(r.RouteName)]));
      const route = (id: string | undefined) => id && (routeName.get(id) ?? id);
      const items = boards
        .flatMap((board) => {
          const port = boards.length > 1 ? boardName(board.PortName) : undefined;
          const departures = arrayOf(board.DepartureLiveBoards).map((d) => ({
            kind: 'departure',
            time: clockOf(d.ScheduledDepartureTime),
            port,
            to: boardName(d.ArrivalPortName) ?? d.ArrivalPortID,
            route: route(d.RouteID),
            vessel: name(d.VesselName),
            ...liveDeparture(d),
          }));
          const arrivals = arrayOf(board.ArrivalLiveBoards).map((a) => {
            const scheduled = clockOf(a.ScheduledArrivalTime);
            const estimated = clockOf(a.EstimateArrivalTime);
            return {
              kind: 'arrival',
              time: scheduled,
              port,
              from: boardName(a.DeparturePortName) ?? a.DeparturePortID,
              route: route(a.RouteID),
              vessel: name(a.VesselName),
              status: remark(a.ArrivalRemarkEn, a.ArrivalRemark),
              estimated: estimated !== scheduled ? estimated : undefined,
              actual: clockOf(a.ActualArrivalTime),
              cancelReason: a.CancelReason || undefined,
              notice: a.ChangeNotice || undefined,
            };
          });
          return [...departures, ...arrivals];
        })
        .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
      return list(items, take(ctx, args.limit, 40), {
        port: boards.map((b) => boardName(b.PortName) ?? b.PortID).join('、'),
        date: boards[0]?.ShipDate?.slice(0, 10),
        updated: boards[0]?.UpdateTime,
      });
    },
  });

  defineTool(server, 'ferry_fare', {
    title: 'Ferry fares',
    description:
      'Ferry fares in NT$ between two ports, per route, ticket, cabin and passenger type. ' +
      'Example: from "基隆", to "南竿".',
    input: { from: port('Departure'), to: port('Arrival'), city: shipCity },
    run: async (args) => {
      const city = shipCityOf(args.city);
      const stops = await stopLists(ctx, city);
      const [from, to] = placePair(stops, args.from, args.to, city);
      const pairs = [...from.ids].flatMap((o) => [...to.ids].map((d) => [o, d] as const));
      const cityFares = city ? arrayOf((await ctx.tdx.ship.domestic.odFare(city)).RouteFares) : [];
      const perPair = await Promise.all(
        pairs.map(async ([origin, destination]) => ({
          origin,
          destination,
          routes: city ? cityFares : await ctx.tdx.ship.odFareBetween(origin, destination),
        })),
      );
      const items = perPair
        .flatMap(({ origin, destination, routes }) =>
          routes.flatMap((r) =>
            r.ODFares.filter(
              (od) =>
                od.OriginPort?.PortID === origin && od.DestinationPort?.PortID === destination,
            ).flatMap((od) =>
              od.Fares.map((f) => ({
                route: name(r.RouteName) ?? r.RouteID,
                from: portOf(from, origin),
                to: portOf(to, destination),
                ticket: f.FareName || undefined,
                cabin: f.CabinClass || undefined,
                passenger: FERRY_FARE_CLASS[f.FareClass] ?? `class ${f.FareClass}`,
                type: TICKET_TYPE[f.TicketType] ?? `type ${f.TicketType}`,
                ticketType: f.TicketType,
                price: f.Price,
              })),
            ),
          ),
        )
        .sort((a, b) => a.ticketType - b.ticketType || a.price - b.price)
        .map(({ ticketType: _, ...fare }) => fare)
        // Each operator on a route publishes its own copy of the same fares.
        .filter((fare, i, all) => {
          const key = JSON.stringify(fare);
          return all.findIndex((other) => JSON.stringify(other) === key) === i;
        });
      return list(items, ctx.maxItems, {
        from: from.label,
        to: to.label,
        note: items.length ? undefined : 'TDX has no fares between these ports.',
      });
    },
  });

  defineTool(server, 'ferry_alerts', {
    title: 'Ferry service alerts',
    description:
      'Current ferry service alerts: suspensions for typhoons or rough seas, cancelled or ' +
      'changed sailings, with the routes and ports they affect. Example: keyword "綠島"; or ' +
      'no input for every alert.',
    input: {
      keyword: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe('Only alerts whose title, route or port contains this, e.g. "綠島".'),
      city: shipCity,
    },
    run: async (args) => {
      const city = shipCityOf(args.city);
      const alerts = arrayOf(
        (await (city ? ctx.tdx.ship.domestic.alerts(city) : ctx.tdx.ship.alerts())).Alerts,
      );
      const found = args.keyword
        ? search(
            alerts,
            (a) => [
              a.Title,
              ...(a.Scope?.Routes ?? []).flatMap((r) => [r.RouteName?.Zh_tw, r.RouteName?.En]),
              ...(a.Scope?.Ports ?? []).flatMap((p) => [p.PortName?.Zh_tw, p.PortName?.En]),
            ],
            args.keyword,
          )
        : alerts;
      return list(found.map(describeAlert), ctx.maxItems, {
        note: found.length
          ? undefined
          : args.keyword
            ? `No ferry alert mentions "${args.keyword}".`
            : 'No ferry alerts: sailings run as scheduled.',
      });
    },
  });
}

const CITY_HINT =
  'Lines run by a county (Penghu inter-island boats, 旗津, 淡水) need city, e.g. "PenghuCounty".';

function shipCityOf(input: string | undefined): ShipCity | undefined {
  if (!input) return undefined;
  const code = normalizeCity(input);
  if (!(SHIP_CITIES as readonly string[]).includes(code)) {
    throw new ToolInputError(
      `"${input}" has no county ferry feed. Use one of ${SHIP_CITIES.join(', ')}, or leave ` +
        'city out for the nationwide ferries.',
    );
  }
  return code;
}

/** Every route's stop list in each direction: the nationwide feed, or a city's. */
async function stopLists(
  ctx: ToolContext,
  city: ShipCity | undefined,
): Promise<readonly ShipStopOfRoute[]> {
  const wrapper = city
    ? await ctx.tdx.ship.domestic.stopsOfRoute(city)
    : await ctx.tdx.ship.stopsOfRoute();
  return arrayOf(wrapper.StopOfRoutes);
}

/** The port IDs a route calls at, in any direction. */
function stopsOf(stops: readonly ShipStopOfRoute[], routeId: string): Set<string> {
  return new Set(
    stops.filter((r) => r.RouteID === routeId).flatMap((r) => r.Stops.map((s) => s.PortID)),
  );
}

/** The places `from` and `to` name, which must not share a port. */
function placePair(
  stops: readonly ShipStopOfRoute[],
  from: string,
  to: string,
  city: ShipCity | undefined,
): [Place, Place] {
  const ports = new Map<string, Port>();
  for (const stop of stops.flatMap((r) => r.Stops)) {
    const known = ports.get(stop.PortID) ?? { id: stop.PortID, names: [] };
    if (!known.names.some((n) => n.Zh_tw === stop.PortName.Zh_tw)) known.names.push(stop.PortName);
    ports.set(stop.PortID, known);
  }
  const find = (input: string): Place => {
    let found: Port[];
    try {
      found = resolve([...ports.values()], input, {
        names: (p) => p.names.flatMap((n) => [n.Zh_tw, n.En]),
        ids: (p) => [p.id],
        label: city ? `${city} ferry port` : 'ferry port',
        many: true,
      });
    } catch (error) {
      if (error instanceof ToolInputError && !city) {
        throw new ToolInputError(`${error.message} ${CITY_HINT}`);
      }
      throw error;
    }
    if (found.length > MAX_PORTS) throw ambiguous(input, found.map(portLabel));
    return {
      ports: found,
      ids: new Set(found.map((p) => p.id)),
      label: found.map(portLabel).join('、'),
    };
  };
  const origin = find(from);
  const destination = find(to);
  if ([...origin.ids].some((id) => destination.ids.has(id))) {
    throw new ToolInputError(`"${from}" and "${to}" are the same port.`);
  }
  return [origin, destination];
}

function portLabel(port: Port): string {
  return name(port.names[0]) ?? port.id;
}

/** The port's name when the place has several ports, so each row says which one. */
function portOf(place: Place, id: string): string | undefined {
  if (place.ports.length < 2) return undefined;
  const port = place.ports.find((p) => p.id === id);
  return port ? portLabel(port) : id;
}

function ambiguous(input: string, names: Array<string | undefined>): ToolInputError {
  return new ToolInputError(
    `"${input}" matches ${names.length} ports: ${names.filter(Boolean).join('、')}. Give the full name.`,
  );
}

/** Live board names are spelt `ZhTw`. */
function boardName(value: ShipLiveBoardName | undefined): string | undefined {
  return name(value && { Zh_tw: value.ZhTw, En: value.En });
}

function remark(english: string | undefined, chinese: string | undefined): string | undefined {
  return english?.trim().toLowerCase() || chinese?.trim() || undefined;
}

function liveDeparture(d: ShipDepartureLiveBoard) {
  const scheduled = clockOf(d.ScheduledDepartureTime);
  const estimated = clockOf(d.EstimateDepartureTime);
  return {
    status: remark(d.DepartureRemarkEn, d.DepartureRemark),
    estimated: estimated !== scheduled ? estimated : undefined,
    actual: clockOf(d.ActualDepartureTime),
    cancelReason: d.CancelReason || undefined,
    notice: d.ChangeNotice || undefined,
  };
}

/** Whether the alert is in force on `day` (open-ended when it has no end). */
function alertCovers(alert: ShipAlert, day: string): boolean {
  const start = realTime(alert.StartTime)?.slice(0, 10);
  const end = realTime(alert.EndTime)?.slice(0, 10);
  return (!start || start <= day) && (!end || day <= end);
}

function describeAlert(a: ShipAlert) {
  const description = plain(a.Description);
  return {
    title: a.Title,
    status: ALERT_STATUS[a.Status],
    description: description !== plain(a.Title) ? description : undefined,
    level: a.Level == null ? undefined : ALERT_LEVEL[a.Level],
    cause: a.Cause || undefined,
    effect: a.Effect == null ? undefined : ALERT_EFFECT[a.Effect],
    routes: a.Scope?.Routes?.map((r) => name(r.RouteName) ?? r.RouteID),
    ports: a.Scope?.Ports?.map((p) => name(p.PortName) ?? p.PortID),
    start: realTime(a.StartTime),
    end: realTime(a.EndTime),
    published: realTime(a.PublishTime),
    url: a.AlertURL || undefined,
  };
}
