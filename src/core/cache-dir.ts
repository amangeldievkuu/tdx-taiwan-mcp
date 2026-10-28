import { homedir } from 'node:os';
import { join } from 'node:path';

const OFF = new Set(['off', 'none', 'false', '0']);

/**
 * Where static TDX responses are kept between runs: `TDX_CACHE_DIR`, else the platform's cache
 * folder (`%LOCALAPPDATA%` on Windows, `$XDG_CACHE_HOME` or `~/.cache` elsewhere). `undefined`
 * when `TDX_CACHE_DIR` turns it off.
 */
export function cacheDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string | undefined {
  const given = env.TDX_CACHE_DIR?.trim();
  if (given) return OFF.has(given.toLowerCase()) ? undefined : given;
  const base =
    platform === 'win32'
      ? (env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'))
      : (env.XDG_CACHE_HOME ?? join(home, '.cache'));
  return join(base, 'tdx-taiwan-mcp');
}
