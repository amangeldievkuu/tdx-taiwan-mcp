import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  MetroFrequency,
  MetroLine,
  MetroLineTransfer,
  MetroS2STravelTime,
  MetroStationOfRoute,
} from 'tdx-taiwan';
import { z } from 'zod';
import type { ToolContext } from '../core/context.js';
import { ToolInputError } from '../core/errors.js';
import { name } from '../core/format.js';
import { shortestPath, type Step } from '../core/graph.js';
import { resolve } from '../core/names.js';
import { ok } from '../core/respond.js';
import { clock, clockText, taipeiNow } from '../core/time.js';
import { defineTool } from '../core/tool.js';
import { TRAIN_TYPE } from './metro.js';
import {
  type MetroSystemCode,
  METRO_SYSTEMS,
  type RailStation,
  stationsOf,
} from './rail-stations.js';

/** Each choice and the systems whose data make up its network. */
const NETWORKS = {
  TRTC: ['TRTC', 'NTMC'],
  KRTC: ['KRTC'],
  TMRT: ['TMRT'],
  TYMC: ['TYMC'],
} as const satisfies Record<string, readonly MetroSystemCode[]>;
type Network = keyof typeof NETWORKS;

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const station = (role: string) =>
  z
    .string()
    .trim()
    .min(1)
    .describe(
      `${role} station: name (台北車站, 台北101/世貿, Ximen, 美麗島) or station ID (BL12).`,
    );

/** What a step of the route is: riding a line between two adjacent stations, or changing. */
type Move =
  | { kind: 'ride'; line: string; routes: Set<string>; estimated: boolean }
  | { kind: 'walk'; fromLine: string; toLine: string };

/** Everything the networks of one choice publish, merged. */
interface NetworkData {
  stations: RailStation[];
  travelTimes: MetroS2STravelTime[];
  transfers: MetroLineTransfer[];
  /** Ordered stations of each route: current where the run times are not (廣慈/奉天宮). */
  routes: MetroStationOfRoute[];
  lines: MetroLine[];
  frequency: MetroFrequency[];
}

