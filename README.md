# Tronix Arena

Paid, browser-based multiplayer games running entirely on Cloudflare: a 4-player
deathmatch shooter, **Iron Arena** (a 1v1 3D fighter), and four original arcade games
with global leaderboards: **Paint Clash**, **Tower Smash**, **Curve Clash** and **Sky Dash**.
It's a rebranded and fixed-up fork of Cloudflare's [doom-wasm] (the Chocolate Doom
engine compiled to WebAssembly) and their [doom-workers] relay. It uses [Freedoom]
game data, so there are no id Software assets.

| Site | What it does |
|---|---|
| `game.ktmtronix.com` | Landing page, sign-up/login, player dashboard, rewards, Hall of Legends, Fonepay QR payments, `/admin` (`apps/landing`) |
| `arena.ktmtronix.com` | The game. Every request needs a paid session; anyone else is sent to `/login` or `/pay` (`apps/arena`) |

```
browser (host) ──WebSocket──┐                      ┌──WebSocket── browser (player 2..4)
  runs the Doom server      └── Room Durable Object ┘  runs a Doom client
                                (relays packets only)
```

The host's browser runs the authoritative game server and the other browsers are
clients. A Durable Object per room passes packets between them, so there's no game
server to run or pay for.

## Layout

```
apps/landing/      Worker + static pages for game.<domain>
apps/arena/        Worker, Room Durable Object, game page, compiled engine
shared/            session cookies, password hashing, Stripe, EMVCo QR, game list,
                   seasons, schema auto-creation (used by both Workers)
migrations/        D1 schema (users, Stripe events, scores, seasons/rewards/payments)
engine/            Doom engine source (GPL-2.0), built with ./scripts/build-engine.sh
games/fighter/     Iron Arena 3D fighter (used with the author's permission), see games/fighter/TRONIX.md
games/minis/       Arcade games (Tronix Arena originals), see games/minis/README.md
scripts/           build-engine.sh, upload-wads.sh
test/              unit tests (npm test)
```

## How access works

- **Accounts**: email + password (PBKDF2), stored in D1.
- **Sessions**: an HMAC-signed `arena_session` cookie scoped to `.ktmtronix.com`,
  so logging in on `game.` also logs you in on `arena.`. "Log out everywhere"
  is a single `UPDATE users SET session_version = session_version + 1`.
