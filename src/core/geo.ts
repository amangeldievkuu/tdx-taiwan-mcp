/** A WGS84 coordinate. */
export interface LatLon {
  lat: number;
  lon: number;
}

/** Great-circle distance in metres. */
export function haversine(a: LatLon, b: LatLon): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Reads a position from TDX's `PointType`; `undefined` when either coordinate is missing. */
export function pointOf(
  point: { PositionLat?: number | null; PositionLon?: number | null } | null | undefined,
): LatLon | undefined {
  if (point?.PositionLat == null || point.PositionLon == null) return undefined;
  return { lat: point.PositionLat, lon: point.PositionLon };
}

/**
 * Items sorted by distance from `origin`, nearest first. Items without a position, or farther
 * than `maxMeters`, are left out.
 */
export function nearest<T>(
  items: readonly T[],
  position: (item: T) => LatLon | undefined,
  origin: LatLon,
  { limit, maxMeters = Infinity }: { limit: number; maxMeters?: number },
): Array<{ item: T; distance: number }> {
  return items
    .flatMap((item) => {
      const pos = position(item);
      if (!pos) return [];
      const distance = haversine(origin, pos);
      return distance <= maxMeters ? [{ item, distance }] : [];
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

/** Reads a WKT `POINT(lon lat)`, as the road event feeds give it. */
export function pointFromWkt(wkt: string | null | undefined): LatLon | undefined {
  const match = /^\s*POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)\s*$/i.exec(wkt ?? '');
  if (!match) return undefined;
  return { lat: Number(match[2]), lon: Number(match[1]) };
}
