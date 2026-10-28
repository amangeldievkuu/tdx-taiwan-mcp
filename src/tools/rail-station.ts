import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { odata } from 'tdx-taiwan';
import { z } from 'zod';
import type { ToolContext } from '../core/context.js';
import { arrayOf, type AnyName, name } from '../core/format.js';
import { haversine, type LatLon, pointOf } from '../core/geo.js';
import { normalize } from '../core/names.js';
import { list } from '../core/respond.js';
import { after, date, limit, take } from '../core/schemas.js';
import { clock, hhmm, startTime, taipeiNow } from '../core/time.js';
import { defineTool } from '../core/tool.js';
import { anyOf, TRAIN_TYPE as METRO_TRAIN_TYPE } from './metro.js';
import { findStation, METRO_SYSTEMS, type RailStation } from './rail-stations.js';
import { trainType } from './tra.js';

/** Systems with station timetables: TRA, THSR and the metros that publish them. */
const DEPARTURE_SYSTEMS = ['TRA', 'THSR', 'TRTC', 'NTMC', 'TYMC', 'TMRT', 'KRTC', 'KLRT'] as const;
/** Systems with station exits. */
const INFO_SYSTEMS = ['TRA', 'THSR', 'TRTC', 'NTMC', 'TYMC', 'TMRT', 'KRTC', 'KLRT'] as const;
type DepartureSystem = (typeof DEPARTURE_SYSTEMS)[number];

const TRA_DIRECTION: Record<number, string> = { 0: '順行 clockwise', 1: '逆行 counter-clockwise' };
const THSR_DIRECTION: Record<number, string> = { 0: 'southbound', 1: 'northbound' };
const ESCALATOR: Record<number, string> = {
  0: 'none',
  1: 'both ways',
  2: 'exit only',
  3: 'entry only',
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

const systemOf = <const T extends readonly string[]>(systems: T) =>
  z.enum(systems).describe(
    `Rail system: TRA (臺鐵), THSR (高鐵) or a metro: ${systems
      .filter((s): s is keyof typeof METRO_SYSTEMS => s in METRO_SYSTEMS)
      .map((s) => `${s} ${METRO_SYSTEMS[s]}`)
      .join(', ')}.`,
  );
const stationInput = z
  .string()
  .trim()
  .min(1)
  .describe('Station name in Chinese or English (台北, 板橋, Ximen) or station ID.');

interface Departure {
  departs: string;
  trainNo?: string;
  type?: string;
  line?: string;
  toward: string | undefined;
  direction?: string;
  cancelled?: true;
}

export function registerRailStationTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, 'rail_station_departures', {
    title: 'Station departures',
    description:
      "A station's departures on a day toward every destination, from its timetable: TRA, " +
      'THSR or a metro (including Taipei Metro, whose live board shows arrivals only). ' +
      'Use tra_timetable or thsr_timetable for trains between two stations. Example: system ' +
      '"TRA", station "板橋"; or system "TRTC", station "台北車站", toward "淡水".',
    input: {
      system: systemOf(DEPARTURE_SYSTEMS),
      station: stationInput,
      toward: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe('Only trains whose terminus contains this, e.g. "淡水" or "Kaohsiung".'),
      date,
      after,
      limit: limit(20, 'departures'),
    },
    run: async (args) => {
      const stations = await findStation(ctx, args.system, args.station);
      const day = args.date ?? taipeiNow().date;
      const start = startTime(day, args.after);
      const all = await departuresOf(ctx, args.system, stations, day);
      // Metro service days run past midnight (`00:45`, `24:32`): those trains come last. TRA
      // and THSR days do not.
      const wraps = args.system !== 'TRA' && args.system !== 'THSR';
      const key = (time: string) => clock(time) + (wraps && clock(time) < 4 * 60 ? 24 * 60 : 0);
      const wanted = args.toward ? normalize(args.toward) : undefined;
      const items = all
        .filter((d) => key(d.departs) >= clock(start))
        .filter((d) => !wanted || normalize(d.toward ?? '').includes(wanted))
        .sort((a, b) => key(a.departs) - key(b.departs));
      const wenhu =
        args.system === 'TRTC' && stations.some((s) => s.id.startsWith('BR'))
          ? 'The Wenhu line (文湖線) runs by frequency and has no timetable; see metro_frequency.'
          : undefined;
      return list(items, take(ctx, args.limit, 20), {
        system: args.system,
        station: name(stations[0].name),
        date: day,
        after: start,
        note: items.length
          ? wenhu
          : (wenhu ??
            `No departures from this station on ${day} after ${start}` +
              (args.toward ? ` toward "${args.toward}".` : '.')),
      });
    },
  });

  defineTool(server, 'rail_station_info', {
    title: 'Station exits and facilities',
    description:
      'Exits of a TRA, THSR or metro station with where they come out and whether they have ' +
      'stairs, an escalator or a lift, plus where its lifts, toilets and information desks ' +
      'are. Give the coordinates of where you are going to sort the exits by distance. ' +
      'Example: system "TRTC", station "台北101/世貿", lat 25.0336, lon 121.5648.',
    input: {
      system: systemOf(INFO_SYSTEMS),
      station: stationInput,
      lat: z.number().min(21).max(27).optional().describe('Latitude of your destination.'),
      lon: z.number().min(118).max(123).optional().describe('Longitude of your destination.'),
      limit: limit(50, 'exits'),
    },
    run: async (args) => {
      const stations = await findStation(ctx, args.system, args.station);
      const ids = new Set(stations.map((s) => s.id));
      const { exits, facilities, maps } = await infoOf(ctx, args.system, ids);
      const target: LatLon | undefined =
        args.lat !== undefined && args.lon !== undefined
          ? { lat: args.lat, lon: args.lon }
          : undefined;
      const items = exits
        .map((e) => ({
          ...e,
          distanceMeters:
            target && e.position ? Math.round(haversine(target, e.position)) : undefined,
          lat: e.position?.lat,
          lon: e.position?.lon,
          position: undefined,
        }))
        .sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
      return list(items, take(ctx, args.limit, 50), {
        system: args.system,
        station: name(stations[0].name),
        facilities,
        maps: maps.length ? [...new Set(maps)].slice(0, 3) : undefined,
        note: items.length ? undefined : 'TDX lists no exits for this station.',
      });
    },
  });
}

