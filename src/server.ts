import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TdxClient } from 'tdx-taiwan';
import type { ToolContext } from './core/context.js';
import { TOOL_GROUPS, type ToolGroup } from './core/groups.js';
import { registerAfrTools } from './tools/afr.js';
import { registerAirTools } from './tools/air.js';
import { registerBikeTools } from './tools/bike.js';
import { registerBusServiceTools } from './tools/bus-service.js';
import { registerBusTools } from './tools/bus.js';
import { registerEvTools } from './tools/ev.js';
import { registerFerryPositionTools } from './tools/ferry-positions.js';
import { registerMetroTripTools } from './tools/metro-trip.js';
import { registerMetroTools } from './tools/metro.js';
import { registerParkingTools } from './tools/parking.js';
import { registerRailStationTools } from './tools/rail-station.js';
import { registerRailTools } from './tools/rail.js';
import { registerRawTools } from './tools/raw.js';
import { registerShipTools } from './tools/ship.js';
import { registerThsrTools } from './tools/thsr.js';
import { registerTraTools } from './tools/tra.js';
import { registerTrafficDeviceTools } from './tools/traffic-devices.js';
import { registerTrafficTools } from './tools/traffic.js';
import { registerTravelTimeTools } from './tools/travel-time.js';
import { VERSION } from './version.js';

export interface ServerOptions {
  /**
   * The client the tools call. Turn its cache on (`cache: true`): the tools re-read large
   * static lists, such as every YouBike station of a city, on each call.
   */
  tdx: TdxClient;
  /** Upper bound for any tool's `limit`. Default: 200. */
  maxItems?: number;
  /** The groups of tools to load. Default: all of them. */
  tools?: readonly ToolGroup[];
}

/** What each group covers, for the opening line of the instructions. */
const COVERS: Record<ToolGroup, string> = {
  bike: 'YouBike stations and live availability',
  bus:
    'city and intercity bus routes, stops, live arrival times, timetables, alerts and bus ' +
    'positions',
  rail:
    'high speed rail (THSR), Taiwan Railway (TRA), metro and Alishan railway timetables, ' +
    'journey times, station departures, exits, live boards, seats, fares and alerts',
  flight:
    'flights (live airport boards with weather, flight status, domestic and international ' +
    'schedules, domestic fares and seats)',
  ferry: 'ferries (timetables with live status, port live boards, vessel positions, fares, alerts)',
  road:
    'road traffic (live congestion, incidents, closures, road news, cameras and message signs ' +
    'on freeways, highways and city roads)',
  parking: 'car parks and on-street parking with free spaces',
  ev: 'EV chargers with live connector status',
  raw: 'any other TDX dataset through tdx_get',
};

/** How to call each group's tools. */
const HINTS: Partial<Record<ToolGroup, string>> = {
  bus:
    'Bus tools need the exact route name; find it with bus_route_search first, or ' +
    'bus_stops_nearby for the routes at stops near a point; bus_stop_arrivals shows every ' +
    'route due at one stop.',
  rail:
    'Rail tools take station names in Chinese or English (台北, Taipei) or station IDs; ' +
    'rail_station_departures lists everything leaving a station, metro_travel_time plans a ' +
    'metro journey with its changes.',
  flight:
    'Airports are IATA codes or names (TPE 桃園, TSA 松山, KNH 金門); flight numbers include the ' +
    'airline code (CI100).',
  ferry:
    'Ferry ports are names (富岡, 綠島, 小琉球); lines run by a county (Penghu inter-island ' +
    'boats, 旗津, 淡水) need city, e.g. PenghuCounty.',
  road:
    'Road tools take a network: freeway, highway or a city; traffic_travel_time takes freeway ' +
    'interchange names in Chinese (林口, 新竹).',
  raw: 'Use tdx_get only when no other tool covers the data.',
};

/** Groups whose tools take a city. */
const CITY_GROUPS: readonly ToolGroup[] = ['bike', 'bus', 'road', 'parking', 'ev', 'raw'];

/** The server instructions for the loaded groups. */
export function instructionsFor(groups: readonly ToolGroup[]): string {
  const parts = [
    `Taiwan transport data from TDX (交通部 Transport Data eXchange): ${groups.map((g) => COVERS[g]).join('; ')}.`,
    groups.some((g) => CITY_GROUPS.includes(g))
      ? 'Cities are TDX codes such as Taipei, NewTaipei, Taoyuan, Taichung, Tainan, Kaohsiung ' +
        '(Chinese names like 臺北市 work too).'
      : undefined,
    'Times are Taiwan time (UTC+8).',
    ...groups.map((g) => HINTS[g]),
    'Cite the data as 資料來源：交通部 TDX 運輸資料流通服務平臺.',
  ];
  return parts.filter(Boolean).join(' ');
}

const REGISTER: Record<ToolGroup, Array<(server: McpServer, ctx: ToolContext) => void>> = {
  bike: [registerBikeTools],
  bus: [registerBusTools, registerBusServiceTools],
  rail: [
    registerThsrTools,
    registerTraTools,
    registerMetroTools,
    registerMetroTripTools,
    registerAfrTools,
    registerRailTools,
    registerRailStationTools,
  ],
  flight: [registerAirTools],
  ferry: [registerShipTools, registerFerryPositionTools],
  road: [registerTrafficTools, registerTrafficDeviceTools, registerTravelTimeTools],
  parking: [registerParkingTools],
  ev: [registerEvTools],
  raw: [registerRawTools],
};

/** An MCP server exposing the TDX tools. Connect it to any transport. */
export function createServer({
  tdx,
  maxItems = 200,
  tools = TOOL_GROUPS,
}: ServerOptions): McpServer {
  const server = new McpServer(
    { name: 'tdx-taiwan-mcp', title: 'Taiwan TDX transport', version: VERSION },
    { instructions: instructionsFor(tools) },
  );
  const ctx: ToolContext = { tdx, maxItems };
  for (const group of tools) for (const register of REGISTER[group]) register(server, ctx);
  return server;
}
