import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TrafficETagPair, TrafficETagPairLive } from 'tdx-taiwan';
import { z } from 'zod';
import type { ToolContext } from '../core/context.js';
import { ToolInputError } from '../core/errors.js';
import { arrayOf } from '../core/format.js';
import { resolve } from '../core/names.js';
import { ok } from '../core/respond.js';
import { defineTool } from '../core/tool.js';

/** eTag vehicle classes, best first, for a car's travel time: 小客車, 小貨車, then the rest. */
const CAR_TYPES = [31, 32, 41, 42, 5];
/** Speed assumed for a segment without a live travel time, km/h. */
const FALLBACK_KMH = 90;

const interchange = (role: string) =>
  z
    .string()
    .trim()
    .min(1)
    .describe(
      `${role} freeway interchange or junction, in Chinese as the freeway signs name it: ` +
        '林口, 新竹, 臺中系統, 五股, 南港.',
    );

/** An eTag pair: the path between two gantries, named after the interchanges it joins. */
interface Segment {
  pair: TrafficETagPair;
  from: string[];
  to: string[];
  seconds: number;
  estimated: boolean;
  speed: number | undefined;
}

export function registerTravelTimeTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, 'traffic_travel_time', {
    title: 'Freeway travel time',
    description:
      'How long a car takes right now between two national freeway (國道) interchanges, from ' +
      'live eTag gantry times: the fastest route, its distance and average speed, and the time ' +
      'and speed of each segment so slow stretches stand out. Example: from "林口", to "新竹".',
    input: { from: interchange('Starting'), to: interchange('Destination') },
    run: async (args) => {
      const [pairs, live] = await Promise.all([
        ctx.tdx.traffic.freeway.etagPairs(),
        ctx.tdx.traffic.freeway.etagPairLive(),
      ]);
      const segments = buildSegments(arrayOf(pairs.ETagPairs), arrayOf(live.ETagPairLives));
      const places = [...new Set(segments.flatMap((s) => [...s.from, ...s.to]))];
      const origin = findPlaces(places, args.from);
      const destination = findPlaces(places, args.to);
      if ([...origin].some((p) => destination.has(p))) {
        throw new ToolInputError(`"${args.from}" and "${args.to}" are the same interchange.`);
      }
      const path = fastestPath(
        segments,
        (s) => s.from.some((p) => origin.has(p)),
        (s) => s.to.some((p) => destination.has(p)),
      );
      if (!path) {
        throw new ToolInputError(
          `No freeway route from ${[...origin].join('、')} to ${[...destination].join('、')} in ` +
            "TDX's eTag data.",
        );
      }
      const seconds = path.reduce((n, s) => n + s.seconds, 0);
      const km = path.reduce((n, s) => n + s.pair.Distance, 0);
      const estimated = path.filter((s) => s.estimated).length;
      const updated = arrayOf(live.ETagPairLives)
        .map((l) => l.DataCollectTime)
        .sort()
        .at(-1);
      return ok({
        from: path[0]?.from.join('&'),
        to: path.at(-1)?.to.join('&'),
        travelTime: clockText(seconds),
        minutes: Math.round(seconds / 60),
        distanceKm: Math.round(km * 10) / 10,
        averageSpeedKmh: Math.round(km / (seconds / 3600)),
        roads: [...new Set(path.map((s) => roadName(s.pair.StartETagGantryID)))],
        segments: path.map((s) => ({
          road: roadName(s.pair.StartETagGantryID),
          between: s.pair.Description,
          km: s.pair.Distance,
          time: clockText(s.seconds),
          speedKmh: s.speed,
          estimated: s.estimated || undefined,
        })),
        note: estimated
          ? `${estimated} of ${path.length} segments have no live car time and assume ` +
            `${FALLBACK_KMH} km/h.`
          : undefined,
        updated,
      });
    },
  });
}

/** Segments with their live car travel time, or a time estimated from the distance. */
function buildSegments(
  pairs: readonly TrafficETagPair[],
  live: readonly TrafficETagPairLive[],
): Segment[] {
  const flows = new Map(live.map((l) => [l.ETagPairID, l.Flows]));
  return pairs.map((pair) => {
    const [from = '', to = ''] = pair.Description.split('-');
    const pairFlows = flows.get(pair.ETagPairID) ?? [];
    const flow = CAR_TYPES.map((type) =>
      pairFlows.find((f) => f.VehicleType === type && f.TravelTime > 0),
    ).find(Boolean);
    const seconds = flow ? flow.TravelTime : (pair.Distance / FALLBACK_KMH) * 3600;
    return {
      pair,
      from: from.split('&'),
      to: to.split('&'),
      seconds,
      estimated: !flow,
      speed: flow && flow.SpaceMeanSpeed > 0 ? flow.SpaceMeanSpeed : undefined,
    };
  });
}

/**
 * The interchanges `input` names: an exact name, else every best partial match ("新竹" is
 * 新竹(新竹、竹東), 新竹(科學園區) and 新竹系統), so the route may start at any of them.
 */
function findPlaces(places: readonly string[], input: string): Set<string> {
  const cleaned =
    input
      .trim()
      .replace(/(交流道|interchange)$/i, '')
      .trim() || input;
  return new Set(
    resolve(places, cleaned, { names: (p) => [p], label: 'freeway interchange', many: true }),
  );
}

/**
 * Dijkstra over segments, a segment leading to every segment starting at its end gantry:
 * the quickest chain from a segment that `starts` to one that `ends`.
 */
function fastestPath(
  segments: readonly Segment[],
  starts: (s: Segment) => boolean,
  ends: (s: Segment) => boolean,
): Segment[] | undefined {
  const next = new Map<string, Segment[]>();
  for (const s of segments) {
    const list = next.get(s.pair.StartETagGantryID) ?? [];
    next.set(s.pair.StartETagGantryID, [...list, s]);
  }
  const best = new Map<Segment, number>();
  const previous = new Map<Segment, Segment>();
  const open = new Set<Segment>();
  for (const s of segments.filter(starts)) {
    best.set(s, s.seconds);
    open.add(s);
  }
  while (open.size) {
    let current: Segment | undefined;
    for (const s of open) {
      if (!current || (best.get(s) ?? Infinity) < (best.get(current) ?? Infinity)) current = s;
    }
    if (!current) break;
    open.delete(current);
    if (ends(current)) {
      const path = [current];
      for (let s = previous.get(current); s; s = previous.get(s)) path.unshift(s);
      return path;
    }
    const time = best.get(current) ?? Infinity;
    for (const s of next.get(current.pair.EndETagGantryID) ?? []) {
      if (time + s.seconds < (best.get(s) ?? Infinity)) {
        best.set(s, time + s.seconds);
        previous.set(s, current);
        open.add(s);
      }
    }
  }
  return undefined;
}

/** `國道1號` for gantry `01F0005S`; `01H` is the 五楊 viaduct, `03A` the 3A spur. */
function roadName(gantryId: string): string {
  const code = gantryId.slice(0, 3);
  const number = Number(code.slice(0, 2));
  if (code.endsWith('F')) return `國道${number}號`;
  if (code.endsWith('H')) return `國道${number}號高架`;
  if (code.endsWith('A')) return `國道${number}甲`;
  return code;
}

/** `1h 05m`, `28m`, or `45s` under a minute. */
function clockText(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes === 0) return `${Math.round(seconds)}s`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
