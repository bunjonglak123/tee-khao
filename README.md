# Tee-Khao (ตี้ข้าว) — plan a meal, split the bill

[![CI](https://github.com/bunjonglak123/tee-khao/actions/workflows/ci.yml/badge.svg)](https://github.com/bunjonglak123/tee-khao/actions/workflows/ci.yml)

Tee-Khao is a small web app my friends and I use for group meals. One person
creates a party and shares the link in LINE. Everyone joins and logs what was
ordered, and the app works out who owes what, including service charge, VAT,
discounts and rounding. It also generates a PromptPay QR code for each person.
Receipts can be scanned with Gemini instead of typing the menu in by hand.

**Live demo:** https://tee-khao-demo.vercel.app. All the data on it is fake and
resets every day at 04:00 (Bangkok), so feel free to click around and edit things.

| Party list and details | Bill split with PromptPay QR | Mobile |
|---|---|---|
| ![Party](docs/screenshots/party.png) | ![Bill](docs/screenshots/bill.png) | ![Mobile](docs/screenshots/mobile.png) |

## Features

- **Parties by link.** Create a party, share the link, and friends join with a nickname. No accounts.
- **Live sync.** Everyone sees the same party, with smart polling (about 1 s while active, 5 s when idle).
- **Fair split.** Each dish is shared only by the people who ate it, and dishes nobody picked are split by everyone.
- **Bill rules.** 10% service charge, then 7% VAT. Discounts can be % or baht, for the whole bill or chosen dishes, and per-dish discounts are supported too. Totals can be rounded up to whole baht.
- **Payments.** PromptPay QR codes (EMVCo payload with CRC-16) carry each person's exact amount. Bank account details can be copied, and people can mark themselves as paid.
- **Receipt scan.** Gemini reads the receipt photo and you review the result before it is added. Gemini models are tried in a fallback chain, and scans have a daily cap.

## Architecture

```mermaid
flowchart LR
  B[Browser<br/>index.html + app.js<br/>vanilla JS, no build] -->|fetch /api/*| F[Vercel Functions<br/>api/*.js]
  F --> P[(Postgres<br/>schema teekhao)]
  F -->|receipt image| G[Gemini API]
  C[Vercel Cron<br/>daily] -->|demo only| R[api/reset-demo] --> P
```

- **Frontend:** plain HTML, CSS and JS modules. `lib/bill.js` holds all the bill math and the PromptPay payload code as pure functions, which the browser and the tests share.
- **Backend:** four small Vercel functions. All input is validated in `api/_validate.js`, and every party update runs in one transaction with a revision number. Clients poll with `?rev=` and get a tiny "same" response when nothing has changed.
- **Two deployments, one codebase.** The real site is used by friends. The demo site sets `DEMO_MODE=1`, has its own database, and is seeded with fake parties that are reset daily by cron.
- **`server.js`** runs the same handlers on plain Node, for Docker, local development and the e2e tests. Vercel does not use it.

### Privacy model

Parties are reachable only by their link. Party ids are 16 random hex characters,
so they cannot be guessed. The server never lists other people's parties: the home
screen shows only the parties this browser has created, joined or opened. Only the
demo site, which holds fake data, lists every party.

## Run it locally

With Docker:

```bash
docker compose up --build
# open http://localhost:3000  (Postgres + fake demo data, ready to use)
```

To try receipt scanning, set `GEMINI_API_KEY` in your shell before running `docker compose up`.

Without Docker, you need Node 22 and a Postgres database:

```bash
npm ci
POSTGRES_URL=postgres://user:pass@localhost:5432/db PGSSLMODE=disable npm run seed
POSTGRES_URL=postgres://user:pass@localhost:5432/db PGSSLMODE=disable DEMO_MODE=1 npm start
```

## Tests

```bash
docker run -d --name tk-testdb -e POSTGRES_USER=tk -e POSTGRES_PASSWORD=tk -e POSTGRES_DB=tk -p 54329:5432 postgres:16
export TEST_DATABASE_URL=postgres://tk:tk@localhost:54329/tk

npm test            # Vitest: bill math, PromptPay, validation, API handlers, demo reset, server
npx playwright install chromium
npm run test:e2e    # Playwright: full party flow + privacy (a stranger can't see your party)
```

Tests that need a database are skipped when `TEST_DATABASE_URL` is not set.

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) runs on every push:

1. **test:** unit and API tests, then the Playwright e2e tests, against a Postgres service container.
2. **secrets:** fails if any `.env` file is tracked, then scans the full history with gitleaks.
3. **deploy:** only on `main`, and only after both jobs pass. Deploys the real site and the demo site with the Vercel CLI.

## Configuration

Environment variables are set in Vercel, or in your shell when running locally.
No env files are committed to this repo.

| Variable | Used for |
|---|---|
| `POSTGRES_URL` (or `DATABASE_URL`) | Postgres connection string |
| `PGSSLMODE` | `disable` for local Postgres without TLS (TLS is required otherwise) |
| `GEMINI_API_KEY` | Receipt scanning. Without it, scanning shows a "not configured" message |
| `GEMINI_MODEL` | Optional comma-separated model fallback list |
| `SCAN_DAILY_LIMIT` | Max receipt scans per day (default 40, 20 on the demo) |
| `DEMO_MODE` | `1` on the demo site: lists all parties and enables the daily reset |
| `CRON_SECRET` | Bearer token Vercel Cron sends to `/api/reset-demo` |
| `SEED_ON_START` | `1` makes `server.js` load demo data at startup (used by Docker) |
| `PORT` | Port for `server.js` (default 3000) |

CI deploy secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_PROD`, `VERCEL_PROJECT_ID_DEMO`.

## Project structure

```
index.html, style.css, app.js   UI (vanilla JS module)
lib/bill.js                     bill math + PromptPay payload (pure, tested)
lib/known.js                    "parties this browser knows" list
lib/seed.js                     fake demo data
api/                            Vercel functions (_lib, _validate are private helpers)
server.js                       Node adapter for Docker / tests
test/                           Vitest unit + API tests
e2e/                            Playwright tests
scripts/                        seed + screenshot scripts
```
