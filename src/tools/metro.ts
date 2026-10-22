import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { odata } from 'tdx-taiwan';
import { z } from 'zod';
import type { ToolContext } from '../core/context.js';
import { ToolInputError } from '../core/errors.js';
import { fareTable } from '../core/fares.js';
import { name } from '../core/format.js';
import { list, ok } from '../core/respond.js';
import { defineTool } from '../core/tool.js';
import { findStation, metroSystem, type RailStation } from './rail-stations.js';

const SERVICE_STATUS: Record<number, string> = {
  1: 'not departed yet',
  2: 'not stopping here',
  3: 'last train has passed',
  4: 'no service today',
};
const TRAIN_TYPE: Record<number, string> = { 1: 'local', 2: 'express' };
const DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
  'NationalHolidays',
] as const;

const station = (role: string) =>
  z
    .string()
    .trim()
    .min(1)
    .describe(`${role} metro station: name (台北車站, Ximen, 美麗島) or station ID (BL12).`);

export function registerMetroTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, 'metro_live_board', {
    title: 'Metro next trains',
    description:
      'Minutes until the next metro trains at a station, per line and destination. KRTC, TYMC ' +
      'and KLRT list every station; TRTC (Taipei) only lists trains arriving right now, so ' +
      'an empty Taipei board is normal. Example: system "KRTC", station "美麗島".',
    input: {
      system: metroSystem(['TRTC', 'KRTC', 'TYMC', 'KLRT']),
      station: station('The').optional().describe('Station name or ID (default: every station).'),
    },
    run: async (args) => {
      const ids = args.station
        ? idsOf(await findStation(ctx, args.system, args.station))
        : undefined;
      const board = await ctx.tdx.metro.liveBoard(args.system);
      const items = board
        .filter((b) => !ids || ids.has(b.StationID))
        .map((b) => ({
          station: name(b.StationName),
          line: name(b.LineName) ?? b.LineID,
          to: name(b.DestinationStationName) ?? b.TripHeadSign,
          arrival: arrival(b.ServiceStatus, b.EstimateTime),
          minutes: b.EstimateTime ?? undefined,
        }))
        .sort(
          (a, b) =>
            (a.station ?? '').localeCompare(b.station ?? '') ||
            (a.minutes ?? 99) - (b.minutes ?? 99),
        );
      return list(items, ctx.maxItems, {
        system: args.system,
        updated: board[0]?.SrcUpdateTime,
        note:
          !items.length && args.system === 'TRTC'
            ? 'No Taipei Metro train is arriving at this station this minute (TDX lists only arriving trains).'
            : undefined,
      });
    },
  });

  defineTool(server, 'metro_fare', {
    title: 'Metro fares',
    description:
      'Metro single-journey fares between two stations in NT$, per passenger type, with the ' +
      'distance. Example: system "TRTC", from "台北車站", to "淡水".',
    input: {
      system: metroSystem(['TRTC', 'NTMC', 'TYMC', 'TMRT', 'KRTC', 'KLRT', 'NTDLRT', 'NTALRT']),
      from: station('Departure'),
      to: station('Arrival'),
    },
    run: async (args) => {
      const [from, to] = await Promise.all([
        findStation(ctx, args.system, args.from),
        findStation(ctx, args.system, args.to),
      ]);
      if (from.some((f) => to.some((t) => t.id === f.id))) {
        throw new ToolInputError(`"${args.from}" and "${args.to}" are the same station.`);
      }
      const [fare] = await ctx.tdx.metro.odFare(args.system, {
        filter: [anyOf('OriginStationID', from), anyOf('DestinationStationID', to)],
        top: 1,
      });
      if (!fare) {
        throw new ToolInputError(`TDX has no ${args.system} fare from ${args.from} to ${args.to}.`);
      }
      return ok({
        system: args.system,
        from: name(fare.OriginStationName),
        to: name(fare.DestinationStationName),
        distanceKm: fare.TravelDistance ?? undefined,
        prices: fareTable(fare.Fares, { 8: 'group' }),
      });
    },
  });

  defineTool(server, 'metro_first_last_train', {
    title: 'Metro first and last trains',
    description:
      'First and last train times at a metro station for each line and direction. Example: ' +
      'system "TRTC", station "台北車站".',
    input: {
      system: metroSystem(['TRTC', 'NTMC', 'TYMC', 'TMRT', 'KRTC', 'KLRT', 'TRTCMG']),
      station: station('The'),
    },
    run: async (args) => {
      const stations = await findStation(ctx, args.system, args.station);
      const rows = await ctx.tdx.metro.firstLastTimetable(args.system, {
        filter: anyOf('StationID', stations),
      });
      const items = rows.map((r) => ({
        station: name(r.StationName),
        line: r.LineID,
        toward: name(r.DestinationStationName) ?? r.TripHeadSign ?? undefined,
        trainType: r.TrainType ? TRAIN_TYPE[r.TrainType] : undefined,
        first: r.FirstTrainTime,
        last: r.LastTrainTime,
        days: days(r.ServiceDay),
      }));
      return list(items, ctx.maxItems, { system: args.system });
    },
  });
}

function idsOf(stations: RailStation[]): Set<string> {
  return new Set(stations.map((s) => s.id));
}

/**
 * `Field eq 'A' or Field eq 'B'`: a station listed once per line has several IDs. The SDK
 * parenthesises each filter when it joins several.
 */
function anyOf(field: string, stations: RailStation[]): string {
  return stations.map((s) => `${field} eq ${odata.str(s.id)}`).join(' or ');
}

function arrival(status: number | null | undefined, minutes: number | null | undefined): string {
  const special = status ? SERVICE_STATUS[status] : undefined;
  if (special) return special;
  if (minutes == null) return 'no estimate';
  return minutes === 0 ? 'arriving now' : `${minutes} min`;
}

/** `daily`, or the days the row applies to. */
function days(
  service: Partial<Record<(typeof DAYS)[number], boolean>> | null | undefined,
): string | undefined {
  if (!service) return undefined;
  const on = DAYS.filter((d) => service[d]);
  if (on.length === DAYS.length) return 'daily';
  return on.join(', ') || undefined;
}
