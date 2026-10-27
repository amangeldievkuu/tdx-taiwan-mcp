import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ParkingAvailability, ParkingSegmentAvailability } from 'tdx-taiwan';
import { z } from 'zod';
import { CITIES, normalizeCity } from '../core/cities.js';
import type { ToolContext } from '../core/context.js';
import { arrayOf, name } from '../core/format.js';
import { type LatLon, nearest, pointOf } from '../core/geo.js';
import { search } from '../core/names.js';
import { list } from '../core/respond.js';
import { city, lat, limit, lon, radius, take } from '../core/schemas.js';
import { defineTool } from '../core/tool.js';

const FULLNESS: Record<number, string> = {
  0: 'spaces free',
  1: 'almost full',
  2: 'full',
  3: 'overcrowded',
};
const SERVICE: Record<number, string> = {
  0: 'closed',
  1: 'open',
  2: 'suspended',
  3: 'outside opening hours',
};
const CHARGING: Record<number, string> = {
  0: 'free of charge',
  1: 'charging',
  2: 'charging suspended',
  3: 'outside charging hours',
};
/** `SpaceType` of each vehicle in the availability breakdown. */
const SPACE_TYPE = { car: 1, scooter: 2 } as const;
type Vehicle = keyof typeof SPACE_TYPE;

const vehicle = z
  .enum(['car', 'scooter'])
  .optional()
  .describe('Spaces for a "car" (default) or a "scooter" (機車).');
const want = (defaultMode: 'space' | 'any') =>
  z
    .enum(['space', 'any'])
    .optional()
    .describe(
      '"space": leave out places known to be full or closed (places without live data stay ' +
        `in); "any": every place. Default "${defaultMode}".`,
    );
const parkingCity = city(Object.keys(CITIES));

/** A car park or an on-street segment, with its live availability when TDX has one. */
interface Place {
  kind: 'car park' | 'on-street';
  id: string;
  name: string | undefined;
  address: string | undefined;
  /** Road names, for search. */
  roads: Array<string | undefined>;
  position: LatLon | undefined;
  fare: string | undefined;
  ev: boolean;
  live: ParkingAvailability | ParkingSegmentAvailability | undefined;
}

export function registerParkingTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, 'parking_nearby', {
    title: 'Nearest parking',
    description:
      'Car parks and on-street parking nearest to a coordinate, with free spaces right now for ' +
      'cars or scooters, fare and opening status, nearest first. Coverage differs per city ' +
      '(NewTaipei has on-street parking only). Example: lat 25.0478, lon 121.517, city "Taipei".',
    input: {
      lat,
      lon,
      city: parkingCity,
      vehicle,
      want: want('space'),
      kind: z
        .enum(['all', 'offStreet', 'onStreet'])
        .optional()
        .describe(
          'Car parks ("offStreet"), curbside segments ("onStreet") or both ("all", default).',
        ),
      radiusMeters: radius(1000, 5000),
      limit: limit(5, 'places'),
    },
    run: async (args) => {
      const cityCode = normalizeCity(args.city);
      const kind = args.kind ?? 'all';
      const places = (await parkingPlaces(ctx, cityCode)).filter(
        (p) =>
          (kind === 'all' || (kind === 'offStreet') === (p.kind === 'car park')) &&
          wanted(p, args.vehicle ?? 'car', args.want ?? 'space'),
      );
      const found = nearest(places, (p) => p.position, args, {
        limit: places.length,
        maxMeters: args.radiusMeters ?? 1000,
      });
      const items = found.map(({ item, distance }) => ({
        distanceMeters: Math.round(distance),
        ...describe(item, args.vehicle ?? 'car'),
      }));
      return list(items, take(ctx, args.limit, 5), { city: cityCode });
    },
  });

  defineTool(server, 'parking_search', {
    title: 'Find parking by name or road',
    description:
      'Car parks and on-street parking whose name, address or road contains a keyword, with ' +
      'free spaces right now. Example: city "Taipei", keyword "市府"; or keyword "復興北路".',
    input: {
      city: parkingCity,
      keyword: z
        .string()
        .trim()
        .min(1)
        .describe('Part of the name, address or road, e.g. "府前廣場" or "忠孝東路".'),
      vehicle,
      want: want('any'),
      limit: limit(10, 'places'),
    },
    run: async (args) => {
      const cityCode = normalizeCity(args.city);
      const places = (await parkingPlaces(ctx, cityCode)).filter((p) =>
        wanted(p, args.vehicle ?? 'car', args.want ?? 'any'),
      );
      const found = search(places, (p) => [p.name, p.address, ...p.roads], args.keyword);
      return list(
        found.map((p) => describe(p, args.vehicle ?? 'car')),
        take(ctx, args.limit, 10),
        { city: cityCode },
      );
    },
  });
}