export function registerMetroTripTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, 'metro_travel_time', {
    title: 'Metro journey time',
    description:
      'How long a metro journey takes between two stations, with the line changes: each leg ' +
      'with its line, direction (toward) and stops, the walking time at each change, how ' +
      'often trains run now and the expected wait. TRTC covers Taipei and New Taipei ' +
      '(including the Circular line); also Kaohsiung, Taichung and the Taoyuan airport line ' +
      '(express and local). Example: system "TRTC", from "台北車站", to "台北101/世貿".',
    input: {
      system: z
        .enum(Object.keys(NETWORKS) as [Network, ...Network[]])
        .describe(
          'TRTC (臺北捷運 with 新北捷運: 環狀線, 三鶯線), KRTC (高雄捷運), TMRT (臺中捷運) or ' +
            'TYMC (桃園機場捷運).',
        ),
      from: station('Starting'),
      to: station('Destination'),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
        .optional()
        .describe(
          'Day of travel in Taiwan, YYYY-MM-DD, for how often trains run (default: today).',
        ),
    },
    run: async (args) => {
      const data = await networkData(ctx, args.system);
      const find = (input: string) =>
        resolve(data.stations, input, {
          names: (s) => [s.name.Zh_tw, s.name.En],
          ids: (s) => [s.id],
          label: `${args.system} station`,
        });
      const from = find(args.from);
      const to = find(args.to);
      if (from.some((f) => to.some((t) => t.id === f.id || sameName(f, t)))) {
        throw new ToolInputError(`"${args.from}" and "${args.to}" are the same station.`);
      }
      const now = taipeiNow();
      const clockNow = args.date && args.date !== now.date ? undefined : now.time;
      const weekday = WEEKDAYS[new Date(`${args.date ?? now.date}T12:00:00+08:00`).getUTCDay()];
      const headway = (line: string, trainType?: number) =>
        clockNow && weekday
          ? headwayNow(data.frequency, line, weekday, clockNow, trainType)
          : undefined;
      const stationName = new Map(data.stations.map((s) => [s.id, name(s.name) ?? s.id]));
      const label = (id: string) => stationName.get(id) ?? id;

      if (args.system === 'TYMC') return ok(airportLine(data, from, to, label, headway));

      const steps = networkSteps(data);
      const path = shortestPath(
        steps,
        new Set(from.map((s) => s.id)),
        new Set(to.map((s) => s.id)),
      );
      if (!path?.length) {
        throw new ToolInputError(
          `No route from ${label(from[0].id)} to ${label(to[0].id)} in TDX's ${args.system} data.`,
        );
      }
      const lineName = new Map(data.lines.map((l) => [l.LineID, name(l.LineName) ?? l.LineID]));
      const lineLabel = (id: string) => lineName.get(id) ?? id;
      const selfTransfers = new Map(
        data.transfers
          .filter((t) => t.FromStationID === t.ToStationID)
          .map((t) => [t.FromStationID, t.TransferTime]),
      );

      // Group the ride steps into legs: one per line, split where the train changes on a
      // branch (七張, 大橋頭, 北投), which TDX lists as a same-station transfer.
      const legs: Array<{
        line: string;
        stations: string[];
        seconds: number;
        routes: Set<string>;
        estimated: boolean;
      }> = [];
      const changes: Array<{ at: string; fromLine: string; toLine: string; walkMinutes: number }> =
        [];
      for (const step of path) {
        const move = step.data;
        if (move.kind === 'walk') {
          changes.push({
            at: label(step.from),
            fromLine: lineLabel(move.fromLine),
            toLine: lineLabel(move.toLine),
            walkMinutes: Math.round(step.cost / 60),
          });
          continue;
        }
        const leg = legs.at(-1);
        const continues =
          leg &&
          leg.line === move.line &&
          leg.stations.at(-1) === step.from &&
          !(selfTransfers.has(step.from) && ![...move.routes].some((r) => leg.routes.has(r)));
        if (leg && continues) {
          leg.stations.push(step.to);
          leg.seconds += step.cost;
          leg.estimated ||= move.estimated;
          leg.routes = new Set([...move.routes].filter((r) => leg.routes.has(r)));
          continue;
        }
        if (leg && leg.line === move.line && leg.stations.at(-1) === step.from) {
          const minutes = selfTransfers.get(step.from) ?? 0;
          changes.push({
            at: label(step.from),
            fromLine: lineLabel(move.line),
            toLine: lineLabel(move.line),
            walkMinutes: minutes,
          });
        }
        legs.push({
          line: move.line,
          stations: [step.from, step.to],
          seconds: step.cost,
          routes: new Set(move.routes),
          estimated: move.estimated,
        });
      }

      const shown = legs.map((leg) => {
        const every = headway(leg.line);
        return {
          line: lineLabel(leg.line),
          from: label(leg.stations[0] ?? ''),
          to: label(leg.stations.at(-1) ?? ''),
          toward: toward(data, leg.stations[0] ?? '', leg.stations.at(-1) ?? '', label),
          stops: leg.stations.length - 1,
          minutes: Math.round(leg.seconds / 60),
          estimated: leg.estimated || undefined,
          trainsEvery: every?.text,
          wait: every?.wait,
        };
      });
      const rideSeconds = legs.reduce((n, l) => n + l.seconds, 0);
      const walkMinutes = changes.reduce((n, c) => n + c.walkMinutes, 0);
      const seconds = rideSeconds + walkMinutes * 60;
      const waits = shown.map((l) => l.wait);
      const waitMinutes = waits.every((w) => w !== undefined)
        ? Math.round(waits.reduce((n, w) => n + w, 0))
        : undefined;
      return ok({
        system: args.system,
        from: label(path[0]?.from ?? ''),
        to: label(path.at(-1)?.to ?? ''),
        travelTime: clockText(seconds),
        minutes: Math.round(seconds / 60),
        waitMinutes,
        withWaitsMinutes:
          waitMinutes === undefined ? undefined : Math.round(seconds / 60) + waitMinutes,
        transfers: changes.length,
        legs: shown.map(({ wait: _, ...leg }) => leg),
        changes: changes.length ? changes : undefined,
        note:
          [
            waitMinutes === undefined
              ? 'Riding and walking time only; waits depend on when you start (see metro_frequency).'
              : undefined,
            legs.some((l) => l.estimated)
              ? 'TDX publishes no run time for part of this journey (a newer stretch of line); ' +
                'that part is estimated from the line’s other stretches.'
              : undefined,
          ]
            .filter(Boolean)
            .join(' ') || undefined,
      });
    },
  });
}

/**
 * Stations, run times, transfers, route stop lists, line names and headways of every system
 * involved. The lists the route needs come first; the others fill gaps and enrich the answer,
 * so they follow and are dropped if TDX refuses them (its per-minute limit counts every call).
 */
