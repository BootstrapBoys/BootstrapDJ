# Dashboard Discord login

The dashboard uses Discord OAuth2 and allows only server administrators in one guild.

## Discord Developer Portal

In the application used by the bot:

1. Open **OAuth2**.
2. Add this redirect URL:
   `https://<dashboard-host>/auth/callback`
3. Copy the **Client Secret**. Do not put it in the repository or chat.
4. The OAuth2 scopes used by the dashboard are `identify` and `guilds`.

## Bot host environment

Add to `/root/Bot/.env` or `/root/BotTest/.env`:

```env
DASHBOARD_OAUTH_CLIENT_ID=<application-client-id>
DASHBOARD_OAUTH_CLIENT_SECRET=<application-client-secret>
DASHBOARD_OAUTH_REDIRECT_URI=https://<dashboard-host>/auth/callback
DASHBOARD_SESSION_SECRET=<openssl rand -hex 32>
DASHBOARD_OAUTH_GUILD_ID=<discord-server-id>
```

`DASHBOARD_OAUTH_CLIENT_ID` defaults to `CLIENT_ID`, and
`DASHBOARD_OAUTH_GUILD_ID` defaults to `GUILD_ID` when omitted.

Restart the process:

```bash
pm2 restart BotTest --update-env
```

When all OAuth values are present, the dashboard requires a Discord session. If any OAuth value is present but the set is incomplete, the dashboard fails closed and does not fall back to anonymous access.
The static `DASHBOARD_TOKEN` is ignored in OAuth mode, and NPM does not need to
inject `X-Dashboard-Token`.

## Access rule

The callback checks that the user is a member of the configured guild and has
either the server owner flag or the `Manage Server` permission (`0x20`).
Everyone else receives a 403 response.

## Nginx Proxy Manager

- Forward to the bot host and dashboard port over HTTP.
- Enable HTTPS and Force SSL.
- Cookies must pass through unchanged; NPM does this by default.
- Remove the Access List if you want Discord to be the only login prompt.
- The old `X-Dashboard-Token` custom header is unnecessary in OAuth mode.

## Routes

- `/auth/discord` — start login
- `/auth/callback` — Discord callback
- `POST /auth/logout` — clear the session; requires the CSRF header below
- `/auth/discord`, `/auth/callback`, and logout are rate-limited per client IP

Sessions are signed HTTP-only cookies, scoped to the configured guild, and expire after 24 hours.

## Request protection

Every mutating request must be `content-type: application/json` and carry the
`x-dashboard-csrf` header. The browser reads the non-HttpOnly `bdj_csrf` cookie
from `/api/guilds`; the dashboard does this automatically. Direct API clients
must first call `GET /api/guilds`, keep the cookie, and send its `csrf` value in
the header.

Logout revokes the current session in-process and clears both cookies. Rotate
`DASHBOARD_SESSION_SECRET` to invalidate every existing session across a
process restart.
