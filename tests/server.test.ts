import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { VERSION } from '../src/index.js';
import { connect } from './helpers.js';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
});

describe('server', () => {
  it('reports the package.json version', async () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
    const t = await connect([]);
    close = t.close;
    expect(t.client.getServerVersion()).toMatchObject({ name: 'tdx-taiwan-mcp', version: VERSION });
    expect(t.client.getInstructions()).toMatch(/bus_route_search/);
  });

  it('keeps server.json, the MCP registry entry, in step with package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      name: string;
      version: string;
      mcpName: string;
    };
    const entry = JSON.parse(readFileSync('server.json', 'utf8')) as {
      name: string;
      version: string;
      description: string;
      packages: Array<{ identifier: string; version: string }>;
    };
    expect(entry.name).toBe(pkg.mcpName);
    expect(entry.version).toBe(pkg.version);
    expect(entry.packages).toEqual([
      expect.objectContaining({ identifier: pkg.name, version: pkg.version }),
    ]);
    expect(entry.description.length).toBeLessThanOrEqual(100);
  });

  it('lists the tools, all read-only with a description', async () => {
    const t = await connect([]);
    close = t.close;
    const { tools } = await t.client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'afr_fare',
      'afr_timetable',
      'bus_alerts',
      'bus_eta',
      'bus_positions',
      'bus_route_search',
      'bus_route_stops',
      'bus_stop_arrivals',
      'bus_stops_nearby',
      'bus_timetable',
      'ev_charger_nearby',
      'ferry_alerts',
      'ferry_fare',
      'ferry_live_board',
      'ferry_timetable',
      'flight_board',
      'flight_schedule',
      'flight_status',
      'metro_fare',
      'metro_first_last_train',
      'metro_frequency',
      'metro_live_board',
      'parking_nearby',
      'parking_search',
      'rail_alerts',
      'rail_station_departures',
      'rail_station_info',
      'rail_station_search',
      'tdx_get',
      'thsr_fare',
      'thsr_seats',
      'thsr_timetable',
      'thsr_train',
      'tra_fare',
      'tra_live_board',
      'tra_timetable',
      'tra_train',
      'traffic_events',
      'traffic_live',
      'traffic_travel_time',
      'youbike_nearby',
      'youbike_station',
    ]);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
      expect(tool.description?.length).toBeGreaterThan(40);
      expect(tool.title).toBeTruthy();
    }
  });

  it('rejects invalid arguments as a tool error', async () => {
    const t = await connect([]);
    close = t.close;
    const result = await t.call('youbike_nearby', { lat: 'north', lon: 121.5, city: 'Taipei' });
    expect(result.isError).toBe(true);
    expect(t.apiUrls).toEqual([]);
  });
});
