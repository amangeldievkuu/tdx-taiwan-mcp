#!/usr/bin/env node
// Builds the Claude Desktop extension, build/tdx-taiwan-mcp-<version>.mcpb: the built server
// (run `npm run build` first) with its production dependencies, a manifest whose tool list comes
// from the server itself, and the icon. Validated and packed with the official mcpb CLI.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TdxClient } from 'tdx-taiwan';
import { createServer } from '../dist/index.js';

// Pinned on purpose; upgrade deliberately.
const MCPB = '@anthropic-ai/mcpb@2.1.2';
const REPO = 'https://github.com/amangeldievkuu/tdx-taiwan-mcp';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const stage = join('build', 'mcpb');
const output = join('build', `${pkg.name}-${pkg.version}.mcpb`);

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'server'), { recursive: true });
for (const file of ['cli.js', 'index.js']) cpSync(join('dist', file), join(stage, 'server', file));
for (const file of readdirSync('dist').filter((f) => /^chunk-.*\.js$/.test(f))) {
  cpSync(join('dist', file), join(stage, 'server', file));
}
for (const file of ['package.json', 'package-lock.json', 'LICENSE', 'README.md']) {
  cpSync(file, join(stage, file));
}
cpSync(join('assets', 'icon.png'), join(stage, 'icon.png'));
npm(['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], stage);

const manifest = {
  manifest_version: '0.3',
  name: pkg.name,
  display_name: 'Taiwan transport (TDX)',
  version: pkg.version,
  description:
    'Live Taiwan transport data from TDX: YouBike, buses, THSR, TRA, metro, flights, ferries, ' +
    'road traffic, parking and EV charging.',
  long_description: [
    'Answers questions about getting around Taiwan with live data from TDX (交通部 Transport ' +
      'Data eXchange): YouBike availability, bus arrivals and timetables, THSR, Taiwan Railway, ' +
      'metro and Alishan timetables, journey times and fares, live airport boards, ferries, road ' +
      'congestion, cameras and incidents, parking spaces and EV chargers.',
    'Needs a free TDX API key: sign up at https://tdx.transportdata.tw, then 會員中心 → 資料服務 ' +
      '→ API金鑰. Data: 資料來源：交通部 TDX 運輸資料流通服務平臺.',
  ].join('\n\n'),
  author: { name: 'Kutman', url: 'https://github.com/amangeldievkuu' },
  repository: { type: 'git', url: `${REPO}.git` },
  homepage: REPO,
  documentation: `${REPO}#readme`,
  support: `${REPO}/issues`,
  icon: 'icon.png',
  license: pkg.license,
  keywords: ['taiwan', 'transport', 'tdx', 'bus', 'metro', 'railway', 'youbike', 'flights'],
  privacy_policies: ['https://tdx.transportdata.tw/privacy'],
  server: {
    type: 'node',
    entry_point: 'server/cli.js',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/server/cli.js'],
      env: {
        TDX_CLIENT_ID: '${user_config.client_id}',
        TDX_CLIENT_SECRET: '${user_config.client_secret}',
        TDX_TOOLS: '${user_config.tools}',
        TDX_REQUESTS_PER_SECOND: '${user_config.requests_per_second}',
      },
    },
  },
  // Every optional field has a default, so the server never sees an unfilled placeholder.
  user_config: {
    client_id: {
      type: 'string',
      title: 'TDX Client Id',
      description: 'From tdx.transportdata.tw → 會員中心 → 資料服務 → API金鑰.',
      required: true,
    },
    client_secret: {
      type: 'string',
      title: 'TDX Client Secret',
      description: 'The secret of the same API key.',
      required: true,
      sensitive: true,
    },
    tools: {
      type: 'string',
      title: 'Tool groups',
      description:
        'all, or some of: bike, bus, rail, flight, ferry, road, parking, ev, raw (tdx_get). ' +
        'Fewer tools help the model pick the right one. Example: bus,rail.',
      default: 'all',
    },
    requests_per_second: {
      type: 'number',
      title: 'Requests per second',
      description: 'Client-side rate limit; match it to your TDX plan (0 turns it off).',
      default: 5,
      min: 0,
      max: 50,
    },
  },
  tools: await toolList(),
  compatibility: { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: '>=20' } },
};
writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

npx([MCPB, 'validate', join(stage, 'manifest.json')]);
rmSync(output, { force: true });
npx([MCPB, 'pack', stage, output]);
console.log(`Built ${output}`);

/** Every tool's name and the first sentence of its description. */
async function toolList() {
  const tdx = new TdxClient({ clientId: 'manifest', clientSecret: 'manifest' });
  const server = createServer({ tdx });
  const client = new Client({ name: 'build-mcpb', version: pkg.version });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((tool) => ({
    name: tool.name,
    description: firstSentence(tool.description ?? tool.title ?? tool.name),
  }));
}

function firstSentence(text) {
  const match = /^.+?[.!?](?=\s|$)/s.exec(text);
  return (match ? match[0] : text).replace(/\s+/g, ' ').trim();
}

function npm(args, cwd) {
  execFileSync('npm', args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
}

function npx(args) {
  execFileSync('npx', ['--yes', ...args], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}
