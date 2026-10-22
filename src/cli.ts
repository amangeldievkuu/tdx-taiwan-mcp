#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TdxClient } from 'tdx-taiwan';
import { createServer } from './server.js';
import { VERSION } from './version.js';

const HELP = `tdx-taiwan-mcp ${VERSION}: MCP server for Taiwan's TDX transport API (stdio).

Environment:
  TDX_CLIENT_ID, TDX_CLIENT_SECRET   TDX API key (required): https://tdx.transportdata.tw
                                     → 會員中心 → 資料服務 → API金鑰
  TDX_REQUESTS_PER_SECOND            Client-side rate limit (default 5)
  TDX_MAX_ITEMS                      Most items any tool returns (default 200)

A .env file in the working directory is read if present.`;

// stdout carries the MCP protocol, so everything else goes to stderr.
const log = (message: string) => {
  process.stderr.write(`[tdx-taiwan-mcp] ${message}\n`);
};

const arg = process.argv[2];
if (arg === '--help' || arg === '-h') {
  console.error(HELP);
  process.exit(0);
}
if (arg === '--version' || arg === '-v') {
  console.error(VERSION);
  process.exit(0);
}

// Existing environment variables win over the file.
if (existsSync('.env')) process.loadEnvFile('.env');

const { TDX_CLIENT_ID, TDX_CLIENT_SECRET } = process.env;
if (!TDX_CLIENT_ID || !TDX_CLIENT_SECRET) {
  log('Set TDX_CLIENT_ID and TDX_CLIENT_SECRET (run with --help for details).');
  process.exit(1);
}

const tdx = new TdxClient({
  clientId: TDX_CLIENT_ID,
  clientSecret: TDX_CLIENT_SECRET,
  cache: true,
  requestsPerSecond: numberEnv('TDX_REQUESTS_PER_SECOND'),
  onRetry: ({ url, attempt, status, delayMs }) => {
    log(`retry ${attempt} in ${delayMs} ms (${status ?? 'network error'}): ${url}`);
  },
});

const server = createServer({ tdx, maxItems: numberEnv('TDX_MAX_ITEMS') });
await server.connect(new StdioServerTransport());
log(`${VERSION} running on stdio`);

function numberEnv(key: string): number | undefined {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    log(`Ignoring ${key}=${raw}: not a non-negative number.`);
    return undefined;
  }
  return value;
}
