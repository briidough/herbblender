# HerbBlender — Architecture & Conventions

A reference for picking this project back up. Written 2026-09-11 against commit `4480413`;
revised 2026-11-25 for the Mongo → PostgreSQL migration on the `postgres_refactor` branch.

The database changed; **the API did not**. The SCREAMING_SNAKE_CASE wire format is preserved
deliberately, quirk for quirk, so none of the three frontends had to know. Where this document
describes a hazard in the past tense, that is the point: the schema in
[study/schema.sql](study/schema.sql) made it unrepresentable. `study/DATA_MODEL.md` annotates
that schema clause by clause, and `study/golden/` holds the before/after API capture that
proves the wire format survived.

---

## 1. What it is, and the four apps

HerbBlender lets you combine up to 3 teas and see their pooled health effects. It's one Express
API with **three separate, independent frontends** — there is no shared frontend framework
between them, only a shared stylesheet.

| App | Port | Stack | Role |
|---|---|---|---|
| `backend/` | 3000 | Express 5 + `pg` driver | API, static images, `shared.css` |
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
dal.js     all SQL + DTO normalization
   ↓
db.js      two pg connection pools, one per role
```

### Connection

[db.js](backend/db.js) holds **two** module-level `pg.Pool`s for the whole process, against
database **`herbblender`** on the briinas server. The split is the point:

| Pool | Role | Password | Used by |
|---|---|---|---|
| `db()` | `herbblender_app` | `DB_PASSWORD` | every read |
| `admin()` | `herbblender_admin` | `ADMIN_DB_PASSWORD` | every write |

`herbblender_app` holds `SELECT` plus DML on only the four blend/user tables; the catalogue is
reference data it cannot touch. The admin pool is built **only when `ADMIN_DB_PASSWORD` is
set**, and `admin()` throws a clear error when it is absent — so a deployment that omits that
one variable is structurally read-only rather than read-only by convention. Calling `connect()`
without `DB_PASSWORD` fails immediately.

Host, port and database default to `192.168.1.227`, `40021` and `herbblender`, overridable via
`PGHOST` / `PGPORT` / `PGDATABASE`. Passwords come from `backend/.env` (untracked, gitignored,
excluded from the Docker image; there is no `.env.example`).

Both pools carry an `error` listener. That is not optional: `pg` emits `error` on the Pool when
an **idle** client dies — server restart, dropped link — and an unhandled `error` event takes
the process down with it.

`db()` is called lazily per query, which is safe because startup fails hard if Postgres is
unreachable, and `index.js` closes both pools on SIGTERM/SIGINT so Docker stops cleanly.

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

Postgres stores **snake_case**. The API returns **SCREAMING_SNAKE_CASE**. Every row passes
through `normTea` / `normEffect` / `normPlant` / `normCompound`:

```js
function normTea(r) {
  return {
    ID:           r.id,
    NAME:         r.name,
    OXIDATION:    r.oxidation ?? '',      // '' → NULL in the DB, '' again on the wire
    EFFECT_NAMES: r.effect_names,
    IMAGE_PATH:   firstImage('teas', r.image_slug),
    ...
  };
}
```

This is a leftover of the original OracleDB column naming — **no column anywhere is actually
named this way.** It survived the Mongo era as a normalisation layer and is now a deliberate
DTO: the API and all three frontends never learned the database changed.

That makes these functions the place where migration-era compatibility quirks live, and each
one is commented with the quirk it preserves:

- `OXIDATION` / `FERMENTATION` / plant `DESCRIPTION` restore `''` for the honest `NULL`s that
  `stage_load.sql` created from empty strings.
- `GBIF_USAGE_KEY` keeps `|| null`, so a key of `0` still becomes `null` — the original bug,
  kept on purpose, because this is a compatibility layer.
- `TAXONOMY` is rebuilt from the seven-rank taxon walk rather than stored, which is why
  Cinnamon gains a lineage it never had and Damiana no longer contradicts its own `FAMILY`.
  Both diffs are expected and recorded in `study/golden/EXPECTED_DIFFS.md`.
- `QUALITY` is emitted as `undefined`, not `null`, so `JSON.stringify` drops the key exactly
  as it always did. No effect ever had a quality and there is no such column; `MOOD` replaced
  it.
- Compound `TYPE` is mapped explicitly, because the database says `other` and the wire format
  has always said `otherCompound`.

> **A column you add is invisible until you add it to the matching `norm*` function.**

Request bodies are inconsistent with this: they're camelCase *except* `other_names`
([index.js:175](backend/index.js#L175)), which is snake_case and remapped to `otherNames`.

### Query style

Parameterized SQL only — no string interpolation of values anywhere, and the `SET` lists in
the `update*` functions are assembled from a fixed whitelist of column names, never from
caller-supplied keys.

Two query constants are shared by every read of their table, so a filtered read and a list
read cannot drift apart:

- **`TEA_SELECT`** — joins `plant` then walks three `taxon` self-joins up to family, and picks
  up alkaloid names and effect names through **two `LEFT JOIN LATERAL`s** (Oracle's
  `OUTER APPLY`: a subquery in the `FROM` clause that can see the outer row). Two separate
  laterals, not one `GROUP BY` over both joins — that would multiply alkaloid rows by effect
  rows and silently inflate each. The classic fan-out.
- **`PLANT_SELECT`** — the same idea up all seven ranks. The upper four are `LEFT` joined, so
  a plant with an incomplete lineage is still readable.

`getBlend` is **two** queries for the whole blend, regardless of size: one `TEA_SELECT` with
`tea_id = ANY($1::bigint[])`, one for the effects. It preserves the caller's id order.

Writes that touch more than one table run in a transaction through the `inTransaction` helper:
`addTea`, `updateTea`, `addHerb`, `updateHerb`, `addCompound`, `updateCompound`. `ensureTaxon`
and `resolvePlantId` take the client rather than opening their own, so the taxon rows they
create commit or roll back with the row that referenced them.

Ordering is deliberately split between SQL and JS. `getEffects` sorts in SQL with
`COLLATE "C"` (byte order, which is what Mongo's `sort({name: 1})` did; the default collation
is locale-aware and would interleave case). `getCompounds` sorts in **JS**, because the old
order came from `localeCompare` on `(TYPE, NAME)` and no SQL collation reproduces that exactly.

Compounds are one table with a `compound_type` dimension, so the four-collection probe is
gone, and a compound changing type is one `UPDATE` rather than a delete-and-reinsert across
collections.

### Images are filesystem-backed

There is no image data in the database. `dal.js` builds an **index of the image tree once at
startup** — `scanImages()` — and `firstImage` / `allImages` are then `Map` lookups.

That replaced a synchronous `fs.readdirSync` *per row, inside the response path*: `normTea` and
`normPlant` each did one, so `GET /api/teas` blocked the event loop 126 times per request.
Anything that writes into `backend/images/` must call `refreshImages()` — `addHerb` does, and
so does the GBIF download in `index.js`.

Path convention: `backend/images/{teas,plants}/<slug>/*`.

> **The slug is no longer computed in JavaScript.** `plant.image_slug` and `tea.image_slug` are
> **STORED generated columns** with an identical expression, so the writer and the reader
> cannot disagree. They previously did: `dal.js` used `.replace('\'','')` — a string argument,
> so it stripped only the *first* apostrophe — while `index.js` used `.replace(/'/g,'')` and
> stripped all of them.
>
> `slugify()` survives in [index.js](backend/index.js) only to name the directory the GBIF
> downloader writes into, and it is a **mirror of the generated column, including the `<>`
> doubt marker**. If you change one, change both. Order matters: strip `<>` before spaces.

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

Database `herbblender`. Live counts: teas **63**, plants **57**, effects **33**, taxon **163**.

The authoritative schema is **[study/schema.sql](study/schema.sql)**, annotated clause by
clause in `study/DATA_MODEL.md`. This section describes only how that schema reaches the wire.

### Stored shape → API field

Left column is the Postgres source; right is what the API emits. Note that `genus`, `species`
and `family` are **not columns** on `tea` or `plant` — they are recovered by walking the
`taxon` adjacency list.

**`teas`** — 13 fields live; `normTea` exposes 12.

| Postgres | API | Notes |
|---|---|---|
| `tea.tea_id` | `ID` | `::text`, so the wire format stays a string |
| `tea.name` | `NAME` | also the source of the `image_slug` generated column |
| `tea.description` | `DESCRIPTION` | |
| `taxon` walk (3 self-joins) | `GENUS`, `SPECIES`, `FAMILY` | derived, not stored |
| `tea.oxidation`, `.fermentation` | `OXIDATION`, `FERMENTATION` | `NULL` → `''` on the wire |
| `effect_claim` → `effect.name` | `EFFECT_NAMES` | via `LEFT JOIN LATERAL` |
| `tea_compound` → `compound.name` | `ALKALOIDS` | lateral, filtered to `compound_type = 'alkaloid'` |
| `tea.image_slug` → disk | `IMAGE_PATH`, `IMAGE_PATHS` | from the startup image index |
| `tea_compound` (other three types) | ⚠️ **not exposed** | 104 of 123 rows; see §5 |
| `tea_compound.mg_per_gram` | ⚠️ **not exposed** | no API surface yet |

**`plants`** (called "herbs" in the API) — 15 fields live; `normPlant` exposes 12.

| Postgres | API |
|---|---|
| `plant.name`, `.description` | `NAME`, `DESCRIPTION` (`NULL` → `''`) |
| `taxon` walk | `GENUS`, `SPECIES`, `FAMILY` |
| `plant.other_names[]`, `.native_range[]` | `OTHER_NAMES`, `NATIVE_RANGE` |
| `plant.common_names[]`, `.current_range[]` | `COMMON_NAMES`, `CURRENT_RANGE` |
| species `taxon.gbif_usage_key` | `GBIF_USAGE_KEY` (`0` → `null`, a preserved quirk) |
| `taxon` walk, all 7 ranks | `TAXONOMY` — **rebuilt, not stored** |
| `plant.image_slug` → disk | `IMAGE_PATH` |

`TAXONOMY` being derived has two expected consequences, both recorded in
`study/golden/EXPECTED_DIFFS.md`: Cinnamon gains a lineage it never had, and Damiana and Black
Elder stop contradicting their own `FAMILY` — the old document carried both the authored family
and GBIF's disagreeing one and exposed both. All 57 plants carry a `gbif_usage_key` except
**Cinnamon** (*Cinnamomum cassia*), which has no species-level record in the GBIF Backbone.

> ⚠️ `updateHerb` accepts `commonNames` and `currentRange`, but `PUT /api/herbs/:id` does not
> forward them, so those two branches are currently unreachable.

**`effect`** — `name`, `description`, and **`mood`**.

`mood` is `NOT NULL DEFAULT 'supportive'`, constrained to `calming` / `stimulating` /
`protective` / `supportive` / `caution`, and exposed as `MOOD`. It replaced `EFFECT_MOOD_MAP`,
the hand-maintained constant duplicated in `frontend/src/app/app.ts` and `teaBrowser/app.js`,
where an effect nobody remembered to add rendered as "supportive" in silence. Both frontends
keep their map only as a fallback. `caution` is legal but currently unused and has no chip
style of its own.

`QUALITY` is still emitted as `undefined` for wire-format parity. No effect ever had a quality
and there is no such column.

**`compound`** — the four Mongo collections are one table plus a `compound_type` FK. The API
flattens them into `/api/compounds` with a `TYPE` label, mapped explicitly in both directions
because the database says `other` and the wire format says `otherCompound`.

> `compound.psychoactivity` is an **FK into a lookup table** of `no` / `mild` / `yes` — not a
> boolean. The lookup exists because this domain is hand-authored and had already drifted
> (`yes`/`no` in two collections, plus `mild` in terpenes, plus `NULL`). The manager used to
> post `true`/`false` here; Mongo stored it, Postgres answers 23503.

### Relationship contracts — read this before authoring records

The migration's whole point: **the relationships are foreign keys now.** What used to be five
string contracts is down to one and a half, and the database refuses the failure modes the
other three used to allow silently.

**1. Tea → Plant is a foreign key.** `tea.plant_id` is `NOT NULL REFERENCES plant` with
`ON DELETE RESTRICT`. A tea cannot be orphaned, and deleting a plant that still has teas is
refused by the database rather than succeeding and leaving dangling rows.

> The genus+species string match survives in exactly one place: `resolvePlantId`, on **write**,
> because the manager's form still collects genus and species as free text. Unlike Mongo it
> cannot half-succeed — no match means no `plant_id`, and the insert is refused with a clear
> message. Retiring it is `taxonomy_lookup_feature`.

**2. `getTeasWithoutHerb` can only ever return `[]`.** It is kept because the manager still
calls the route, but the FK makes an orphan unrepresentable. The old version loaded all 57
plants and all 63 teas and ran a nested `filter`/`some`, O(n·m), hunting for corruption the
schema now prevents. A foreign key does not only stop bad data — it deletes the code that
looks for it.

**3. Tea → Effect goes through `effect_claim`**, which holds `effect_id`, not a name.
`effect_claim.effect_id` is `ON DELETE RESTRICT`, so **an effect still claimed by any tea or
compound cannot be deleted** — the rename/delete hazard the name-matching design could not
defend against. The claim is an exclusive arc: it is about a tea *or* a compound, never both,
and it carries an optional `source_id` and a `confidence`. The manager writes only *unsourced*
claims; a claim backed by a source is evidence, not an editable field.

> `effect_claim`'s uniqueness is enforced by **four partial unique indexes**, not one
> constraint, because `NULL <> NULL` means a plain `UNIQUE` cannot constrain the null side —
> and most claims are unsourced, so the null side is the common case. Any `ON CONFLICT`
> targeting one of them must restate its **whole** predicate: arbiter inference asks whether
> your `WHERE` *implies* the index's, so `WHERE source_id IS NULL` alone matches nothing and
> raises 42P10.

**4. Effect name → mood class is no longer a string contract.** `effect.mood` comes over the
API as `MOOD`. `EFFECT_MOOD_MAP` survives in `app.ts` and `teaBrowser/app.js` only as a
fallback for a backend that does not send it.

**5. Images are still matched on a name slug** — the one string contract left, and the reason
it is safe is that `image_slug` is a **generated column**, so the writer and the reader share
one definition. **Renaming a tea or plant still orphans its images**, silently: the column
updates, the directory does not. `addHerb` pre-creates the directory from the slug the database
returned; `addTea` does not.

### Adding a new tea, end to end

1. The plant must exist first — `tea.plant_id` is NOT NULL, so there is no "add it later".
2. `POST /api/teas` with `name`, `description`, `genus`, `species`, `oxidation`,
   `fermentation`. `genus`+`species` must resolve to exactly one plant through the taxon tree
   or the insert is refused. `family` is still accepted and ignored; it is derived now.
3. Link effects with `POST /api/teas/:id/effects` — the effect must already exist by name, and
   you get an error rather than silence if it does not.
4. No `EFFECT_MOOD_MAP` step any more. A new effect's mood is a column; set it in the manager.
5. Create `backend/images/teas/<slug>/` and add images (or run
   `POST /api/gbif/fetch-images`). Run `shrink_images.py` afterwards. The slug is
   `tea.image_slug` — read it from the database rather than recomputing it.
6. If you added a column, add it to the matching `norm*` function in `dal.js` or nothing will
   see it.

### Bulk authoring

Bulk edits are hand-run **`psql`** scripts, the Postgres counterpart of the old `data/`
mongosh files. The migration itself is the worked example: `study/schema.sql` builds the
schema, `study/stage_load.sql` loads the JSON dump into a `stage` schema, and
`study/migrate.sql` moves it into the real tables.

Two habits from those files are worth copying:

- **Wrap the whole thing in one transaction with `\set ON_ERROR_STOP on`.** Postgres has
  transactional DDL, so a failure anywhere rolls back every statement — which is what makes
  `schema.sql` safe to re-run despite opening with `DROP SCHEMA`.
- **Key updates on a natural key, not an id**, and write only rows whose value would actually
  change, so a second run reports zero.

The Mongo-era scripts under `backend/migrations/` are archived in `mongo-archive/` and must not
be run — they call `db().collection(...)`, which is now a `TypeError`. There is still no
migration runner; schema changes are hand-applied SQL, numbered by convention.

### Seeded plant data

The plant data has a **committed, re-runnable** source of truth under
[backend/seed/](backend/seed/). It predates the Postgres migration and fed the Mongo dump that
`stage_load.sql` loaded, so it is now the *upstream* of the migration rather than something
that writes to the live database:

| File | Role |
|---|---|
| `plants.json` | Hand-authored: name, genus, species, family, otherNames, nativeRange, description |
| `fetch_gbif.js` | Resolves every binomial against the GBIF Backbone → `plants.gbif.json` |
| `plants.gbif.json` | Generated: usage key, taxonomy, English vernaculars, IUCN category |
| `../migrations/mongo-archive/002_backfill_plants.js` | **Archived.** Merged the two and upserted into Mongo on `{genus, species}`. Do not run. |

```bash
node backend/seed/fetch_gbif.js            # optional, slow, hits the network; writes a file only
```

`fetch_gbif.js` is still live and side-effect free apart from its output file. The importer
that consumed it is archived; re-importing into Postgres needs a new loader that resolves the
binomial through the `taxon` tree rather than matching strings. Its two rules below are the
part worth carrying over.

The importer wrote **only fields whose value would actually change**, and treated an empty
`description` as "not authored yet" rather than "set to empty". So descriptions can be filled
in a few at a time and the importer re-run freely — a no-op run reports `unchanged 57`.

Two rules in the importer existed to protect the string joins, and both have a live cause that
still applies — `taxon` now records GBIF's disagreement rather than letting it overwrite:

- **`family` always comes from `plants.json`, never GBIF.** GBIF puts *Sambucus nigra* in
  Viburnaceae and *Turnera diffusa* in Turneraceae, but the teas say Adoxaceae and
  Passifloraceae. Taking GBIF's family would have orphaned those teas. Under the new schema the
  authored family is the one in the `taxon` tree, and `TAXONOMY` is derived from it — which is
  why those plants no longer contradict their own `FAMILY` on the wire.
- **`gbifUsageKey` is only written for a species-level match.** *Cinnamomum cassia* has no
  species record in the backbone, so the match degrades to `HIGHERRANK` and GBIF returns the
  key for the *genus*. Storing that would be silently wrong, so it is left `null`.
  `taxon.gbif_usage_key` is `UNIQUE`, so the database would now also refuse to let two taxa
  share one key.

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
- The database is now LAN Postgres on `192.168.1.227:40021`, not Atlas, so the
  `dns: 1.1.1.1 / 8.8.8.8` pin that worked around the host's unroutable IPv6 nameserver is no
  longer needed for this stack — there is no SRV lookup any more.
- Production has no `.env` files: `DB_PASSWORD` must come from `wtb.env` via `${VAR}`
  interpolation, and the change has to land in **both** compose files.
- **Consider omitting `ADMIN_DB_PASSWORD` in production.** Without it the admin pool is never
  created and the deployment is structurally read-only; the manager is local-only anyway.

---

## 7. Known sharp edges

Recorded, not fixed.

**Security / correctness**
- No auth, CORS, input validation or rate limiting anywhere. Safe *only* because everything is
  proxied same-origin. Every write endpoint is open.
- Ids are validated by a single `app.param('id', …)` guard: every id is a bigint now, and a
  non-numeric one returns **404** rather than letting Postgres raise 22P02 into a 500. `/api/blend`
  validates its `ids` list the same way.
- `err.message` is returned verbatim to clients on every 500.
- `POST /api/gbif/fetch-images` flows a request-body `name` into a filesystem path via `slugify`
  with no traversal check.
- `teaBrowser/server.js:62-64` builds `path.join(STATIC_DIR, url)` from the raw request path with
  no normalization or containment check.
- Every multi-table write runs in a transaction via `inTransaction`; a compound changing type
  is now one `UPDATE` rather than a cross-collection delete-then-insert.

**Performance**
- The image tree is indexed once at startup, so the per-row `readdirSync` is gone. The index is
  only refreshed by `refreshImages()`, so images added to the filesystem **outside the app**
  are invisible until restart.
- `getCompounds` sorts in JS rather than SQL, deliberately, to preserve the old `localeCompare`
  ordering.

**Deployment**
- **No volume is mounted for `backend/images/`**, so GBIF-fetched images are lost on container
  recreate.
- Backend container runs as root; no healthchecks on any service.

**Housekeeping**
- `frontend/src/app/app.spec.ts:21` still asserts the scaffold's `'Hello, frontend'` against a
  template that renders `Tea Blender`, and `TestBed` has no `provideHttpClient` for the
  `ngOnInit` call — **`npm test` fails.** It's the only spec; runner is Vitest.
- No ESLint anywhere. `.prettierrc` exists but no script runs it and the source doesn't conform.
- `frontend/src/index.html` still has `<title>Frontend</title>`.
- `@angular/forms` and `@angular/router` are installed but unused; `app.ts:49` `slots` is dead.
- `frontend/dist/` and `frontend/.angular/cache/` are present in the tree.
- `Requirements.md` describes the original OracleDB design with a `tea.herb_id` FK. Kept as a
  historical spec — though the Postgres schema has brought the design most of the way back to
  it, so it reads closer to current than it has in two years. `start-backend.sh` still exports
  an Oracle `LD_LIBRARY_PATH` that does nothing.
