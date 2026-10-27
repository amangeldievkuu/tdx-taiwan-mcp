# Contributing

## Setup

Development needs Node.js 22 or later (the published package supports 20+).

```sh
npm ci
cp .env.example .env   # only needed to run the server against TDX
```

## Scripts

| Script                  | What it does                                                          |
| ----------------------- | --------------------------------------------------------------------- |
| `npm test`              | Unit and in-memory MCP tests against the fixtures. Never calls TDX.   |
| `npm run lint`          | `eslint .` and `prettier --check .`                                   |
| `npm run format`        | `prettier --write .`                                                  |
| `npm run typecheck`     | `tsc --noEmit`                                                        |
| `npm run build`         | `tsup` → ESM and declarations in `dist/`; `dist/cli.js` is the `bin`. |
| `npm run inspect`       | Builds, then opens the server in the MCP Inspector (reads `.env`).    |
| `npm run check:exports` | `publint` and `are-the-types-wrong` on the packed tarball.            |

## Adding a tool

1. Put it in `src/tools/<domain>.ts` and register it from `createServer()` in `src/server.ts`.
   Use `defineTool()` (`src/core/tool.ts`): it marks the tool read-only and turns thrown errors
   into tool errors. Throw `ToolInputError` for problems the model can fix (no match, ambiguous
   name), with a hint at the tool that helps.
2. Name tools `<domain>_<what>` in snake_case. The description says when to use the tool and
   ends with an example input. Reuse the shared schemas in `src/core/schemas.ts`.
3. Return lists with `list()` and other data with `ok()` (`src/core/respond.ts`), so output stays
   under the size cap. Shape items for reading: names through `name()`, codes turned into words,
   absent fields left out.
4. Call the `tdx-taiwan` resource methods rather than raw paths, so the client cache applies.
   Fetch whole lists without per-call filters where the tool searches them locally, so repeated
   calls hit the cache.
5. Test it in `tests/tools/<domain>.test.ts` through `connect()` (`tests/helpers.ts`): assert
   the request URLs, the shaped output, and the error cases. Fixtures in `tests/fixtures/` come
   from the `tdx-taiwan` repository's fixtures where one exists.
6. Add a row to the README tool table and a line under `## [Unreleased]` in `CHANGELOG.md`.

## Releasing

1. Move the `## [Unreleased]` items under `## [x.y.z] - YYYY-MM-DD` and update the links at the
   bottom of `CHANGELOG.md`.
2. `npm version minor` (or `patch` / `major`) bumps `package.json`, `src/version.ts` and
   `server.json`, commits and tags `vX.Y.Z`.
3. `git push --follow-tags`. The release workflow checks the tag, runs the checks, publishes
   to npm with provenance, creates the GitHub release from the changelog and lists the version
   in the MCP registry. Each step is skipped when that version is already out, so a failed run
   can be re-run.