- **Payment (main)**: Fonepay QR, see [Fonepay payments](#fonepay-payments) below.
  An admin approves the transaction code, which sets `users.paid_until`.
- **Payment (optional)**: Stripe Checkout, shown only if the Stripe secrets are set.
  The webhook sets `users.paid_until`.
  - `STRIPE_MODE=payment`: a one-time pass that lasts `PASS_DAYS` days.
  - `STRIPE_MODE=subscription`: `invoice.paid` keeps access in step with billing, and
    `customer.subscription.deleted` ends it.
- **The arena Worker runs before any static file** (`run_worker_first`). The page,
  engine, WADs, room API and room WebSockets all require `paid_until > now`.
  Anyone else is redirected to the landing site, so it behaves like the Zero Trust
  gate you described but without per-seat pricing.

## Changes from Cloudflare's original

**Engine (`engine/`)**
- **Fixed a multiplayer corruption bug.** Newer Emscripten headers include
  `<stdbool.h>`, so `boolean` was 1 byte in some files and 4 in others.
  `playeringame[]` got overwritten, which caused a phantom "Player 4 left the game"
  and clients dropping themselves out of the match. `boolean` is now a 4-byte
  `int` everywhere (`src/doomtype.h`).
- **Fixed two players getting the same network ID** when they joined in the same
  second (the ID came from `srand(time)`). The page now passes a random `-uid`.
- **Easier respawning:** dead players now respawn with Fire as well as Use (E), and
  an on-screen hint tells them so. Vanilla Doom only accepts Use, which new players
  rarely find.
- **Hardened the WebSocket handler:** it no longer leaks a packet when the receive
  queue is full, and it ignores malformed frames.
- **Faster, smaller build:** current Emscripten, `SAFE_HEAP` debug checks removed,
  memory growth on. The `.wasm` went from 7.6 MB to 2.2 MB.
- Rebranded as Tronix Arena 1.0.0.

**Room relay (`apps/arena/src/room.js`)**
- Uses WebSocket Hibernation, so idle lobbies cost nothing.
- A socket is locked to the first network ID it uses. Spoofed sender IDs are dropped.
- Only the room's creator can be the server (ID 1), so nobody can hijack or reset a match.
- Rooms are capped at 4 players, late joins are refused, packets are rate-limited,
  the room closes when the host leaves, and abandoned rooms expire after 6 hours.
- Short 6-character invite codes (`/r/ABC234`) replace long signed IDs.

**Front end**
- New lobby with match settings (mode, map pack, map, skill, monsters, time limit,
  player count) and a live player list.
- WAD downloads show a progress bar and are cached by the browser for a year.
- Mouse capture on click, a fullscreen button, and touch controls on phones.

## Iron Arena (3D fighter)

`games/fighter/` is [Iron Arena](https://github.com/AndreaAcanfora/iron-arena) by
Andrea Acanfora (Three.js + TypeScript + Vite), used **with the author's permission**
and extended with **online 1v1**. It's served by the arena Worker at `/fighter`
behind the same paywall, with invite links at `/f/CODE`.

- **Online play** is delay-based lockstep: each player's input is sent a few ticks
  ahead (picked from the measured ping) through a two-player `FightRoom` Durable
  Object, and a tick only runs once both inputs are known. Both browsers run the
  exact same fight; a checksum every second detects desyncs. Details in
  [games/fighter/TRONIX.md](games/fighter/TRONIX.md).
- `npm run build:fighter` builds it into `apps/arena/public/fighter/` (git-ignored).
  `npm run dev:arena` and `npm run deploy:arena` run it automatically.
- **Players far apart** (different continents) will feel the input delay; the
  next step would be rollback netcode.

## Arcade games

`games/minis/` holds four originals served at `/play/<game>/`; see
[games/minis/README.md](games/minis/README.md). They use two new server pieces:

- **Leaderboards:** `migrations/0002_scores.sql` (best score per player per game) and
  `GET/POST /api/scores/<game>` on the arena Worker.
- **Party rooms:** a `PartyRoom` Durable Object (2–4 players) for Paint Clash and
  Curve Clash, at `/api/party/rooms`.

After pulling this change, apply the new migration once:
`npm run db:migrate:remote`.

## Fonepay payments

KTM Tronix's **static** Fonepay QR is turned into a **dynamic** QR for every
purchase (`shared/emvqr.js`, EMVCo merchant-presented QR format):

1. **Set the QR on `/admin` → Payment QR**: upload a photo or screenshot of the
   static QR. It's decoded in the browser, the checksum and merchant fields are
   checked, and it's saved in D1 (`settings` table). Changing it later is just
   another upload. (Alternatively set the decoded text, which starts with `000201`,
   as the `FONEPAY_QR` secret; an uploaded QR takes priority over the secret.)
2. On `/pay` the player clicks **Pay with Fonepay**. The Worker copies the merchant
   fields and sets point-of-initiation `12` (dynamic), field 54 = `PASS_PRICE_NPR`
   (default 500), field 62 = a unique reference like `TRXAB12CD34`, then recomputes
   the CRC (field 63). The QR image is rendered server-side as SVG.
3. The player scans and pays with any Fonepay / mobile-banking app, then types the
   **transaction code** from their receipt. The payment becomes `submitted`. One
   transaction code can only ever be used once.
4. Staff open **`/admin`**, check the code and amount against the Fonepay merchant
   statement, and **Approve** (adds `PASS_DAYS` days of access) or **Reject** with a
   note the player sees. The `/pay` page polls and sends the player to the arena
   as soon as it's approved.

**Test with one real payment first.** Whether every banking app honours the amount
and reference embedded in a modified static QR depends on the app. The manual
approval step is the safeguard either way. Fonepay's official merchant dynamic-QR
API is the upgrade path if you want automatic verification later.

## Seasons, rewards and the Hall of Legends

- **Seasons** are calendar months in Nepal time (`YYYY-MM`). Every score also goes
  into `season_scores`, so the home page shows "This season" and "All time" boards.
- **Logged-in home page:** pass status, season plays, podiums, per-game best/rank
  for the season and all time, raffle tickets, and the player's trophies.
- **Daily supply drop:** pass holders open one free crate a day for raffle tickets
  (common 1 · rare 3 · epic 6 · legendary 15). Crates are free and can't be bought,
  so it isn't a paid loot box.
- **`/admin`** (accounts listed in the `ADMIN_EMAILS` secret):
  - review Fonepay payments;
  - post reward announcements (title, prize, optional game/season, image, end date, pin);
  - **finalize a season**: writes the top N of every game, with prizes, to the
    Hall of Legends;
  - **draw the merch raffle**, weighted by tickets;
  - track each winner as `pending` → `contacted` → `shipped` while merch goes out.
- Tables are in `migrations/0003_rewards_payments.sql` and `0004_settings.sql`. Both Workers also create any
  missing table on first request (`shared/schema.js`), so a missed migration
  doesn't take the leaderboards down.

## Local development

Needs Node 20+.

```sh
npm install
cp .dev.vars.example apps/landing/.dev.vars
cp .dev.vars.example apps/arena/.dev.vars
npm run db:migrate:local
npm run wads:local          # downloads Freedoom and fills the local R2 bucket
npm run dev:landing         # http://localhost:8787
npm run dev:arena           # http://localhost:8788  (second terminal)
```

Sign up at http://localhost:8787/signup. `DEV_MODE=true` shows a
**"Dev: grant 30 days free"** button on `/pay`, so you can play without Stripe.
Open a second browser profile to join your own room.

Run `npm test` for the unit tests (auth, sessions, Stripe signatures, room codes,
EMVCo QR, seasons, drop odds). For local `/admin`, put `ADMIN_EMAILS=you@example.com`
and a test `FONEPAY_QR` in `apps/landing/.dev.vars`.

## Deploying

1. **Create resources** (one time):
   ```sh
   npx wrangler d1 create ktm-arena          # put the id in BOTH wrangler.jsonc files
   npx wrangler r2 bucket create ktm-arena-wads
   npm run db:migrate:remote
   npm run wads:remote
   ```
2. **Secrets.** `SESSION_SECRET` must be the same long random string on both Workers:
   ```sh
   openssl rand -base64 48   # use the output for SESSION_SECRET
   npx wrangler secret put SESSION_SECRET -c apps/landing/wrangler.jsonc
   npx wrangler secret put SESSION_SECRET -c apps/arena/wrangler.jsonc
   npx wrangler secret put ADMIN_EMAILS -c apps/landing/wrangler.jsonc  # e.g. you@example.com,staff@example.com
   ```
   After deploying, log in with one of those emails and upload the Fonepay QR on
   `/admin`. The pass price is the `PASS_PRICE_NPR` var in `apps/landing/wrangler.jsonc`.
3. **Stripe (optional).** Set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` and
   `STRIPE_WEBHOOK_SECRET` the same way, then create a webhook endpoint at `https://game.ktmtronix.com/api/stripe/webhook`
   for `checkout.session.completed`, `invoice.paid` and
   `customer.subscription.deleted`.
4. **Deploy:** run `npm run deploy:landing` and `npm run deploy:arena`. Both
   `wrangler.jsonc` files attach their custom domains.
5. **Remove the old Zero Trust Access app** on `arena.ktmtronix.com` if you made one.
   The Worker enforces access now, and an Access app in front would block paying
   players who aren't on its allow list.

## Rebuilding the engine

`apps/arena/public/engine/` holds a prebuilt copy, so deploying doesn't need
Emscripten. After changing `engine/`:

```sh
source /path/to/emsdk/emsdk_env.sh
npm run build:engine
```

## Licensing

- **`engine/` is GPL-2.0.** You serve the compiled engine to players, so the source
  for exactly what you run (this directory, with your changes) must stay publicly
  available. The site footers link to this repository; keep it public, or publish
  `engine/` somewhere public and update those links.
- **Freedoom** is BSD-3-Clause and **nipplejs** is MIT. Their notices are served
  at `/licenses`.
- **Branding:** don't use "Doom" in the product name or marketing. It's an
  id Software trademark.
- **`games/fighter/` (Iron Arena)** has no open-source licence: it's used with the
  author's permission. Keep that permission in writing. Its assets are CC0.
- The Worker and web code in `apps/` and `shared/` is yours to license however you like.

[doom-wasm]: https://github.com/cloudflare/doom-wasm
[doom-workers]: https://github.com/cloudflare/doom-workers
[Freedoom]: https://freedoom.github.io/
