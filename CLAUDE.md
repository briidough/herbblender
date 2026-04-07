# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HerbBlender is a web app for creating tea blends of up to 3 teas and displaying their combined health effects.

## Tech Stack

- **Frontend**: Angular (to be scaffolded in `frontend/`)
- **Backend**: Node.js + Express (in `backend/`)
- **Database**: OracleDB (already provisioned — do not recreate tables or seed data)

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

**herb**: `id`, `name`, `genus`, `species`, `description`, `other_names`

**tea**: `id`, `name`, `description`, `herb_id` (FK → herb.id), `oxidation`, `effects` (array of strings)

## UI Structure

Three vertically-stacked panels (see `herbBlender.drawio`):

1. **Panel 1** — "Choose Tea" selector/search input
2. **Panel 2** — Scrollable list of teas (name + description per row); user picks up to 3
3. **Panel 3** — Displays the selected teas side-by-side (Tea_Picked1/2/3) and a combined "Effects of picked teas" section below
