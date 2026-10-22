import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm'],
  target: 'node20',
  dts: { entry: { index: 'src/index.ts' } },
  sourcemap: true,
  clean: true,
  splitting: true,
  treeshake: true,
  // tsup keeps the `#!/usr/bin/env node` line of src/cli.ts and marks dist/cli.js executable.
});
