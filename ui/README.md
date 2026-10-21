# Crew Board scaffold

Milestone 6, bullet 1 only. `/` lists boards and their SSE connection state;
Inbox (bullet 4), Team and Memory (bullet 5) are placeholders. Board view and
task detail belong to bullets 2 and 3.

## Run locally

Requires Node 22+ and npm. From the root:

```sh
npm install
npm run build
# In a throwaway git project, with a separate CREW_HOME:
CREW_HOME=/tmp/crew-board-home node /absolute/path/to/Crew/dist/cli.js init
CREW_HOME=/tmp/crew-board-home node /absolute/path/to/Crew/dist/cli.js start
```

In another terminal, from Crew:

```sh
npm ci --prefix ui
CREW_SERVER_URL=http://127.0.0.1:4000 npm --prefix ui run dev
```

Use `http://127.0.0.1:3000/` with the fragment from `crew open` (replace only
the port in the printed login link). The proxy forwards `/api/*`, including
SSE and session cookies. Use `127.0.0.1` consistently; the cookie belongs to
the browser hostname. `CREW_SERVER_URL` is a development-only setting, not
an exposed `NEXT_PUBLIC_*` variable. Restart `next dev` after changing it.

**Integration TODO (Track A):** The shared base lacks `/api/session`,
`GET /api/boards`, and static serving. Until those land, real login and the
board list cannot work end to end. `lib/types.ts` copies the actual boards response read from Track A's sibling
checkout; confirm that shape against the final Track A merge. There
are no mock routes or secret-header fallbacks in the shipped app. Browser
checks using temporary mocks and the isolated Track A server are recorded in `../plan/phase1/reports/m6-ui.md`.

## Build and check

```sh
npm run build:ui
npm --prefix ui run check
```

`build:ui` installs this package from its own lockfile (including development
tools), runs strict TypeScript, ESLint and `next build`, then copies `ui/out`
to `dist/ui`. A failed step exits nonzero before publishing output. `prepack`
builds the CLI first, then the Board. The root CLI build cleans `dist`, so run
the UI build **after** the CLI build. `npm test` does not install or build UI.
Production is only static files served by Hono; no Next server is needed.

## Restyle

All colors, radii and fonts live in `app/globals.css`: `:root` is the light
theme, `.dark` is dark, and `@theme inline` maps variables to Tailwind tokens.
Set `--crew-font-sans` / `--font-mono` to change fonts without a network font
fetch. The selector supports light, dark and system through `next-themes`.
Feature components in `components/` compose repository-owned shadcn primitives
from `components/ui/`; adjust those primitives for shared control styling.
Layout and spacing are composed with Tailwind; pages do not style raw controls.
Sonner is mounted once in `components/providers.tsx`.

## Add a primitive

From `ui/`:

```sh
npx --no-install shadcn add <component>
```

Initialized using shadcn 4.22.1, Radix Nova, neutral, CSS variables and the
`@/*` alias. `components.json` records the registry setup. Use the generated
`Field`, `FieldLabel`, `FieldError` and `FieldGroup` pieces for forms (the
current registry replaces its former `form` entry with `field`). After adding
components, pin any added dependency versions exactly in `ui/package.json`,
refresh `ui/package-lock.json`, and inspect token changes before committing.
Do not scatter literal colors into features.

## API and live data

`lib/api.ts` carries same-origin cookies, attaches `X-Crew-Board: 1` to
non-GET calls, preserves server error messages, and emits `crew:unauthorized`
on 401. `providers.tsx` then returns to login and unmounts streams. The login
key is read once from the fragment, immediately removed with `replaceState`,
and exchanged in a POST body; Strict Mode remounts share the same promise.
No key goes into queries, browser storage, or logging.

`useBoardEvents(id, refetch)` returns connecting/live/reconnecting/offline,
closes EventSource before retrying at 1, 2, 4…30 seconds, and refetches on
first connect, named board changes and reconnect. A session probe on stream
failure handles 401 because EventSource does not expose HTTP status. One selected board owns a stream (use Connect to switch), preserving HTTP/1.1
request capacity; unmount cancels it and its retry timer. The
list coalesces invalidations during a pending fetch and also polls every 15 seconds to discover newly initialized boards.
