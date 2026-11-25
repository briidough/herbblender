# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HerbBlender is a web app for creating tea blends of up to 3 teas and displaying their combined health effects.

See `ARCHITECTURE.md` for the full reference: techniques, styling conventions, the relationship
contracts between collections, and a data-authoring guide.

## Tech Stack

One Express API with three independent frontends. All are same-origin — each frontend proxies
`/api`, `/images` and `/shared.css` to the backend, and **the backend has no CORS middleware**.

- **Backend** (`backend/`, port 3000): Node.js + Express 5 + the `pg` driver
- **Frontend** (`frontend/`, port 42727): Angular 21, standalone components, no router
- **teaBrowser** (`teaBrowser/`, port 3001): zero-dependency Node stdlib server, read-only browser
- **manager** (`manager/`, port 42728): Express CRUD admin — local only, not in docker-compose
- **Database**: PostgreSQL, database `herbblender`, on the briinas server at
  `192.168.1.227:40021` (already provisioned — do not recreate the schema or reload data).
  Host/port/database are hardcoded defaults in `backend/db.js`, overridable by `PGHOST` /
  `PGPORT` / `PGDATABASE`; the passwords come from `backend/.env`.

  **Two roles, two pools.** `herbblender_app` (`DB_PASSWORD`) is read-mostly and backs every
  read. `herbblender_admin` (`ADMIN_DB_PASSWORD`) holds the DML and backs every write. The
  admin pool is created *only* when `ADMIN_DB_PASSWORD` is set, so a deployment without that
  variable is structurally read-only — the API cannot write even if a handler tries.

Shared styling lives in `backend/public/shared.css` — served by the backend and proxied to all
three frontends, so one file owns the palette.

## Node.js

Node.js is installed at `/home/archB/node-v25.9.0-linux-x64/bin/`. Add to PATH before running node/npm commands:

```bash
export PATH="/home/archB/node-v25.9.0-linux-x64/bin:$PATH"
```

## Backend Commands

```bash
cd backend
node index.js          # start the server
```

## Data Models

Postgres stores **snake_case**; the API returns **SCREAMING_SNAKE_CASE** via the `norm*`
functions in `backend/dal.js`. That casing is a leftover of the original Oracle column naming,
kept deliberately as a DTO so the three frontends never learned the database changed — no
column anywhere is actually named that way. **A column you add is invisible to the frontends
until you add it to the matching `norm*` function.**

The authoritative schema is `study/schema.sql`, annotated clause by clause in
`study/DATA_MODEL.md`. The shape in brief:

- **taxon** — a self-referencing adjacency list, one root (Plantae), seven ranks from kingdom
  to species. `genus`, `species` and `family` are no longer columns on anything; they are
  recovered by walking this tree, which is why `TEA_SELECT` and `PLANT_SELECT` carry three to
  seven self-joins.
- **plant** (exposed as "herbs") → one species-level `taxon`. **tea** → one `plant`,
  many-to-one, because Rooiboos and Green Rooiboos are the same plant processed differently.
- **compound** — the four Mongo collections collapsed into one table plus `compound_type`.
  `psychoactivity` is an FK into a lookup of `no` / `mild` / `yes`, not a boolean.
- **effect** — carries `mood`, one of `calming` / `stimulating` / `protective` / `supportive`
  / `caution`.
- **effect_claim** — an exclusive arc: a claim is about a tea *or* a compound, with an
  optional `source`. This is what replaced the `effects` array on documents.
- **blend** / **blend_item**, **compound_interaction**, **app_user** / **saved_blend** exist
  in the schema and have no API surface yet.

**The string matches are mostly gone — that was the point of the migration.** What remains:

- Tea → Plant resolves through `genus` + `species` **only on write**, in `resolvePlantId`, and
  only because the manager's form still collects them as free text. It cannot half-succeed:
  no match means no `plant_id`, and `tea.plant_id` is NOT NULL, so the insert is refused
  rather than producing an orphan. See `taxonomy_lookup_feature` for the plan to retire it.
- Images are still matched on a slug of the **name**, but the slug is now a STORED generated
  column on `plant` and `tea`, so the writer and the reader cannot disagree about it. The
  mirror of that expression in `index.js` must stay identical.
- Effect name → chip colour now comes from `effect.mood` over the API. `EFFECT_MOOD_MAP` in
  `frontend/src/app/app.ts` and `teaBrowser/app.js` survives only as a fallback.

Deleting is now refused rather than silently orphaning: `tea.plant_id` and
`effect_claim.effect_id` are ON DELETE RESTRICT, so the manager surfaces a constraint error
in its banner instead of succeeding and leaving dangling references.

## UI Structure

The three-stacked-panel layout in `herbBlender.drawio` is a **historical wireframe** — it was
superseded by an overlay-based UI. What ships:

- One centred 860px column: header, tea tray (up to 3 selected teas), grouped effects section.
- A **selector overlay** — effect filters over a scrollable tea list; row click adds the tea.
- A **detail overlay** — images, effect chips, description, optional Herb Info block.

The two overlays are siblings rendered outside the main column and stacked by z-index (100/200),
not nested. There is no router. State is Angular signals; RxJS appears only at the HTTP boundary.
