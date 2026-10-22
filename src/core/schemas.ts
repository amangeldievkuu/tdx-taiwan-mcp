import { z } from 'zod';
import type { ToolContext } from './context.js';

/** A city argument; handlers pass it through `normalizeCity`. */
export function city(known: readonly string[]) {
  return z
    .string()
    .trim()
    .min(1)
    .describe(
      `City: a TDX code (${known.join(', ')}) or its Chinese name (臺北市, 新北市, 高雄市, ...).`,
    );
}

export const lat = z.number().min(21).max(27).describe('Latitude (WGS84), e.g. 25.0478.');
export const lon = z.number().min(118).max(123).describe('Longitude (WGS84), e.g. 121.517.');

export function limit(defaultValue: number, what: string) {
  return z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(`Maximum number of ${what} to return (default ${defaultValue}).`);
}

/** The effective limit: the caller's, or the default, capped at `ctx.maxItems`. */
export function take(ctx: ToolContext, value: number | undefined, defaultValue: number): number {
  return Math.min(value ?? defaultValue, ctx.maxItems);
}
