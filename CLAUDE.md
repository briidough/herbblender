# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HerbBlender is a web app for creating tea blends of up to 3 teas and displaying their combined health effects.

See `ARCHITECTURE.md` for the full reference: techniques, styling conventions, the relationship
contracts between collections, and a data-authoring guide.

## Tech Stack

One Express API with three independent frontends. All are same-origin — each frontend proxies
`/api`, `/images` and `/shared.css` to the backend, and **the backend has no CORS middleware**.

- **Backend** (`backend/`, port 3000): Node.js + Express 5
- **Frontend** (`frontend/`, port 42727): Angular 21, standalone components, no router
- **teaBrowser** (`teaBrowser/`, port 3001): zero-dependency Node stdlib server, read-only browser
- **manager** (`manager/`, port 42728): Express CRUD admin — local only, not in docker-compose
- **Database**: MongoDB Atlas, database `tea_blender` (already provisioned — do not recreate
  collections or seed data). Connection is hardcoded in `backend/db.js` except the password,
  which comes from `backend/.env` as `DB_PASSWORD`.

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

Mongo stores **camelCase**; the API returns **SCREAMING_SNAKE_CASE** via the `norm*` functions in
`backend/dal.js` (a leftover of the original Oracle column naming). A field added to Mongo is
invisible to the frontend until it's added to the matching `norm*` function.

Seven collections:

- **teas**: `name`, `description`, `genus`, `species`, `family`, `oxidation`, `fermentation`,
  `effects` (array of effect *names*), `alkaloids`, `polyphenols`, `terpenes`, `otherCompounds`
- **plants** (exposed as "herbs" in the API): `name`, `genus`, `species`, `family`,
  `description`, `otherNames`, `nativeRange`, plus GBIF fields
- **effects**: `name`, `description`
- **alkaloids**, **polyphenols**, **terpenes**, **otherCompounds**: `name`, `effects`,
  `psychoactive`, `wikilink` — flattened into `/api/compounds` with a `TYPE` label

**There are no foreign keys. Everything is matched by string value:**

- Tea → Plant is matched on `genus` + `species` (no `herb_id`). A typo silently orphans the tea.
  Note `getTeasWithoutHerb` also compares `family`, so it is stricter than `getTeaPlant`.
- Tea → Effect is matched on effect **name**, not id. Renaming an effect breaks every tea
  referencing it.
- Images are matched on a slug of the **name** (`backend/images/{teas,plants}/<slug>/`), so
  renaming a tea or plant orphans its images.
- Effect name → chip colour is a fourth string match, against `EFFECT_MOOD_MAP` in
  `frontend/src/app/app.ts`. A new effect not listed there renders as "supportive".

## UI Structure

The three-stacked-panel layout in `herbBlender.drawio` is a **historical wireframe** — it was
superseded by an overlay-based UI. What ships:

- One centred 860px column: header, tea tray (up to 3 selected teas), grouped effects section.
- A **selector overlay** — effect filters over a scrollable tea list; row click adds the tea.
- A **detail overlay** — images, effect chips, description, optional Herb Info block.

The two overlays are siblings rendered outside the main column and stacked by z-index (100/200),
not nested. There is no router. State is Angular signals; RxJS appears only at the HTTP boundary.
