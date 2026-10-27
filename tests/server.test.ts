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

  it('lists the tools, all read-only with a description', async () => {
    const t = await connect([]);
    close = t.close;
    const { tools } = await t.client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'afr_timetable',
      'bus_eta',
      'bus_positions',
      'bus_route_search',
      'bus_route_stops',
      'flight_board',
      'flight_schedule',
      'flight_status',
      'metro_fare',
      'metro_first_last_train',
      'metro_live_board',
      'rail_alerts',
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