async function departuresOf(
  ctx: ToolContext,
  system: DepartureSystem,
  stations: [RailStation, ...RailStation[]],
  day: string,
): Promise<Departure[]> {
  const id = stations[0].id;
  if (system === 'THSR') {
    return (await ctx.tdx.thsr.stationTimetable(id, day))
      .filter((t) => t.EndingStationID !== id && t.DepartureTime)
      .map((t) => ({
        departs: t.DepartureTime,
        trainNo: t.TrainNo,
        toward: name(t.EndingStationName),
        direction: THSR_DIRECTION[t.Direction],
      }));
  }
  if (system === 'TRA') {
    const timetable =
      day === taipeiNow().date
        ? await ctx.tdx.tra.stationTimetable(id)
        : await ctx.tdx.tra.dailyStationTimetable(day, { filter: `StationID eq ${odata.str(id)}` });
    return arrayOf(timetable.StationTimetables).flatMap((s) =>
      arrayOf(s.TimeTables).flatMap((t) => {
        const departs = hhmm(t.DepartureTime);
        // Trains ending here only arrive.
        if (!departs || t.DestinationStationID === id) return [];
        return [
          {
            departs,
            trainNo: t.TrainNo ?? undefined,
            type: trainType({
              TrainTypeCode: t.TrainTypeCode,
              TrainTypeName: t.TrainTypeName ?? {},
            }),
            toward: name(t.DestinationStationName),
            direction: s.Direction == null ? undefined : TRA_DIRECTION[s.Direction],
            cancelled: t.SuspendedFlag === 1 ? (true as const) : undefined,
          },
        ];
      }),
    );
  }
  const weekday = WEEKDAYS[new Date(`${day}T12:00:00+08:00`).getUTCDay()] ?? 'Monday';
  const timetables = await ctx.tdx.metro.stationTimetable(system, {
    filter: anyOf('StationID', stations),
  });
  // A destination can have several timetables for the same days (full and short-turn routes);
  // their departures add up, but one train listed twice is kept once.
  const seen = new Set<string>();
  return timetables
    .filter((t) => t.ServiceDay[weekday])
    .flatMap((t) =>
      t.Timetables.map((entry) => ({
        departs: entry.DepartureTime,
        line: t.LineID,
        toward: name(t.DestinationStationName),
        type: entry.TrainType ? METRO_TRAIN_TYPE[entry.TrainType] : undefined,
      })),
    )
    .filter((d) => {
      const key = `${d.departs}|${d.line}|${d.toward ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

interface Exit {
  exit: string | undefined;
  where: string | undefined;
  stairs: boolean | undefined;
  escalator: string | undefined;
  elevator: boolean | undefined;
  position: LatLon | undefined;
}

interface FacilityLists {
  Elevators?: Spot[] | null;
  Toilets?: Spot[] | null;
  InformationSpots?: Spot[] | null;
  DrinkingFountains?: Spot[] | null;
  FacilityMapURLs?: Array<{ MapURL?: string | null }> | null;
}
interface Spot {
  Description: string;
  FloorLevel?: string | null;
}

async function infoOf(
  ctx: ToolContext,
  system: (typeof INFO_SYSTEMS)[number],
  ids: Set<string>,
): Promise<{ exits: Exit[]; facilities: Record<string, string[]> | undefined; maps: string[] }> {
  if (system === 'THSR') {
    const exits = (await ctx.tdx.thsr.stationExits()).filter((e) => ids.has(e.StationID));
    return {
      exits: exits.map((e) => ({
        exit: name(e.ExitName),
        where: e.LocationDescription || undefined,
        stairs: e.Stair,
        escalator: e.Escalator ? 'yes' : 'none',
        elevator: e.Elevator,
        position: pointOf(e.ExitPosition),
      })),
      facilities: undefined,
      maps: exits.flatMap((e) => mapUrls(e.ExitMapURLs)),
    };
  }
  if (system === 'TRA') {
    const [exits, facilities] = await Promise.all([
      ctx.tdx.tra.stationExits(),
      ctx.tdx.tra.stationFacilities().catch(() => undefined),
    ]);
    const stationExits = arrayOf(exits.StationExits).filter((s) => ids.has(s.StationID));
    const stationFacilities = arrayOf(facilities?.StationFacilities).filter((s) =>
      ids.has(s.StationID),
    );
    return {
      exits: stationExits.flatMap((s) =>
        s.Exits.map((e) => ({
          exit: name(e.ExitName),
          where: e.LocationDescription || e.RoadName || undefined,
          stairs: e.Stair ?? undefined,
          escalator: ESCALATOR[e.Escalator],
          elevator: e.Elevator ?? undefined,
          position: pointOf(e.ExitPosition),
        })),
      ),
      facilities: facilityLists(stationFacilities),
      maps: [
        ...stationFacilities.flatMap((s) => mapUrls(s.FacilityMapURLs)),
        ...stationExits.flatMap((s) => mapUrls(s.ExitMapURLs)),
      ],
    };
  }
  const [exits, facilities] = await Promise.all([
    ctx.tdx.metro.stationExits(system),
    ctx.tdx.metro.stationFacilities(system).catch(() => []),
  ]);
  const stationExits = exits.filter((e) => ids.has(e.StationID));
  const stationFacilities = facilities.filter((f) => ids.has(f.StationID));
  return {
    exits: stationExits.map((e) => ({
      exit: name(e.ExitName),
      where: e.LocationDescription || undefined,
      stairs: e.Stair,
      escalator: ESCALATOR[e.Escalator],
      elevator: e.Elevator,
      position: pointOf(e.ExitPosition),
    })),
    facilities: facilityLists(stationFacilities),
    maps: [
      ...stationFacilities.flatMap((s) => mapUrls(s.FacilityMapURLs)),
      ...stationExits.flatMap((s) => mapUrls(s.ExitMapURLs)),
    ],
  };
}

/** `{ elevators: ['B1 大廳層往月台 (B1)'], toilets: [...] }`, without empty kinds. */
function facilityLists(stations: readonly FacilityLists[]): Record<string, string[]> | undefined {
  const spots = (pick: (s: FacilityLists) => Spot[] | null | undefined) => [
    ...new Set(
      stations.flatMap((s) =>
        arrayOf(pick(s) ?? undefined).flatMap((spot) => {
          const text = spot.Description.trim();
          if (!text) return [];
          return spot.FloorLevel && !text.includes(spot.FloorLevel)
            ? [`${text} (${spot.FloorLevel})`]
            : [text];
        }),
      ),
    ),
  ];
  const lists = {
    elevators: spots((s) => s.Elevators),
    toilets: spots((s) => s.Toilets),
    informationDesks: spots((s) => s.InformationSpots),
    drinkingFountains: spots((s) => s.DrinkingFountains),
  };
  const kept = Object.entries(lists).filter(([, v]) => v.length);
  return kept.length ? Object.fromEntries(kept) : undefined;
}

function mapUrls(
  maps: Array<{ MapURL?: string | null; MapName?: AnyName | null }> | null | undefined,
) {
  return arrayOf(maps ?? undefined).flatMap((m) => (m.MapURL ? [m.MapURL] : []));
}
