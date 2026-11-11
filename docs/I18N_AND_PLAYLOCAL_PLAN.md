# i18n and /playlocal implementation plan

**Status:** proposed<br>
**Baseline:** `main` / `dev` at `13c3a335`<br>
**Related review:** `docs/UPSTREAM_4.2-4.7_REVIEW.md`

## Decisions to confirm

1. **Translation scope:** bot commands, events, buttons and errors first;
   dashboard UI second. Recommend not translating slash command **names** in
   the first release; keep canonical names/aliases stable and localize
   descriptions and responses. This avoids breaking invocations and aliases.
2. **Initial languages:** ship `en-US` plus `en-GB` as the complete catalog, then
   import reviewed upstream translations in batches. Do not import all 32
   upstream locales before our command keys are stable.
3. **`/playlocal` input:** attachment-only, matching upstream. Do not expose
   arbitrary host paths; a host-path command is a different security and
   deployment feature.

## Part A — i18n

### Target design

- Add `i18next` and a loader under `src/i18n/` or `src/lib/I18n.ts`.
- Load locale JSON once at startup; never read files per command.
- Namespaces: `common`, `commands`, `events`, `buttons`, `errors`, `dashboard`.
- `en-US` is the fallback and the source of truth for key coverage.
- Add a per-guild `language` setting in the existing `GuildSetting` table
  (`language`, default `en-US`) and `DEFAULT_LANGUAGE` as the process fallback.
  No Prisma schema migration is required.
- Add `/language set <code>` and `/language reset` (Manage Server, autocomplete,
  at most 25 choices). Mirror the setting in the dashboard's General group.
- `Context` gets a `locale`/`t()` surface: guild setting first, then interaction
  locale, then `en-US`. Prefix commands use the guild setting; slash commands
  use the same guild setting for deterministic behavior.
- Command registration keeps canonical `name`/aliases; populate
  `description_localizations` from locale files. Add `name_localizations` only
  after a separate command-name compatibility decision.
- Dashboard: send the resolved locale with page state; localize labels,
  descriptions, error notices and buttons. Keep the browser code inside the
  existing template-string constraints.

### Phases

| Phase | Scope | Size | Exit criterion |
|---|---|---|---|
| 0 | String inventory and key schema; map our 109 commands to namespaces; identify reused/generic errors | S | Key map and migration order approved |
| 1 | i18next loader, fallback, `language` setting, `/language`, dashboard selector, key-coverage test | M | Switching language persists across restart and changes bot + dashboard text |
| 2 | Migrate core playback/queue/management commands and shared errors | L | Core command flows have no unlocalized user-facing strings in migrated paths |
| 3 | Migrate events, setup/song-request, buttons, filters, owner/tools text | L | `en-US` catalog covers every migrated key; fallback works |
| 4 | Dashboard localization and reviewed translation import | M/L | Supported locales pass key/placeholder validation and browser smoke |
| 5 | CI locale validator, missing-key logging, docs for translators | S | CI rejects malformed JSON, missing keys, and placeholder mismatches |

### Acceptance criteria

- A guild can switch languages without a restart; `en-US` is always available.
- Missing keys fall back to English and are reported once, not per message.
- Interpolation placeholders and Discord limits (command description 100 chars;
  localized names only if enabled) are validated.
- Every supported locale has the same required key set; unused keys are reported.
- No `any`/`@ts-ignore` additions; the existing strict TypeScript gate stays clean.
- Tests cover persistence, fallback, interpolation, command metadata and a
  dashboard locale switch.
- The command count stays under Discord's 100-slash-command cap; `/language` is
  one new top-level command.

### Risks

- Our 109-command surface is larger than upstream's 65; translations need
  semantic review, not file copying.
- The dashboard is a large inline template; localization must not introduce
  nested template literals or break the no-build UI.
- Command names are API surface. Localizing them can break aliases and user
  muscle memory; keep them canonical initially.
- Translation drift is permanent work; the key validator and fallback logging
  are not optional.

## Part B — `/playlocal`

### Target behavior

`/playlocal file:<attachment>` accepts a Discord audio/video attachment, creates
or reuses a player, resolves the file through Lavalink, applies normal queue
limits, enqueues it, and starts playback. Prefix support accepts the first
attachment on a message.

Upstream uses `source: "local"` with the attachment URL. Our Shoukaku
`Queue.search()` currently accepts only engine-prefixed queries, so this must be
proven before implementation.

### Phase 0 — Lavalink spike (blocking, S)

- Test the existing production/BotTest node with `source: "local"` and a Discord
  attachment URL through Shoukaku, not only `loadTracks` metadata.
- **Result:** this node has no `local` source manager. Its supported `http`
  source resolves the attachment-style URL, so the implementation uses the
  supported HTTP source instead of `local`.
- No short-lived downloaded-file path is needed for the implemented node.
- **Gate:** audio must actually play on the test node. **PASS** — the test bot
  played a loopback WAV and logged `start` → `finished`.

### Phase 1 — command and guards (S/M)

- Add `src/commands/music/PlayLocal.ts` with a slash attachment option and
  prefix attachment fallback.
- Declare `defer`, voice/DJ/permission behavior, and Connect/Speak requirements.
- Validate missing attachment, MIME (`audio/*`/`video/*`), size, guild, channel,
  and attachment URL; reject everything else before touching Lavalink.
- Add the command to the command-list test; slash count becomes 73 (still below
  the 100 cap).

### Phase 2 — playback path (M)

- Add a resolver path parallel to `Queue.search()` that preserves literal URL
  handling and does not silently fall through to a search engine.
- Reuse/create the player in the caller's voice channel; do not use the
  dashboard-only auto-join path.
- Apply `getPlayLimits`/`checkTrack`, enqueue, and start playback when idle.
- For any download fallback: sanitize filenames, cap size/duration, keep files
  outside the repo, delete after Lavalink finishes or on failure, and never
  accept a caller-supplied path.
- Return clear localized errors for unsupported format, too large, Lavalink
  failure, and queue-limit rejection.

### Phase 3 — verification (S/M)

- Unit tests: no attachment, invalid MIME, oversized file, missing voice, local
  source unavailable, queue limit, successful enqueue.
- Live test: real test bot + attachment on an empty voice channel; verify audio
  and a second request queues correctly.
- Docs/skill: command usage, supported formats, limits, and the chosen Lavalink
  source behavior.

### Acceptance criteria

- `/playlocal` joins only the caller's voice channel and never accepts a host
  filesystem path.
- Audio plays through Lavalink; a metadata-only result is a failure.
- Temporary files (if used) have bounded size and are cleaned up.
- Queue limits, permissions and fallback errors behave like `/play`.
- Full tests, lint, build and CI pass.

## Recommended sequence

1. `/playlocal` spike and implementation (independent, user-visible).
2. i18n Phase 0–1: foundation, `en-US`, language setting, `/language`, dashboard
   selector.
3. i18n Phases 2–4 by command domain.
4. Targeted upstream fix audit for playlist/queue/setup/now-playing/lyrics.
5. Translation import and documentation/container work only after the key
   surface stabilizes.

This order gives a quick parity win (`/playlocal`) while keeping the much larger
i18n migration behind a stable, testable foundation.
