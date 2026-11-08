# Dependency majors — status

Checked 2026-11-08 on `experimental/rewrite`.

## TypeScript 7 — unblocked

TypeScript is now `^7.0.2`.

The blocker was `typescript-eslint`: even its canary declares
`typescript >=4.8.4 <6.1.0`. This project replaced ESLint/typescript-eslint
with:

- `oxlint@^1.92.0` for syntax and style checks
- `oxlint-tsgolint@^7.0.2006` for type-aware rules on the TypeScript 7
  `typescript-go` compiler
- `tsc` for the build/typecheck

`tsconfig.json` uses `"module": "node16"` and `"moduleResolution": "node16"`.

Verified:

- `npm run lint` — 0 warnings, 0 errors
- `npm run build` — passes
- `npm test` — 153/153

Trade-off: Oxlint does not currently implement every `typescript-eslint` rule.
The old `typedef` and `eslint-plugin-import-x` ordering rules are gone;
Prettier remains for formatting, and `tsc` strict mode covers type safety.

## Prisma 8 — still blocked

Prisma is `7.10.1` for `prisma`, `@prisma/client`, and
`@prisma/adapter-better-sqlite3`.

- `prisma` CLI has `8.0.0-rc.33` on npm.
- `@prisma/client@8.0.0-rc.33` does not exist; `latest` is `7.10.1`.
- `@prisma/adapter-better-sqlite3@8.0.0-rc.33` does not exist; `latest` is
  `7.10.1`, with only `8.1.0-dev.10` dev builds.

Retry when the client and adapter publish a matching 8.x release, then run
`prisma generate`, `prisma db push`, the full test suite, and a session-restore
smoke test.
