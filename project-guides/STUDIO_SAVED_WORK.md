# Studio saved-work format (preview)

Read AGENTS.md first. This guide documents the current preview's saved-work format.
Studio does not watch the JSON for changes: reload the browser after an external
save to discover new items. Preserve unsaved editor code and wait for browser saves
before doing so. Opening a notebook runs its cells; opening a dashboard runs its
queries. Use read-only code for analyses.

## Document and identifiers

`saved_queries.json` is a UTF-8 JSON object. Its main arrays are `queries`,
`notebooks`, and `dashboards`. It can also contain `folders` and `series_colors`.
Preserve all existing keys, records and settings when merging. Generate unique
string IDs (UUIDs work) for queries, notebooks, cells, dashboards and tiles. Update
only IDs you intentionally own; never use an existing name as permission to replace
something. `name` is the display name. An optional `folder` field such as
`"Reports/Weekly"` assigns an item to a sidebar folder; slashes in `name` are
just displayed text. Top-level `folders` stores arrays under `queries`,
`notebooks`, and `dashboards`, including empty sidebar folders.
The server accepts saved-work payloads up to 5 MB. Do not embed result datasets.

### Saved queries

Each query has `id`, `name`, `sql` (the source code, even for Python/R),
`lang` (`sql`, `python`, or `r`; omitted means SQL), `view` (`table` or `chart`),
and `chart` (configuration object or null). Prefer SELECT statements for SQL analyses.
A chart references output column names, not SQL expressions. A basic configuration
is `{"type":"bar","x":"category","y":["amount"],"series":""}`.
Use `bar` or `line` for ordinary charts; `stacked` and `percent` are also supported. SQL must return suitable
categorical/temporal x and numeric y values. Begin with table view if uncertain.

### Notebooks

A notebook has `id`, `name`, and an ordered `cells` array.

- Text cell: `id`, `type: "text"`, `source` containing Markdown.
- Data cell: `id`, `type: "sql" | "python" | "r"`, `name`, `source`,
  `view: "table" | "chart"`, and `chart` object or null.
- Data-cell names must be unique, simple identifiers such as `species_summary`
  (letters, digits, underscores; start with a letter or underscore), and must not
  collide with persistent tables or views.
- SQL cells finish with a SELECT query. Studio materializes that result as a
  temporary table named after the cell. Later cells can query it by name. Do not
  write `CREATE TABLE` as the final statement. Prefer one read-only SELECT per cell.
- Python cells receive referenced table/cell results as pandas DataFrames; end with
  a DataFrame expression. R cells receive data.frames; end with a data.frame.
  Earlier cells must run first. Each Python/R execution uses a fresh process, so
  imports and ordinary local variables do not persist between cells. Reimport
  packages in each cell. SQL is DuckDB SQL, not SQLite/PostgreSQL.
- All languages start in this project folder. Relative file paths such as
  `data/measurements.csv` work. A table's name is not a file path.
- Optional filter cell: `id`, `type: "filter"`, `name`, `kind`, `value`.
  For a simple numeric filter use `kind: "number"`, `value: "5"`; refer to it in
  SQL as `{{minimum_height}}` (no surrounding quotes). Python/R get referenced
  filter names as variables. Copy more advanced filter configurations from an
  existing Studio-created notebook rather than guessing fields.

### Dashboards

A dashboard has `id`, `name`, `tiles`. Each tile has its own `id`, `query_id`
pointing to a saved query's ID, and integer grid coordinates `x`, `y`, `w`, `h`.
The grid is 24 columns wide: a full-width tile uses `x:0, w:24`. Start with `h:8`
and stack subsequent tiles at `y:8`, `y:16`, etc. The saved query supplies the chart
configuration. Do not put SQL directly into a dashboard tile.

## Runnable format example

This deliberately uses synthetic constants so it runs in an empty project. Replace
it with validated analyses of the real data. Merge entries into the existing arrays;
do not replace the whole file. Regenerate all IDs and cell names before reusing it.