async function networkData(ctx: ToolContext, network: Network): Promise<NetworkData> {
  const systems = NETWORKS[network];
  const metro = ctx.tdx.metro;
  const essential = await Promise.all(
    systems.map((system) =>
      Promise.all([
        stationsOf(ctx, system),
        metro.s2sTravelTime(system),
        metro.lineTransfers(system).catch((): MetroLineTransfer[] => []),
      ]),
    ),
  );
  const extra = await Promise.all(
    systems.map((system) =>
      Promise.all([
        metro.stationsOfRoute(system).catch((): MetroStationOfRoute[] => []),
        metro.lines(system).catch((): MetroLine[] => []),
        metro.frequency(system).catch((): MetroFrequency[] => []),
      ]),
    ),
  );
  return {
    stations: essential.flatMap(([stations]) => stations),
    travelTimes: essential.flatMap(([, travelTimes]) => travelTimes),
    transfers: essential.flatMap(([, , transfers]) => transfers),
    routes: extra.flatMap(([routes]) => routes),
    lines: extra.flatMap(([, lines]) => lines),
    frequency: extra.flatMap(([, , frequency]) => frequency),
  };
}

/**
 * Two-way steps: riding between adjacent stations (run plus dwell seconds, the fastest when
 * several routes share the stretch) and changing lines at an interchange. A stretch the route
 * stop lists have but the run times lack (TDX's run times predate 廣慈/奉天宮) gets the mean of
 * its line's known stretches, marked as estimated.
 */
function networkSteps(data: NetworkData): Step<Move>[] {
  const rides = new Map<
    string,
    {
      a: string;
      b: string;
      seconds: number;
      line: string;
      routes: Set<string>;
      estimated: boolean;
    }
  >();
  for (const route of data.travelTimes) {
    for (const t of route.TravelTimes) {
      if (t.FromStationID === t.ToStationID) continue;
      const [a, b] = [t.FromStationID, t.ToStationID].sort() as [string, string];
      const key = `${a}|${b}`;
      const seconds = t.RunTime + (t.StopTime ?? 0);
      const known = rides.get(key);
      if (known) {
        known.seconds = Math.min(known.seconds, seconds);
        known.routes.add(route.RouteID);
      } else {
        rides.set(key, {
          a,
          b,
          seconds,
          line: route.LineID,
          routes: new Set([route.RouteID]),
          estimated: false,
        });
      }
    }
  }
  const lineSeconds = new Map<string, number[]>();
  for (const r of rides.values())
    lineSeconds.set(r.line, [...(lineSeconds.get(r.line) ?? []), r.seconds]);
  for (const route of data.routes) {
    const ids = [...route.Stations].sort((a, b) => a.Sequence - b.Sequence).map((s) => s.StationID);
    for (const [i, id] of ids.slice(1).entries()) {
      const [a, b] = [ids[i] ?? '', id].sort() as [string, string];
      const key = `${a}|${b}`;
      const known = rides.get(key);
      if (known) {
        known.routes.add(route.RouteID);
        continue;
      }
      const times = lineSeconds.get(route.LineID) ?? [];
      const seconds = times.length ? times.reduce((n, t) => n + t, 0) / times.length : 120;
      rides.set(key, {
        a,
        b,
        seconds,
        line: route.LineID,
        routes: new Set([route.RouteID]),
        estimated: true,
      });
    }
  }
  const walks = new Map<
    string,
    { a: string; b: string; seconds: number; aLine: string; bLine: string }
  >();
  for (const t of data.transfers) {
    if (t.FromStationID === t.ToStationID) continue;
    const forward = t.FromStationID < t.ToStationID;
    const [a, b] = forward ? [t.FromStationID, t.ToStationID] : [t.ToStationID, t.FromStationID];
    const [aLine, bLine] = forward ? [t.FromLineID, t.ToLineID] : [t.ToLineID, t.FromLineID];
    const key = `${a}|${b}`;
    const seconds = t.TransferTime * 60;
    if ((walks.get(key)?.seconds ?? Infinity) > seconds)
      walks.set(key, { a, b, seconds, aLine, bLine });
  }
  return [
    ...[...rides.values()].flatMap((r) => {
      const data: Move = { kind: 'ride', line: r.line, routes: r.routes, estimated: r.estimated };
      return [
        { from: r.a, to: r.b, cost: r.seconds, data },
        { from: r.b, to: r.a, cost: r.seconds, data },
      ];
    }),
    ...[...walks.values()].flatMap((w): Array<Step<Move>> => [
      {
        from: w.a,
        to: w.b,
        cost: w.seconds,
        data: { kind: 'walk', fromLine: w.aLine, toLine: w.bLine },
      },
      {
        from: w.b,
        to: w.a,
        cost: w.seconds,
        data: { kind: 'walk', fromLine: w.bLine, toLine: w.aLine },
      },
    ]),
  ];
}