/**
 * Car parks and on-street segments joined with their live availability (four lists, cached by
 * the client). The lists join only partly: a place without a live record has unknown spaces,
 * and a live record without a car park (no position) is kept for search.
 */
async function parkingPlaces(ctx: ToolContext, cityCode: string): Promise<Place[]> {
  const parking = ctx.tdx.parking;
  const [carParks, availability, segments, segmentAvailability] = await Promise.all([
    parking.carParks(cityCode),
    parking.availability(cityCode),
    parking.segments(cityCode),
    parking.segmentAvailability(cityCode),
  ]);
  const liveCarParks = new Map(
    arrayOf(availability.ParkingAvailabilities).map((a) => [a.CarParkID, a]),
  );
  const liveSegments = new Map(
    arrayOf(segmentAvailability.CurbParkingSegmentAvailabilities).map((a) => [
      a.ParkingSegmentID,
      a,
    ]),
  );
  const places: Place[] = arrayOf(carParks.CarParks).map((c) => ({
    kind: 'car park',
    id: c.CarParkID,
    name: name(c.CarParkName),
    address: c.Address || undefined,
    roads: [],
    position: pointOf(c.CarParkPosition),
    fare: c.FareDescription,
    ev: c.EVRechargingAvailable === 1,
    live: liveCarParks.get(c.CarParkID),
  }));
  const known = new Set(places.map((p) => p.id));
  for (const live of liveCarParks.values()) {
    if (known.has(live.CarParkID)) continue;
    places.push({
      kind: 'car park',
      id: live.CarParkID,
      name: name(live.CarParkName),
      address: undefined,
      roads: [],
      position: undefined,
      fare: undefined,
      ev: false,
      live,
    });
  }
  for (const s of arrayOf(segments.ParkingSegments)) {
    places.push({
      kind: 'on-street',
      id: s.ParkingSegmentID,
      name: name(s.ParkingSegmentName),
      address: s.Description || undefined,
      roads: [s.RoadSection?.Start, s.RoadSection?.End],
      position: pointOf(s.ParkingSegmentPosition),
      fare: s.FareDescription,
      ev: s.HasChargingPoint === 1,
      live: liveSegments.get(s.ParkingSegmentID),
    });
  }
  return places;
}

/**
 * Free and total spaces for the vehicle: its row of the breakdown, else the overall counts
 * when there is no (usable) breakdown. `null` when the breakdown shows the place has no such
 * spaces.
 */
function spaces(
  live: Place['live'],
  vehicle: Vehicle,
): { free: number | undefined; total: number | undefined } | null {
  if (!live) return { free: undefined, total: undefined };
  const breakdown = arrayOf(live.Availabilities ?? undefined);
  const row = breakdown.find((a) => a.SpaceType === SPACE_TYPE[vehicle]);
  if (breakdown.length && !row) return null;
  // NewTaipei's on-street breakdown reports 0 free of every type while the overall count has
  // free spaces; use the overall counts then.
  const usable =
    row && !(live.AvailableSpaces > 0 && breakdown.every((a) => a.AvailableSpaces <= 0));
  const free = usable ? row.AvailableSpaces : live.AvailableSpaces;
  const total = usable ? row.NumberOfSpaces : live.TotalSpaces;
  // Negative counts mean "not provided".
  return { free: free >= 0 ? free : undefined, total: total >= 0 ? total : undefined };
}

function wanted(place: Place, vehicle: Vehicle, mode: 'space' | 'any'): boolean {
  const count = spaces(place.live, vehicle);
  if (count === null) return false;
  if (mode === 'any' || !place.live) return true;
  if (place.live.ServiceStatus !== 1) return false;
  return count.free === undefined ? place.live.FullStatus !== 2 : count.free > 0;
}

function describe(place: Place, vehicle: Vehicle) {
  const live = place.live;
  const count = spaces(live, vehicle);
  return {
    name: place.name,
    kind: place.kind,
    address: place.address,
    freeSpaces: count?.free,
    totalSpaces: count?.total,
    fullness: live && FULLNESS[live.FullStatus],
    status: live ? SERVICE[live.ServiceStatus] : 'no live data',
    charging: live && CHARGING[live.ChargeStatus],
    fare: shorten(place.fare),
    ev: place.ev || undefined,
    id: place.id,
    lat: place.position?.lat,
    lon: place.position?.lon,
    updated: live?.DataCollectTime,
  };
}

/** Fare texts can run to paragraphs; keep the first 150 characters. */
function shorten(text: string | undefined): string | undefined {
  const value = text?.replace(/\s+/g, ' ').trim();
  if (!value) return undefined;
  return value.length > 150 ? `${value.slice(0, 149)}…` : value;
}
