// Runs from the npm `version` lifecycle: copies the new package.json version into src/version.ts
// and into server.json (the MCP registry entry and its npm package).
import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

const file = 'src/version.ts';
writeFileSync(
  file,
  readFileSync(file, 'utf8').replace(/VERSION = '[^']*'/, `VERSION = '${version}'`),
);

const server = JSON.parse(readFileSync('server.json', 'utf8'));
server.version = version;
for (const pkg of server.packages ?? []) pkg.version = version;
writeFileSync('server.json', `${JSON.stringify(server, null, 2)}\n`);