/**
 * The terminus in the direction of travel, from the longest route through both stations:
 * riding with its order ends at its last station, riding against it at its first. The route
 * stop lists are current; the run-time lists, also in order, stand in when they are missing.
 */
function toward(
  data: NetworkData,
  start: string,
  end: string,
  label: (id: string) => string,
): string | undefined {
  const fromStops = data.routes.map((r) =>
    [...r.Stations].sort((a, b) => a.Sequence - b.Sequence).map((s) => s.StationID),
  );
  const fromRunTimes = data.travelTimes.map((r) => {
    const times = [...r.TravelTimes].sort((a, b) => a.Sequence - b.Sequence);
    return [times[0]?.FromStationID, ...times.map((t) => t.ToStationID)].filter(
      (id): id is string => Boolean(id),
    );
  });
  const sequences = (fromStops.length ? fromStops : fromRunTimes)
    .filter((ids) => ids.includes(start) && ids.includes(end))
    .sort((a, b) => b.length - a.length);
  const ids = sequences[0];
  if (!ids) return undefined;
  const terminus = ids.indexOf(start) < ids.indexOf(end) ? ids.at(-1) : ids[0];
  return terminus ? label(terminus) : undefined;
}

/** The headway band of a line (and train type) covering `time` on that day, and half of it. */
function headwayNow(
  frequency: readonly MetroFrequency[],
  line: string,
  weekday: (typeof WEEKDAYS)[number],
  time: string,
  trainType?: number,
): { text: string; wait: number } | undefined {
  const minute = clock(time);
  for (const route of frequency) {
    if (route.LineID !== line || !route.ServiceDay[weekday]) continue;
    if (trainType !== undefined && route.TrainType && route.TrainType !== trainType) continue;
    const band = route.Headways.find((h) => {
      // Bands can run past midnight (TYMC: 05:30–00:30).
      const start = clock(h.StartTime);
      const end = clock(h.EndTime) <= start ? clock(h.EndTime) + 24 * 60 : clock(h.EndTime);
      const at = minute < start ? minute + 24 * 60 : minute;
      return at < end;
    });
    if (!band) continue;
    const text =
      band.MinHeadwayMins === band.MaxHeadwayMins
        ? `${band.MinHeadwayMins} min`
        : `${band.MinHeadwayMins}–${band.MaxHeadwayMins} min`;
    return { text, wait: (band.MinHeadwayMins + band.MaxHeadwayMins) / 4 };
  }
  return undefined;
}

/**
 * The Taoyuan airport line lists the time between every pair of stations, per train type, so
 * the answer is a lookup: one option per train type serving both stations.
 */
function airportLine(
  data: NetworkData,
  from: readonly RailStation[],
  to: readonly RailStation[],
  label: (id: string) => string,
  headway: (line: string, trainType?: number) => { text: string; wait: number } | undefined,
) {
  const fromIds = new Set(from.map((s) => s.id));
  const toIds = new Set(to.map((s) => s.id));
  const options = data.travelTimes.flatMap((route) => {
    const pair = route.TravelTimes.find(
      (t) => fromIds.has(t.FromStationID) && toIds.has(t.ToStationID),
    );
    if (!pair) return [];
    const seconds = pair.RunTime;
    const every = headway(route.LineID, route.TrainType ?? undefined);
    return [
      {
        trainType: route.TrainType ? TRAIN_TYPE[route.TrainType] : undefined,
        travelTime: clockText(seconds),
        minutes: Math.round(seconds / 60),
        trainsEvery: every?.text,
        waitMinutes: every ? Math.round(every.wait) : undefined,
      },
    ];
  });
  if (!options.length) {
    throw new ToolInputError(
      `No ${METRO_SYSTEMS.TYMC} time from ${label(from[0]?.id ?? '')} to ${label(to[0]?.id ?? '')}.`,
    );
  }
  options.sort((a, b) => a.minutes - b.minutes);
  return {
    system: 'TYMC',
    from: label(from[0]?.id ?? ''),
    to: label(to[0]?.id ?? ''),
    minutes: options[0]?.minutes,
    options,
    note:
      options.length > 1
        ? 'Express trains stop only at the main stations; locals stop everywhere.'
        : undefined,
  };
}

function sameName(a: RailStation, b: RailStation): boolean {
  return Boolean(a.name.Zh_tw) && a.name.Zh_tw === b.name.Zh_tw;
}
