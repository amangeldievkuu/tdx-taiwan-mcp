import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  TdxApiError,
  TdxAuthError,
  TdxError,
  TdxNetworkError,
  TdxRateLimitError,
} from 'tdx-taiwan';
import { ToolInputError } from './errors.js';

/**
 * Longest tool result, in characters. Claude Code warns above 25,000 tokens, and a Chinese
 * character is about one token.
 */
export const MAX_CHARS = 40_000;

const TRUNCATED_NOTE = `[output cut at ${MAX_CHARS} characters; narrow the request with filter, select, top or limit]`;

/** A successful result: `data` as JSON text, cut at `MAX_CHARS`. */
export function ok(data: unknown): CallToolResult {
  const text = JSON.stringify(data);
  if (text.length <= MAX_CHARS) return { content: [{ type: 'text', text }] };
  return { content: [{ type: 'text', text: `${text.slice(0, MAX_CHARS)}\n${TRUNCATED_NOTE}` }] };
}

/**
 * A list result `{ ...meta, total, returned, truncated, items }` with at most `limit` items,
 * fewer if the JSON would exceed `MAX_CHARS`. `truncated` tells the model more items exist.
 */
export function list(
  items: readonly unknown[],
  limit: number,
  meta: Record<string, unknown> = {},
): CallToolResult {
  const build = (n: number) => ({
    ...meta,
    total: items.length,
    returned: Math.min(n, items.length),
    truncated: n < items.length,
    items: items.slice(0, n),
  });
  let n = Math.min(limit, items.length);
  let text = JSON.stringify(build(n));
  while (text.length > MAX_CHARS && n > 1) {
    n = Math.max(1, Math.floor((n * MAX_CHARS) / text.length) - 1);
    text = JSON.stringify(build(n));
  }
  return ok(build(n));
}

/** A tool error result the model can read and act on. */
export function fail(error: unknown): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: describe(error) }] };
}

function describe(error: unknown): string {
  if (error instanceof ToolInputError) return error.message;
  if (error instanceof TdxRateLimitError) {
    const wait = error.retryAfterMs
      ? ` Retry after about ${Math.ceil(error.retryAfterMs / 1000)} s.`
      : '';
    return `TDX rate limit reached (HTTP 429) after several retries.${wait}`;
  }
  if (error instanceof TdxApiError) {
    const path = new URL(error.url).pathname.replace(/^\/api\/basic/, '');
    const message = tdxMessage(error.body);
    const hint =
      error.status === 404
        ? ' The path or a name in it may not exist; check the spelling, or search first.'
        : '';
    return `TDX answered HTTP ${error.status} for ${decodeURIComponent(path)}${message ? `: ${message}` : ''}.${hint}`;
  }
  if (error instanceof TdxAuthError) {
    return `TDX authentication failed${error.status ? ` (HTTP ${error.status})` : ''}: check TDX_CLIENT_ID and TDX_CLIENT_SECRET. ${error.message}`;
  }
  if (error instanceof TdxNetworkError) return `Could not reach TDX: ${error.message}`;
  if (error instanceof TdxError || error instanceof TypeError) return error.message;
  return `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
}

/** TDX error bodies are usually `{"Message": "..."}`; the message lists accepted cities on a 400. */
function tdxMessage(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { Message?: unknown; message?: unknown };
    const message = parsed.Message ?? parsed.message;
    if (typeof message === 'string') return message;
  } catch {
    // Not JSON; fall through to the raw text.
  }
  const text = body.trim();
  return text ? text.slice(0, 500) : undefined;
}
