import type { TdxClient } from 'tdx-taiwan';

/** Shared by every tool handler. */
export interface ToolContext {
  tdx: TdxClient;
  /** Upper bound for any tool's `limit`. */
  maxItems: number;
}
