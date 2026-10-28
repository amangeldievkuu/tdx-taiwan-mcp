import { describe, expect, it } from 'vitest';
import { cacheDir } from '../../src/core/cache-dir.js';

describe('cacheDir', () => {
  it("uses the platform's cache folder by default", () => {
    expect(cacheDir({}, 'darwin', '/Users/a')).toBe('/Users/a/.cache/tdx-taiwan-mcp');
    expect(cacheDir({ XDG_CACHE_HOME: '/var/cache/a' }, 'linux', '/home/a')).toBe(
      '/var/cache/a/tdx-taiwan-mcp',
    );
    expect(cacheDir({ LOCALAPPDATA: 'C:/Users/a/AppData/Local' }, 'win32', 'C:/Users/a')).toMatch(
      /^C:[/\\]Users[/\\]a[/\\]AppData[/\\]Local[/\\]tdx-taiwan-mcp$/,
    );
  });

  it('takes TDX_CACHE_DIR, which can also turn it off', () => {
    expect(cacheDir({ TDX_CACHE_DIR: ' /tmp/tdx ' }, 'linux', '/home/a')).toBe('/tmp/tdx');
    expect(cacheDir({ TDX_CACHE_DIR: 'OFF' }, 'linux', '/home/a')).toBeUndefined();
    expect(cacheDir({ TDX_CACHE_DIR: '' }, 'linux', '/home/a')).toBe(
      '/home/a/.cache/tdx-taiwan-mcp',
    );
  });
});
