# HerbBlender — Architecture & Conventions

A reference for picking this project back up. Written 2026-09-11 against commit `4480413`.
Verified against the code **and** against live Atlas data — where the two disagree, that's
called out explicitly.

---

## 1. What it is, and the four apps

HerbBlender lets you combine up to 3 teas and see their pooled health effects. It's one Express
API with **three separate, independent frontends** — there is no shared frontend framework
between them, only a shared stylesheet.

| App | Port | Stack | Role |
|---|---|---|---|
| `backend/` | 3000 | Express 5 + `mongodb` driver | API, static images, `shared.css` |
| `frontend/` | 42727 | Angular 21, standalone | the blender — pick ≤3 teas → combined effects |
| `teaBrowser/` | 3001 | zero-dependency Node stdlib server | read-only reference/dictionary browser |
| `manager/` | 42728 | Express + `http-proxy-middleware` | CRUD admin. **Local only — not in docker-compose** |

**Everything is same-origin.** The backend has no CORS middleware and no `cors` dependency at
all. Each frontend proxies `/api`, `/images` and `/shared.css` to the backend, so the browser
never makes a cross-origin request:

- Angular dev: [proxy.conf.json](frontend/proxy.conf.json) → `localhost:3000`
- Angular prod: [nginx.conf](frontend/nginx.conf) → `http://backend:3000`
- teaBrowser: [server.js:58](teaBrowser/server.js#L58) via `BACKEND_URL`
- manager: [server.js:9-13](manager/server.js#L9-L13)

If you ever serve a frontend from a different origin, you must add CORS — nothing will work
until you do.

---

## 2. Backend

Three runtime files, ~755 LOC total. The layering is strict and worth preserving:

```
index.js   routes, HTTP concerns, GBIF integration
   ↓
dal.js     all Mongo access + DTO normalization
   ↓
db.js      one shared MongoClient
```

### Connection

[db.js](backend/db.js) holds a single module-level `MongoClient` for the whole process, against
database **`tea_blender`**. Only the password is configurable:

```js
const uri = `mongodb+srv://briidough_db_user:${process.env.DB_PASSWORD}@clusterherbs.q9vwrrs.mongodb.net/?appName=ClusterHerbs`;
```

Cluster host, username and db name are hardcoded. `DB_PASSWORD` comes from `backend/.env`
(untracked, gitignored, excluded from the Docker image; there is no `.env.example`). No pool
options are set — the driver's defaults apply. There's no `client.close()` and no SIGTERM
handler, so shutdown is abrupt.

`db()` is called lazily per query, which is safe because startup fails hard if Mongo is
unreachable ([index.js:411-414](backend/index.js#L411-L414)).

### The one handler shape

Every single route is this pattern. There is no error middleware and no `next(err)` anywhere —
copy this shape for new routes:

```js
app.get('/api/teas/:id', async (req, res) => {
  try {
    const tea = await dal.getTeaById(req.params.id);
    if (!tea) return res.status(404).json({ error: 'Tea not found' });
    res.json(tea);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

Middleware is the entire three lines at [index.js:10-12](backend/index.js#L10-L12):
`express.json()`, `/images` static, and `public/` static (which is how `shared.css` is served).
No helmet, no logging, no rate limiting, no auth.

### Route-ordering contract

Literal paths **must** be registered before their `/:id` sibling, or the param route swallows
them. Two places already depend on this:

- [`/api/herbs/teas-without-herb`](backend/index.js#L143) before [`/api/herbs/:id`](backend/index.js#L161)
- `/api/teas/:id/effects` and `/api/teas/:id/plant` before `/api/teas/:id`

### DTO normalization — the frontend's real contract

Mongo stores **camelCase**. The API returns **SCREAMING_SNAKE_CASE**. Every document passes
through `normTea` / `normEffect` / `normPlant` / `normCompound`
([dal.js:37-90](backend/dal.js#L37-L90)):

```js
function normTea(t) {
  return {
    ID:          t._id.toString(),
    NAME:        t.name,
    EFFECT_NAMES: t.effects || [],
    IMAGE_PATH:  firstImage('teas', t.name),
    ...
  };
}
```

This is a leftover of the original OracleDB column naming. It is now the API contract, and it
has a consequence that matters for the upcoming data work:

> **A field you add to Mongo is invisible until you add it to the matching `norm*` function.**
> This is not hypothetical — see §5 for three fields currently in the DB that no API consumer
> can see.

Request bodies are inconsistent with this: they're camelCase *except* `other_names`
([index.js:175](backend/index.js#L175)), which is snake_case and remapped to `otherNames`.

### Query style

Plain driver calls only — **no aggregation pipelines, no declared indexes, no transactions.**
Joins happen in JavaScript:

- `getTeaPlant` matches `{genus, species}` ([dal.js:198](backend/dal.js#L198))
- `getTeasByHerb` does the same in reverse ([dal.js:205](backend/dal.js#L205))
- `getTeasWithoutHerb` loads *all* plants and *all* teas and does an O(n·m)
  `filter`/`some` ([dal.js:209-217](backend/dal.js#L209-L217))
- `getBlend` fans out N `getTeaWithEffects` calls in `Promise.all`, deduping effects by name
  into a `Map` ([dal.js:135-144](backend/dal.js#L135-L144)). Each tea costs 2 round-trips, so a
  3-tea blend is 6 queries.

Compounds are spread over four collections and addressed through a type↔collection map
([dal.js:246-260](backend/dal.js#L246-L260)). `getCompoundById` / `deleteCompound` /
`updateCompound` linearly probe all four.

### Images are filesystem-backed

There is no image data in Mongo. `firstImage` / `allImages`
([dal.js:13-31](backend/dal.js#L13-L31)) do a **synchronous `fs.readdirSync` per document,
inside the response path** — `GET /api/teas` does 63 of them today. Errors are swallowed
(`catch { return null; }`), so a missing directory silently means "no image".

Path convention: `backend/images/{teas,plants}/<slug>/*`, where slug is the *name* lowercased
with whitespace and apostrophes removed.

> **Slug bug:** [dal.js:10](backend/dal.js#L10) uses `.replace('\'','')` — a string argument,
> so it strips only the **first** apostrophe. [index.js:19](backend/index.js#L19) uses
> `.replace(/'/g,'')` and strips all of them. Single-apostrophe names like `St John's Wort` are
> consistent; a two-apostrophe name would have the GBIF downloader write to one directory and
> the reader look in another.

`backend/images/shrink_images.py` is a Pillow script that recursively caps images at 500 px
wide / ~100 KB.

### GBIF integration

[index.js:14-130](backend/index.js#L14-L130) — raw `https.get` wrapped in promises (no fetch, no
axios), `User-Agent: HerbBlender/1.0`, manual 301/302 following capped at 5 redirects,
content-type→extension sniffing, keeps at most 3 `StillImage` URLs. Two endpoints:
`GET /api/gbif/common-names` and `POST /api/gbif/fetch-images`.

### API reference

All routes under `/api`. Ordering within each group is significant (see above).

| Method | Path | DAL fn |
|---|---|---|
| GET | `/gbif/common-names` | *inline* |
| POST | `/gbif/fetch-images` | *inline, writes to disk* |
| GET | `/herbs` | `getHerbs` |
| GET | `/herbs/teas-without-herb` | `getTeasWithoutHerb` |
| GET | `/herbs/:id/teas` | `getTeasByHerb` |
| GET | `/herbs/:id` | `getHerbById` |
| POST / PUT / DELETE | `/herbs[/:id]` | `addHerb` / `updateHerb` / `deleteHerb` |
| GET | `/teas` | `getTeas` |
| GET | `/teas/:id/effects` | `getEffectsForTea` |
| GET | `/teas/:id/plant` | `getTeaPlant` |
| GET | `/teas/:id` | `getTeaById` |
| POST / PUT / DELETE | `/teas[/:id]` | `addTea` / `updateTea` / `deleteTea` |
| POST | `/teas/:id/effects` | `linkEffectToTea` |
| DELETE | `/teas/:id/effects/:effectName` | `unlinkEffectFromTea` |
| GET | `/blend?ids=a,b,c` | `getBlend` |
| GET / POST / PUT / DELETE | `/effects[/:id]` | effects CRUD |
| GET / POST / PUT / DELETE | `/compounds[/:id]` | compounds CRUD |

Only two endpoints validate input at all (`/gbif/fetch-images`, `/blend`). Every write endpoint
is unauthenticated.

---

## 3. Frontend (Angular)

**Angular 21.2, fully standalone — zero NgModules, zero routing, zero Angular forms.**
`@angular/forms` and `@angular/router` are installed but never imported.

The whole app is **one component plus one service**:

```
App (app-root)            frontend/src/app/app.ts
 └── TeaService            frontend/src/app/tea.service.ts   (providedIn: 'root')
```

Bootstrap is `bootstrapApplication(App, appConfig)` with providers limited to
`provideBrowserGlobalErrorListeners()` and `provideHttpClient()`
([app.config.ts:5-8](frontend/src/app/app.config.ts#L5-L8)).

### State: signals for state, RxJS only at the edge

All state is `signal()`, all derived state is `computed()`
([app.ts:51-112](frontend/src/app/app.ts#L51-L112)). RxJS appears **only** at the HTTP boundary,
as imperative `.subscribe()` calls that write into signals — there is no `toSignal`, no
`httpResource`, and no `async` pipe anywhere.

The one composed stream is the detail overlay, where a missing plant is tolerated
([app.ts:156-166](frontend/src/app/app.ts#L156-L166)):

```ts
forkJoin({
  blend: this.teaService.getBlend([tea.ID]),
  plant: this.teaService.getTeaPlant(tea.ID).pipe(catchError(() => of(null))),
}).subscribe(...)
```

That `catchError` is load-bearing — **over half the teas have no plant record** (§5).

Templates use modern control flow only (`@for` with `track`, `@if`/`@else`, `@empty`) and invoke
signals as functions. Events write signals inline:
`(change)="selectedEffectFilter.set($any($event.target).value)"`.

### Overlay-based UI (not routes, not panels)

The original wireframe was three stacked panels; **what ships is different.** There's one
860 px-max centred column (header + tea tray + effects), and two *sibling* top-level overlays
rendered outside `.app`, stacked by z-index 100/200 rather than nested:

- **Selector overlay** — two `<select>` filters ("All effects" / "Current effects", both writing
  the same `selectedEffectFilter` signal) over a scrollable tea list. Row click adds the tea; a
  `···` button opens detail.
- **Detail overlay** — images, effect chips, description, optional Herb Info block.

Closing is hand-rolled, with an explicit target check so clicks inside the panel don't dismiss
it ([app.ts:176-186](frontend/src/app/app.ts#L176-L186)):

```ts
if ((event.target as HTMLElement).classList.contains('overlay-backdrop')) { ... }
```

There is no Angular CDK, **no Escape-key handler, no focus trap and no ARIA attributes.**

### Domain logic lives in the component

Two pieces of business logic sit in `app.ts` rather than the backend:

- **`EFFECT_MOOD_MAP`** ([app.ts:7-38](frontend/src/app/app.ts#L7-L38)) — a hardcoded 30-entry
  map from effect name → one of four mood classes (`effect-energizing` / `-calming` /
  `-protective` / `-supportive`). `moodClass()` defaults to `supportive` on a miss.
- **`blendGroups`** ([app.ts:91-112](frontend/src/app/app.ts#L91-L112)) — buckets blend effects
  into those four groups, sorts each by shared-count desc then name, drops empty groups.

`sharedClass()` maps a shared count of ≥2/≥3 to `effect-shared-2`/`-3` for visual weight.

The **3-tea cap** is enforced in three independent places: `openSelectorOverlay`
([app.ts:125](frontend/src/app/app.ts#L125)), `addTea`
([app.ts:137](frontend/src/app/app.ts#L137)), and again in the template. (`readonly slots =
[0,1,2]` at [app.ts:49](frontend/src/app/app.ts#L49) is dead code.)

### HTTP layer

Three methods, `inject(HttpClient)`, and **no base URL**
([tea.service.ts:48-56](frontend/src/app/tea.service.ts#L48-L56)):

```ts
getTeas()          -> this.http.get<Tea[]>('/api/teas');
getBlend(ids)      -> `/api/blend?ids=${ids.join(',')}`
getTeaPlant(teaId) -> `/api/teas/${teaId}/plant`
```

There is **no `src/environments/`**, no `environment.ts`, no `isDevMode()`. Every URL is a
same-origin relative path; the dev proxy or nginx supplies the base. The only build-time knob is
`ARG BASE_HREF` → `ng build --base-href`. Images are likewise relative:
`[src]="'/images/' + tea.IMAGE_PATH"`.

No interceptors, no retry, no caching — the blend endpoint is refetched on every add/remove.

All TypeScript interfaces (`Tea`, `Effect`, `Blend`, `Plant`) live in `tea.service.ts` alongside
the service. There is no `models/` directory and no barrel file.

`tsconfig.json` is strict-maximal: `strict`, `noImplicitOverride`,
`noPropertyAccessFromIndexSignature`, `noImplicitReturns`, plus `strictTemplates`.

---

## 4. Styling & visual identity

Three cascading layers:

**1. `backend/public/shared.css` — the design system.** Note where it lives: in the *backend*,
`<link>`ed at runtime as `/shared.css` and proxied, so all three frontends share one palette
from one file. (`frontend/public/shared.css` is a one-line placeholder so the build has an asset
there — don't edit it.)

- **Font:** Lora, imported from Google Fonts. `--font-body: 'Lora', Georgia, serif`.
- **Palette — "warm parchment garden":** bg `#f5f2ec`, surface `#fefcf6`, headings `#2a4528`,
  accent `#4c8c4c`, text `#2b2418`.
- **Four chip triplets** (bg/text/border) matching the four moods: energizing amber, calming
  violet, protective green, supportive teal.
- **Shared primitives** the Angular app depends on: `.overlay-backdrop` (fixed inset-0,
  `rgba(0,0,0,.45)`, flex-centred, z-index 100; `--detail` bumps to 200), `.overlay-panel`
  (`width: min(540px, 92vw)`, `max-height: 80vh`), `.overlay-header`, `.overlay-close`,
  `.effects-grid`, `.effect-chip` + mood classes, `.effect-shared-2|3`, `.btn`, `.empty-msg`.
- `.dict-table`, `.plant-detail-*`, `.compound-detail-*` belong to teaBrowser/manager — unused
  by the Angular app.
- **Theming is declared three times over:** `:root` light default,
  `@media (prefers-color-scheme: dark)`, and manual `html[data-theme="dark"|"light"]` overrides.
  The dark block is duplicated verbatim between the latter two. The Angular app **never sets
  `data-theme`** — that toggle belongs to manager/teaBrowser. Change a dark-mode token and you
  must change it in both blocks.

**2. `frontend/src/styles.css`** — 10 lines: `box-sizing: border-box` and a body reset consuming
`--font-body`/`--color-bg`/`--color-text`. It *assumes* `shared.css` already loaded.

**3. `frontend/src/app/app.css`** — 523 lines of app-specific layout and animation.

### Layout technique

**Flexbox only — not a single CSS Grid** (despite the `.effects-grid` class name) and **zero
`@media` breakpoints.** Responsiveness is entirely intrinsic sizing: cards are
`width: min(176px, calc(50% - 8px))` with a fixed `height: 192px`, giving 3-up on desktop and
2-up on mobile for free; panels are `min(540px, 92vw)`. Name truncation uses `-webkit-box`
line-clamp.

### The signature flourish

The blending animation set ([app.css:288-407](frontend/src/app/app.css#L288-L407)) is the
project's visual identity and worth preserving:

- `.effects-heading.is-blending::after` injects a spinning `⊛` glyph.
- `.effects-grid.is-blending` gets a `blender-vortex` rotate/scale wobble.
- Its chips are split by `:nth-child(3n+1|3n+2|3n)` into three `chip-orbit-a/b/c` keyframes,
  phase-offset with **negative `animation-delay`** so they orbit out of sync.
- Group labels slide in with `nth-child`-indexed delays.
- Settled shared chips get `effect-pop` / `effect-pop-3`.

---

## 5. Data model & authoring guide

Database `tea_blender`, **7 collections**. Live counts as of 2026-09-11: teas **63**, plants
**24**, effects **31**.

### Stored shape → API field

Left column is what's in Mongo (camelCase); right is what the API emits.

**`teas`** — 13 fields live; `normTea` exposes 12.

| Mongo | API | Notes |
|---|---|---|
| `_id` | `ID` | stringified |
| `name` | `NAME` | also the image-directory slug source |
| `description` | `DESCRIPTION` | |
| `genus`, `species`, `family` | `GENUS`, `SPECIES`, `FAMILY` | the join key — see below |
| `oxidation`, `fermentation` | `OXIDATION`, `FERMENTATION` | |
| `effects: string[]` | `EFFECT_NAMES` | effect **names**, not ids |
| `alkaloids: string[]` | `ALKALOIDS` | |
| — | `IMAGE_PATH`, `IMAGE_PATHS` | computed from disk, not stored |
| `polyphenols: string[]` | ⚠️ **not exposed** | in the DB, absent from `normTea` |
| `terpenes: string[]` | ⚠️ **not exposed** | " |
| `otherCompounds: string[]` | ⚠️ **not exposed** | " |

**`plants`** (called "herbs" in the API) — 15 fields live; `normPlant` exposes 12.

| Mongo | API |
|---|---|
| `name`, `genus`, `species`, `family`, `description` | `NAME`, `GENUS`, `SPECIES`, `FAMILY`, `DESCRIPTION` |
| `otherNames[]`, `nativeRange[]` | `OTHER_NAMES`, `NATIVE_RANGE` |
| `gbifUsageKey`, `taxonomy`, `commonNames[]`, `currentRange[]` | `GBIF_USAGE_KEY`, `TAXONOMY`, `COMMON_NAMES`, `CURRENT_RANGE` |
| `climateRegions[]` | ⚠️ **not exposed** |
| `iucnRedListCategory` | ⚠️ **not exposed** |
| `nativeHabitat` | ⚠️ **not exposed** |
| — | `IMAGE_PATH` (computed from disk) |

The four GBIF fields were added by
[migrations/001_add_gbif_fields.js](backend/migrations/001_add_gbif_fields.js) and populated by
[migrations/002_backfill_plants.js](backend/migrations/002_backfill_plants.js). All 57 plants
now carry a `gbifUsageKey` except **Cinnamon** (*Cinnamomum cassia*), which has no
species-level record in the GBIF Backbone — see §5.

**`effects`** — only **3** fields live: `_id`, `name`, `description`.

> ⚠️ `normEffect` maps `e.quality → QUALITY` and `addEffect` writes a `quality` field, but
> **0 of 31 existing effect documents have `quality`** (verified). `Effect.QUALITY` is
> `undefined` for every effect in the app today. Either backfill it or drop it.

**`alkaloids` / `polyphenols` / `terpenes` / `otherCompounds`** — identical shape: `_id`, `name`,
`effects: string[]`, `psychoactive`, `wikilink`. The API flattens all four into `/api/compounds`
with a `TYPE` label, mapped by [dal.js:248-260](backend/dal.js#L248-L260)
(`alkaloids`→`alkaloid`, etc.).

### Relationship contracts — read this before authoring records

There are **no foreign keys anywhere.** Everything is matched by string value.

**1. Tea → Plant is matched on `genus` + `species`.** No id, no ref. A typo in either field
silently orphans the tea — `GET /api/teas/:id/plant` just returns `null` and the Herb Info block
disappears from the detail overlay.

> Current state: **closed**. `plants` holds 57 documents and every tea resolves a plant on the
> strict genus+family+species check — `GET /api/herbs/teas-without-herb` returns `[]`. The gap
> was filled from the GBIF Backbone by `backend/seed/` + `migrations/002_backfill_plants.js`
> (see §5). Re-run that check after adding any tea; it is the cheapest proof the joins hold.

**2. `getTeasWithoutHerb` is stricter than `getTeaPlant`.** It compares `genus` + `family` +
`species` ([dal.js:215](backend/dal.js#L215)) while `getTeaPlant` compares only `genus` +
`species` ([dal.js:198](backend/dal.js#L198)). A tea whose genus/species match but whose
`family` disagrees will appear in the manager's "teas without herb" list *while still resolving
a plant* in the app. If you see that contradiction, it's a `family` mismatch.

**3. Tea → Effect is matched on effect *name*, not id.** `teas.effects` is an array of strings
looked up with `{name: {$in: [...]}}` ([dal.js:124](backend/dal.js#L124)). **Renaming an effect
breaks every tea referencing it.** To rename, update `effects.name` *and* `$set` the string in
every tea's array, in the same pass.

**4. Effect name → mood class is a third, frontend-side string match.** `EFFECT_MOOD_MAP` in
`app.ts` must contain the exact effect name or the chip silently renders as "supportive".

> All 31 live effects are now present in the map, so an unlisted name reliably means someone
> forgot one rather than "it was always like that". Two map entries — **`Antiviral Support`**,
> **`Liver Support`** — still have no matching effect document; they are harmless (an unused
> key changes nothing) and kept deliberately, but reconcile both directions when you touch
> effects.

**5. Images are matched on the *name* slug.** `name.toLowerCase()` minus whitespace and
apostrophes → `backend/images/{teas,plants}/<slug>/`. **Renaming a tea or plant orphans its
images** with no error. `addHerb` pre-creates the directory
([dal.js:183](backend/dal.js#L183)); `addTea` does not.

### Adding a new tea, end to end

1. Insert into `teas` with `name`, `description`, `genus`, `species`, `family`, `oxidation`,
   `fermentation`, plus `effects: []` and `alkaloids: []`.
2. Make sure a `plants` document exists with **matching `genus`, `species` *and* `family`** —
   all three, to satisfy both join paths.
3. Every string in `effects` must already exist as an `effects.name`. Add missing ones first.
4. Add any brand-new effect name to `EFFECT_MOOD_MAP` in
   [app.ts:7-38](frontend/src/app/app.ts#L7-L38), or it renders as supportive.
5. Create `backend/images/teas/<slug>/` and add images (or run
   `POST /api/gbif/fetch-images`). Run `shrink_images.py` afterwards.
6. If you added a field, add it to the matching `norm*` function in `dal.js` or nothing will see it.

### Bulk authoring

The established pattern is hand-run **mongosh** scripts in `data/` (gitignored), targeting
hardcoded ObjectIds:

```js
db.teas.bulkWrite([
  { updateOne: { filter: { _id: ObjectId("…") }, update: { $set: { … } } } },
])
```

Existing scripts: `update_teas.js`, `update_teas_effects.js`, `update_teas_compounds.js`,
`update_effects.js`, `update_alkaloids.js`, `update_polyphenols.js`, `update_terpenes.js`,
`update_other_compounds.js`.

For **schema** changes the pattern is a standalone Node script under `backend/migrations/`:
load `../.env`, `connect()`, one `updateMany` guarded by `$exists: false`, log `modifiedCount`,
`process.exit`. There is no migration runner or registry — they're run by hand, numbered by
convention (`001_…`).

### Seeded plant data

Unlike the `data/` scripts above, the plants collection has a **committed, re-runnable**
source of truth under [backend/seed/](backend/seed/):

| File | Role |
|---|---|
| `plants.json` | Hand-authored: name, genus, species, family, otherNames, nativeRange, description |
| `fetch_gbif.js` | Resolves every binomial against the GBIF Backbone → `plants.gbif.json` |
| `plants.gbif.json` | Generated: usage key, taxonomy, English vernaculars, IUCN category |
| `../migrations/002_backfill_plants.js` | Merges the two and upserts on `{genus, species}` |

```bash
node backend/seed/fetch_gbif.js            # optional, slow, hits the network
node backend/migrations/002_backfill_plants.js
```

The importer writes **only fields whose value would actually change**, and treats an empty
`description` as "not authored yet" rather than "set to empty". So descriptions can be filled
in a few at a time and the importer re-run freely — a no-op run reports `unchanged 57`.

Two rules in the importer exist to protect the string joins, and both have a live cause:

- **`family` always comes from `plants.json`, never GBIF.** GBIF puts *Sambucus nigra* in
  Viburnaceae and *Turnera diffusa* in Turneraceae, but the teas say Adoxaceae and
  Passifloraceae. Taking GBIF's family would orphan those teas under contract 2 above. GBIF's
  view is still recorded under `taxonomy`.
- **`gbifUsageKey` is only written for a species-level match.** *Cinnamomum cassia* has no
  species record in the backbone, so the match degrades to `HIGHERRANK` and GBIF returns the
  key for the *genus*. Storing that would be silently wrong, so it is left `null`.

**A plant name ending in `<>` means the species choice needs a human spot-check** — not the
taxonomy, which is machine-verified, but the question of *which* species the commercial tea is
actually made from. Eight are flagged (Jasmine, Pink Peppercorn, Lemongrass, Rose Hips, Linden,
Licorice, Elderberry, Marigold). Strip the marker once confirmed — and note that renaming a
plant orphans its images (contract 5).

---

## 6. Running & deploying

Node lives outside the system path:

```bash
export PATH="/home/archB/node-v25.9.0-linux-x64/bin:$PATH"
```

Then either the launcher scripts — `start-backend.sh`, `start-frontend.sh`, `start-teabrowser.sh`,
`start-manager.sh` (each prepends that PATH itself) — or `docker compose up`.

The backend has **no `start` script**; it's always `node index.js`. `npm test` exists in the
frontend but currently fails (§7).

Compose ([docker-compose.yml](docker-compose.yml)) defines three services on bridge net
`herbnet`: `backend` (3000), `frontend` (42727), `teabrowser` (3001, with
`BACKEND_URL=http://backend:3000`). **`manager` is deliberately absent** — its proxy target is
`localhost:3000`, which wouldn't resolve in a container.

The nginx config uses a `resolver 127.0.0.11` plus `set $backend http://backend:3000;` before
each `proxy_pass`. The variable form forces **runtime** DNS re-resolution so nginx doesn't die at
startup when the backend isn't up yet — that's the fix in commit `4480413`. Don't inline the
literal URL back into `proxy_pass`.

### Production

Per [wireframes/building_for_docker.readme](wireframes/building_for_docker.readme): Angular is
built with `--base-href /herbblender/app/` and the dist is copied into a **separate**
`welcometobrii` repo, so in production the compose `frontend` service is bypassed in favour of
the welcometobrii nginx image. Images published: `briidough/herbblender-backend`,
`briidough/herbblender-teabrowser`.

Two things to fix when you next deploy:

- The runbook pins `v0.1.0` and re-pushes that same tag, which defeats `docker compose pull`.
  Bump the tag per the deployment convention instead.
- Anything reaching Atlas on that host needs `dns: 1.1.1.1 / 8.8.8.8` in compose — the host's
  `resolv.conf` offers only an unroutable IPv6 nameserver, and the SRV lookup fails at boot
  looking like a bad connection string.

---

## 7. Known sharp edges

Recorded, not fixed.

**Security / correctness**
- No auth, CORS, input validation or rate limiting anywhere. Safe *only* because everything is
  proxied same-origin. Every write endpoint is open.
- `toId()` is unguarded ([dal.js:33](backend/dal.js#L33)), so a malformed `:id` throws inside
  `new ObjectId()` and surfaces as **500 with a raw BSON error string instead of 400**.
- `err.message` is returned verbatim to clients on every 500.
- `POST /api/gbif/fetch-images` flows a request-body `name` into a filesystem path via `slugify`
  with no traversal check.
- `teaBrowser/server.js:62-64` builds `path.join(STATIC_DIR, url)` from the raw request path with
  no normalization or containment check.
- `updateCompound`'s cross-collection "move" is a non-transactional delete-then-insert
  ([dal.js:300-302](backend/dal.js#L300-L302)) — a crash between the two loses the document.

**Performance**
- `getTeasWithoutHerb` is O(n·m) over both full collections.
- One synchronous `readdirSync` per document on every list endpoint.
- No indexes declared on any collection.

**Deployment**
- **No volume is mounted for `backend/images/`**, so GBIF-fetched images are lost on container
  recreate.
- `backend/Dockerfile` copies only `package.json` (not the lockfile) and runs `npm install`, so
  backend builds aren't reproducible. The frontend Dockerfile does this correctly with `npm ci`.
- Backend container runs as root; no healthchecks on any service.

**Housekeeping**
- `frontend/src/app/app.spec.ts:21` still asserts the scaffold's `'Hello, frontend'` against a
  template that renders `Tea Blender`, and `TestBed` has no `provideHttpClient` for the
  `ngOnInit` call — **`npm test` fails.** It's the only spec; runner is Vitest.
- No ESLint anywhere. `.prettierrc` exists but no script runs it and the source doesn't conform.
- `frontend/src/index.html` still has `<title>Frontend</title>`.
- `@angular/forms` and `@angular/router` are installed but unused; `app.ts:49` `slots` is dead.
- `frontend/dist/` and `frontend/.angular/cache/` are present in the tree.
- `Requirements.md` still describes the pre-migration OracleDB design with a `tea.herb_id` FK —
  kept as a historical spec, **not** current. `start-backend.sh` still exports an Oracle
  `LD_LIBRARY_PATH` that does nothing.
