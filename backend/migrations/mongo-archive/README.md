# Mongo-era migrations (archived, do not run)

These three scripts were written against the MongoDB driver. They call
`db().collection(...)`, which since the Postgres migration is a `TypeError` on a
`pg.Pool` — so running one fails immediately rather than doing something half-correct.

They are kept because they document how the data reached the shape that
`study/stage_load.sql` later loaded, and `002_backfill_plants.js` in particular records
*why* `family` is taken from `plants.json` rather than from GBIF. That reasoning now
lives in the schema as the taxon tree, but the history explains the shape.

All three were applied to the Mongo database before the dump in `study/dump/` was taken,
so their effects are already present in Postgres. Nothing here needs re-running, and the
Postgres equivalents are `study/schema.sql`, `study/stage_load.sql` and
`study/migrate.sql`.
