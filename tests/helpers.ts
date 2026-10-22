import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TdxClient } from 'tdx-taiwan';
import { vi } from 'vitest';
import { createServer, type ServerOptions } from '../src/index.js';

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Parsed JSON fixture. */
export function loadFixture(name: string): unknown {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Answers the first route whose pattern matches the decoded request URL: with `body` as JSON,
 * or with the Response a function returns.
 */
export type Route = [pattern: string | RegExp, body: unknown];

/** The JSON of a `list()` result. */
export interface ListJson {
  total: number;
  returned: number;
  truncated: boolean;
  note?: string;
  items: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface CallResult {
  isError: boolean;
  text: string;
  /** `text` parsed as JSON (typed as a list result, the common case), or `undefined`. */
  json: ListJson;
}

/**
 * An MCP client connected in memory to a server whose TdxClient serves `routes`. Unmatched
 * URLs get a 404. `apiUrls` lists the decoded API URLs requested, in order.
 */
export async function connect(routes: Route[], options: Partial<ServerOptions> = {}) {
  const apiUrls: string[] = [];
  const fetch = vi.fn((url: string) => {
    if (url.includes('/openid-connect/token')) {
      return Promise.resolve(jsonResponse({ access_token: 'abc', expires_in: 86_400 }));
    }
    const decoded = decodeURIComponent(url);
    apiUrls.push(decoded);
    const route = routes.find(([pattern]) =>
      typeof pattern === 'string' ? decoded.includes(pattern) : pattern.test(decoded),
    );
    if (!route) return Promise.resolve(jsonResponse({ Message: 'No test route' }, 404));
    const body = route[1];
    return Promise.resolve(
      typeof body === 'function' ? (body as () => Response)() : jsonResponse(body),
    );
  });
  const tdx = new TdxClient({
    clientId: 'id',
    clientSecret: 'secret',
    fetch,
    requestsPerSecond: 0,
    maxRetries: 0,
    cache: true,
  });
  const server = createServer({ tdx, ...options });
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  async function call(name: string, args: Record<string, unknown> = {}): Promise<CallResult> {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as Array<{ type: string; text?: string }>;
    const text = content[0]?.text ?? '';
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { isError: result.isError === true, text, json: json as ListJson };
  }

  return { client, call, apiUrls, fetch, close: () => client.close() };
}

export const API = 'https://tdx.transportdata.tw/api/basic';