```json
{
  "queries": [
    {
      "id": "guide-query-example",
      "name": "Format example / Category totals",
      "lang": "sql",
      "sql": "SELECT 'A' AS category, 10 AS amount UNION ALL SELECT 'B', 20;",
      "view": "chart",
      "chart": {"type": "bar", "x": "category", "y": ["amount"], "series": ""}
    }
  ],
  "notebooks": [
    {
      "id": "guide-notebook-example",
      "name": "Format example / Read this first",
      "cells": [
        {"id": "guide-intro", "type": "text", "source": "# Example analysis\n\nSynthetic data for demonstrating the format; not a finding about your data."},
        {"id": "guide-data", "type": "sql", "name": "guide_category_data", "source": "SELECT 'A' AS category, 10 AS amount UNION ALL SELECT 'B', 20", "view": "table", "chart": null},
        {"id": "guide-summary", "type": "sql", "name": "guide_category_summary", "source": "SELECT category, sum(amount) AS total FROM guide_category_data GROUP BY category ORDER BY category", "view": "chart", "chart": {"type": "bar", "x": "category", "y": ["total"], "series": ""}}
      ]
    }
  ],
  "dashboards": [
    {"id": "guide-dashboard-example", "name": "Format example / Overview", "tiles": [{"id": "guide-tile", "query_id": "guide-query-example", "x": 0, "y": 0, "w": 24, "h": 8}]}
  ]
}
```

## Reading data while Studio is running

Use the exact localhost URL of this project's running Studio window (ports are not
stable). Confirm `GET /project-health` returns `app: "minimal-data-studio"` and a
`project` hash matching `sha256(os.fsencode(str(Path(project_folder).resolve())))`.
Send `Origin: http://localhost:PORT` on all requests, with the same hostname and
port as the URL. Do not expose the server beyond loopback.

1. `POST /db/session` with `{}` returns a JSON object with `session`.
2. `POST /db/query?session=SESSION` with `{"sql":"SELECT ..."}` executes one SQL
   statement. The response is Arrow IPC stream bytes, not JSON. Decode with
   `pyarrow.ipc.open_stream(response_bytes).read_all()` (use a BufferReader if needed).
3. Inspect `information_schema.tables` (filter `table_schema = 'main'`) and
   `information_schema.columns` to learn actual names/types. Use SELECTs to inspect
   data. This API can execute writes too, so keep analysis requests read-only.
4. `POST /db/close?session=SESSION` with `{}` closes your own session. Do not close
   another session. Temporary tables are local to the session; persistent tables
   are shared with the browser.

These are local Studio endpoints, not a remote hosted API. Error responses may be
JSON or HTML: check HTTP status before decoding. If the app is stopped, an agent
with DuckDB installed may instead open `.studio/workspace.duckdb` read-only; close
that connection before reopening Studio. Do not delete database lock or WAL files.

## Writing saved work safely

### While Studio is running (preferred)

1. `GET /saved_queries.json`; retain its `X-Version` response header and parse JSON.
2. Merge your new entries into the existing arrays, retaining unrelated content.
3. `POST /saved_queries.json` with the complete merged document and headers:
   `Content-Type: application/json`, `Origin: http://localhost:PORT`,
   `X-Base-Version: <the X-Version you read>`.
4. Success is HTTP 204. Studio creates a backup and atomically replaces the file.
   A 409 means someone saved meanwhile: re-read, reconcile and retry. Never send
   `X-Force: 1`. Omit `X-Client` for independent agent writes so the stale-write
   shortcut used by browser tabs cannot bypass your version check.
5. Tell the user to reload and open the new item by name. Do not choose “overwrite”
   if an older browser tab reports a conflict; reload its saved work instead.

The saved-work endpoint does not need a database session. It only checks the basic
JSON envelope, not all notebook/chart fields: validation is the author's job.

### When Studio is stopped

Read and merge the existing JSON (use empty arrays only if no file exists). Copy the
original to a uniquely named backup first. Write a temporary UTF-8 JSON file in the
same directory, flush it, then atomically replace `saved_queries.json`. Do not write
while Studio or another agent is saving. Reopen the project's `.mdsproject` file.

## Validation before handing back

- Parse JSON; ensure IDs are unique and tile query references exist.
- Run SQL against the actual project data and verify result columns match charts.
- Validate notebook cells in order; earlier cell outputs must be available to later
  cells. Check package availability before choosing Python/R.
- Inspect the new notebook/query/dashboard in Studio when possible. Confirm charts,
  Markdown, ordering, and absence of unintended writes. Clearly state if only SQL
  and format checks were performed.
- Explain findings, assumptions, missing values and row exclusions in Markdown cells.
  Never present sample constants from this guide as real analysis.

These guides are added when a project is opened/created by the preview. Existing
copies are preserved so project-specific instructions are not overwritten.
