# Dashboard audio tap — v0.3 integration

Goal: the dashboard plays the **exact** Opus frames Discord hears, and its mute
button affects only that browser. The tap is a Lavalink core hook plus the
separately versioned `bootstrapdj-audiotap` plugin in
`BootstrapBoys/BootstrapDJ-Lavalink-AudioTap`.

## Architecture

```text
Lavalink hook + AudioTap plugin
  -> GET <active-node>/v4/audiotap/{guildId}
     Authorization: <LAVALINK_AUTH>        (raw password, no Bearer)
  -> dashboard sidecar /api/audio           session + guild membership + listen role
  -> browser fetch stream                  no Lavalink password reaches the page
  -> WebCodecs AudioDecoder                opus 48 kHz stereo
  -> GainNode -> AudioContext              local mute only
```

There is no separate tap URL, tap token, loopback listener, or
`X-BootstrapDJ-Tap` header in v0.3. The relay uses `LAVALINK_URL`,
`LAVALINK_SECURE`, and `LAVALINK_AUTH` for the node that owns the guild player.
If the active node has no tap route, Listen is disabled and the browser does
not retry.

## Dashboard behavior

- `src/dashboard/audioTap.ts` resolves the active node from `Dispatcher.node`
  (falling back to the queue's current node), matches it against
  `config.lavalink`, and builds the `/v4/audiotap/<guildId>` target.
- `resolveAudioTapTarget` accepts a configured HTTP(S) Lavalink endpoint and raw
  password; it rejects malformed URLs, embedded credentials, and missing auth.
  The host is never accepted from browser input.
- `relayAudioTap` sends the raw password as `Authorization`, keeps
  `Cache-Control: no-store` and `X-Accel-Buffering: no`, maps `404`/`405`/`501`
  to `501`, preserves `401`/`403`/`429`, and returns `503` when the node is
  unreachable.
- `/api/audio` requires `access.listen`; `/api/state` exposes
  `audio.available` and `audio.canListen`.
- The browser never sends a tap header. It hides/disables Listen when
  `canListen` is false, stops on `501`/`503` without scheduling a reconnect, and
  stops with a rate-limit message on `429`.

## Listen role allowlist

Two ordinary per-guild settings control access:

```ts
audiotapallowall: 'true', // any guild member
audiotaproles: '',        // comma/space-separated role IDs when allow-all is false
```

`guildAccessFor` computes:

```text
listen = owner || admin || allow-all || member has an allowed role
```

The check is server-side. Invalid role IDs are ignored; the original setting
string remains editable. Token mode keeps `FULL_ACCESS` and `listen: true`.
The dashboard settings modal shows **Allow all members to listen** and
**Listening role IDs**; `/settings` can set both keys too.

## Verification

- `tests/audio-tap.test.mjs`: configured target, malformed/credential URL
  rejection, `/v4/audiotap/<guild>` path, raw password auth, no tap header,
  200 relay, `401`/`403`/`429` passthrough, `404`/`405`/`501` → `501`,
  unreachable → `503`, state availability, `canListen`, and denied `403`.
- `tests/audio-tap-access.test.mjs`: allow-all, denied-by-default, allowed role,
  owner bypass, and token mode.
- Run `npm run build`, `npm run lint`, `npm test`, and `npm run format`.

## Compatibility and async timeout

The accepted pair is **hook `4.2.2-tap.2` + plugin `0.3.1`**. From `0.3.1`,
the plugin owns the MVC async timeout through its `TapWebMvcConfig`; the hook
does not need the `configureAsyncSupport` change. Hook `4.2.2-tap.3` (commit
`00c5571`) was a temporary stopgap for the 30-second `StreamingResponseBody`
ceiling and is **not** the long-term pair. This keeps upstream PR #1239
frames-only and lets the hook fork be retired once that PR lands.

## Rollout

1. Deploy plugin `0.3.1` with hook `4.2.2-tap.2` and verify the production node
   accepts raw-password auth and holds a tap stream past 35 seconds.
2. Deploy this bot change; do not deploy it against plugin `0.2.0` because
   `/v4/audiotap/...` will return `404`.
3. Verify in a signed-in browser: allowed role hears audio, denied role gets
   `403`, allow-all restores access, normal stream-end reconnect still works,
   and an unsupported node drops audio without a retry loop.
4. Keep the `0.2.0` plugin jar and old `:2444` token configuration available for
   rollback until the cutover is accepted.

## Security invariants

- The Lavalink password is server-side only; never send it to the browser, put
  it in a URL, or log it.
- Use HTTPS for a remote Lavalink node.
- `/api/audio` requires a dashboard session and guild membership; it is not a
  public proxy.
- Mute is a client `GainNode` only. No `/api/player` call on mute.
- A failed tap must never break Discord playback.
