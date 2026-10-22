import { z } from 'zod';
import type { ToolContext } from '../core/context.js';
import type { AnyName } from '../core/format.js';
import { type LatLon, pointOf } from '../core/geo.js';
import { resolve } from '../core/names.js';

/** Metro systems: TDX `RailSystem` codes. */
export const METRO_SYSTEMS = {
  TRTC: '臺北捷運 Taipei Metro',
  NTMC: '新北捷運 (環狀線) New Taipei Metro',
  TYMC: '桃園機場捷運 Taoyuan Airport MRT',
  TMRT: '臺中捷運 Taichung MRT',
  KRTC: '高雄捷運 Kaohsiung MRT',
  KLRT: '高雄輕軌 Kaohsiung LRT',
  NTDLRT: '淡海輕軌 Danhai LRT',
  NTALRT: '安坑輕軌 Ankeng LRT',
  TRTCMG: '貓空纜車 Maokong Gondola',
} as const;

export type MetroSystemCode = keyof typeof METRO_SYSTEMS;
export type RailSystemCode = 'THSR' | 'TRA' | 'AFR' | MetroSystemCode;

const RAIL_SYSTEMS = ['THSR', 'TRA', 'AFR', ...Object.keys(METRO_SYSTEMS)] as [
  RailSystemCode,
  ...RailSystemCode[],
];

export const railSystem = z.enum(RAIL_SYSTEMS).describe(
  'Rail system: THSR (高鐵 high speed rail), TRA (臺鐵 Taiwan Railway), AFR (阿里山林業鐵路), or ' +
    `a metro: ${Object.entries(METRO_SYSTEMS)
      .map(([code, label]) => `${code} ${label}`)
      .join(', ')}.`,
);

export function metroSystem<const T extends readonly [MetroSystemCode, ...MetroSystemCode[]]>(
  systems: T,
) {
  return z
    .enum(systems)
    .describe(
      `Metro system: ${systems.map((code) => `${code} ${METRO_SYSTEMS[code]}`).join(', ')}.`,
    );
}

/** A station of any rail system, reduced to what lookups need. */
export interface RailStation {
  id: string;
  /** Booking-system code (THSR only), e.g. `TPE`; accepted in place of the ID. */
  code?: string;
  name: AnyName;
  position: LatLon | undefined;
  address?: string;
}

/** Every station of a system. The lists are cached by the client (static TTL). */
export async function stationsOf(ctx: ToolContext, system: RailSystemCode): Promise<RailStation[]> {
  if (system === 'THSR') {
    return (await ctx.tdx.thsr.stations()).map((s) => ({
      id: s.StationID,
      name: s.StationName,
      position: pointOf(s.StationPosition),
      address: s.StationAddress,
      code: s.StationCode,
    }));
  }
  if (system === 'TRA') {
    return (await ctx.tdx.tra.stations()).Stations.map((s) => ({
      id: s.StationID,
      name: s.StationName,
      position: pointOf(s.StationPosition),
      address: s.StationAddress ?? undefined,
    }));
  }
  if (system === 'AFR') {
    return (await ctx.tdx.afr.stations()).Stations.map((s) => ({
      id: s.StationID,
      name: s.StationName,
      position: pointOf(s.StationPosition),
      address: s.StationAddress ?? undefined,
    }));
  }
  return (await ctx.tdx.metro.stations(system)).map((s) => ({
    id: s.StationID,
    name: s.StationName,
    position: pointOf(s.StationPosition),
    address: s.StationAddress ?? undefined,
  }));
}

const LABEL: Record<string, string> = {
  THSR: 'THSR station',
  TRA: 'TRA station',
  AFR: 'AFR station',
};

/**
 * The stations `input` names, by station ID or by Chinese or English name. A metro station on
 * two lines (台北車站 BL12 and R10) comes back once per line.
 */
export async function findStation(
  ctx: ToolContext,
  system: RailSystemCode,
  input: string,
): Promise<[RailStation, ...RailStation[]]> {
  return resolve(await stationsOf(ctx, system), input, {
    names: (s) => [s.name.Zh_tw, s.name.En],
    ids: (s) => [s.id, s.code],
    label: LABEL[system] ?? `${system} station`,
  });
}
