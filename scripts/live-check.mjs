// Calls one tool of every kind against live TDX through the built server (`npm run build`
// first) and exits non-zero when any returns an error, so a change in TDX's data shows up
// before users meet it. Needs TDX_CLIENT_ID and TDX_CLIENT_SECRET (or a .env file).
//
//   npm run build && node scripts/live-check.mjs
import { existsSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TdxClient } from 'tdx-taiwan';
import { createServer } from '../dist/index.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const { TDX_CLIENT_ID, TDX_CLIENT_SECRET } = process.env;
if (!TDX_CLIENT_ID || !TDX_CLIENT_SECRET) {
  console.error('Set TDX_CLIENT_ID and TDX_CLIENT_SECRET.');
  process.exit(1);
}

const TAIPEI_MAIN = { lat: 25.0478, lon: 121.517 };
/** [tool, arguments]: places and routes chosen to have data at any time of day. */
const CALLS = [
  ['youbike_nearby', { ...TAIPEI_MAIN, city: 'Taipei', want: 'any' }],
  ['bus_stops_nearby', { ...TAIPEI_MAIN, city: 'Taipei' }],
  ['bus_stop_arrivals', { city: 'Taipei', stop: '臺北車站(鄭州)' }],
  ['bus_eta', { city: 'Taipei', routeName: '307' }],
  ['bus_timetable', { city: 'InterCity', routeName: '1610' }],
  ['bus_alerts', { city: 'Taipei' }],
  ['thsr_timetable', { from: '台北', to: '左營' }],
  ['tra_live_board', { station: '臺北' }],
  ['metro_first_last_train', { system: 'TRTC', station: '台北車站' }],
  ['rail_alerts', { system: 'TRA' }],
  ['afr_timetable', {}],
  ['flight_board', { airport: 'TSA' }],
  ['ferry_alerts', {}],
  ['traffic_live', { network: 'freeway', keyword: '林口' }],
  ['traffic_travel_time', { from: '林口', to: '新竹' }],
  ['traffic_events', { network: 'freeway' }],
  ['parking_nearby', { ...TAIPEI_MAIN, city: 'Taipei', want: 'any' }],
  ['ev_charger_nearby', { ...TAIPEI_MAIN, city: 'Taipei', want: 'any' }],
];

const tdx = new TdxClient({
  clientId: TDX_CLIENT_ID,
  clientSecret: TDX_CLIENT_SECRET,
  cache: true,
  requestsPerSecond: 1,
});
const client = new Client({ name: 'live-check', version: '1' });
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await Promise.all([createServer({ tdx }).connect(serverSide), client.connect(clientSide)]);

const failures = [];
for (const [tool, args] of CALLS) {
  const started = Date.now();
  const result = await client.callTool({ name: tool, arguments: args });
  const text = result.content[0]?.text ?? '';
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.isError) failures.push(tool);
  console.log(`${result.isError ? 'FAIL' : 'ok  '} ${tool} (${seconds} s): ${text.slice(0, 160)}`);
}
await client.close();

if (failures.length) {
  console.error(`\n${failures.length} of ${CALLS.length} tools failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log(`\nAll ${CALLS.length} tools answered.`);
