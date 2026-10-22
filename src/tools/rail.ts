import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolContext } from '../core/context.js';
import { name } from '../core/format.js';
import { nearest } from '../core/geo.js';
import { search } from '../core/names.js';
import { list } from '../core/respond.js';
import { limit, take } from '../core/schemas.js';
import { defineTool } from '../core/tool.js';
import { railSystem, stationsOf } from './rail-stations.js';

const ALERT_SYSTEMS = ['THSR', 'TRA', 'TRTC', 'KRTC', 'TYMC', 'KLRT', 'TMRT', 'TRTCMG'] as const;
const LEVEL: Record<number, string> = { 1: 'severe', 2: 'moderate', 3: 'minor' };
/** TRA and metro alert status. */
const STATUS: Record<number, string> = { 0: 'line stopped', 1: 'normal', 2: 'disrupted' };
/** THSR alert status. */
const THSR_STATUS: Record<string, string> = { '': 'normal', '▲': 'disrupted', X: 'line stopped' };

/** The alert fields the three feeds share. */
interface AnyAlert {
  Title: string;
  Description?: string | null;
  Level?: number | null;
  Effect?: string | null;
  Reason?: string | null;
  AlertURL?: string | null;
  StartTime?: string | null;
  EndTime?: string | null;
  PublishTime?: string | null;
}

export function registerRailTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, 'rail_station_search', {
    title: 'Find rail stations',
    description:
      'Stations of a rail system by name (Chinese or English) or nearest to a coordinate, with ' +
      'their IDs. The other rail tools accept names directly, so use this to explore, to find ' +
      'the nearest station, or when a name is ambiguous. Example: system "TRTC", lat 25.0478, ' +
      'lon 121.517; or system "TRA", keyword "新竹".',
    input: {
      system: railSystem,
      keyword: z.string().trim().min(1).optional().describe('Part of the station name.'),
      lat: z.number().min(21).max(27).optional().describe('Latitude, to sort by distance.'),
      lon: z.number().min(118).max(123).optional().describe('Longitude, to sort by distance.'),
      limit: limit(10, 'stations'),
    },
    run: async (args) => {
      let stations = await stationsOf(ctx, args.system);
      if (args.keyword) {
        stations = search(stations, (s) => [s.name.Zh_tw, s.name.En], args.keyword);
      }
      const describe = (s: (typeof stations)[number]) => ({
        id: s.id,
        name: name(s.name),
        address: s.address,
        lat: s.position?.lat,
        lon: s.position?.lon,
      });
      const { lat, lon } = args;
      const items =
        lat !== undefined && lon !== undefined
          ? nearest(stations, (s) => s.position, { lat, lon }, { limit: stations.length }).map(
              ({ item, distance }) => ({ distanceMeters: Math.round(distance), ...describe(item) }),
            )
          : stations.map(describe);
      return list(items, take(ctx, args.limit, 10), { system: args.system });
    },
  });

  defineTool(server, 'rail_alerts', {
    title: 'Rail service alerts',
    description:
      'Current service status and disruption alerts of THSR, TRA or a metro system ' +
      '("normal" when everything runs). Example: system "TRA".',
    input: {
      system: z
        .enum(ALERT_SYSTEMS)
        .describe(`One of ${ALERT_SYSTEMS.join(', ')} (see rail_station_search for the names).`),
    },
    run: async ({ system }) => {
      let alerts: Array<AnyAlert & { status: string | undefined }>;
      if (system === 'THSR') {
        alerts = (await ctx.tdx.thsr.alerts()).map((a) => ({
          ...a,
          status: THSR_STATUS[a.Status],
        }));
      } else {
        const wrapper =
          system === 'TRA' ? await ctx.tdx.tra.alerts() : await ctx.tdx.metro.alerts(system);
        alerts = wrapper.Alerts.map((a) => ({ ...a, status: STATUS[a.Status] }));
      }
      const items = alerts.map((a) => ({
        title: a.Title,
        status: a.status,
        description: plain(a.Description) !== a.Title ? plain(a.Description) : undefined,
        level: a.Level == null ? undefined : LEVEL[a.Level],
        effect: a.Effect || undefined,
        reason: a.Reason || undefined,
        start: realTime(a.StartTime),
        end: realTime(a.EndTime),
        published: realTime(a.PublishTime),
        url: a.AlertURL || undefined,
      }));
      return list(items, ctx.maxItems, { system });
    },
  });
}

/** Alert descriptions may hold HTML. */
function plain(text: string | null | undefined): string | undefined {
  const stripped = text
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || undefined;
}

/** Drops the `0001-01-01` placeholder TDX sends for "no time". */
function realTime(value: string | null | undefined): string | undefined {
  return value && !value.startsWith('0001-') ? value : undefined;
}
