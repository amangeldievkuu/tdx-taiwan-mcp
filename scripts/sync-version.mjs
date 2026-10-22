// Runs from the npm `version` lifecycle: copies the new package.json version into src/version.ts.
import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const file = 'src/version.ts';
writeFileSync(
  file,
  readFileSync(file, 'utf8').replace(/VERSION = '[^']*'/, `VERSION = '${version}'`),
);
