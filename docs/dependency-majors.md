# Dependency majors — retry notes

Checked 2026-11-08 on `experimental/rewrite`.

## TypeScript

**Current:** `~6.0.3`.

`tsconfig.json` now uses `"module": "node16"` and `"moduleResolution": "node16"`.
TypeScript 6 deprecates `node10`; the old `"node"` setting raises `TS5107`
under 6 and is removed in 7.

**TypeScript 7 remains blocked** by the lint stack:

- `typescript-eslint@8.72.1` (and its current canary) declares
  `typescript >=4.8.4 <6.1.0`.
- TS 7.0.2 is the current npm `latest`.
- Retry after typescript-eslint publishes support for TS 7, then re-run
  `npm run build`, `npx eslint .`, and `npm test`.

## Prisma

**Current:** `7.10.1` for `prisma`, `@prisma/client`, and
`@prisma/adapter-better-sqlite3`.

**Prisma 8 remains blocked** by mismatched publication:

- `prisma` CLI has `8.0.0-rc.33` on npm.
- `@prisma/client@8.0.0-rc.33` does not exist; `latest` is `7.10.1`.
- `@prisma/adapter-better-sqlite3@8.0.0-rc.33` does not exist; `latest` is
  `7.10.1`, with only `8.1.0-dev.10` dev builds.

Do not mix the 8.x CLI with a 7.x client. Retry when the client and adapter
publish a matching 8.x release, then run `prisma generate`, `prisma db push`,
the full test suite, and a session-restore smoke test.
