# Studio saved-work format (preview)

Read AGENTS.md first. This guide documents the current preview's saved-work format.
Studio does not watch the JSON for changes: reload the browser after an external
save to discover new items. Preserve unsaved editor code and wait for browser saves
before doing so. Opening a notebook restores its source without running cells; use Run all.
Opening a dashboard runs its queries. Use read-only code for analyses.

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

## Open workspace tabs

Optional `workspace_tabs` stores the open analysis tabs for this project:

```json
{"format":1,"analyses":[{"kind":"notebook","id":"notebook-id"},{"kind":"dashboard","id":"dashboard-id"}],"active":"notebook:notebook-id"}
```

`analyses` preserves tab order using saved document IDs, not names. `active` is
`notebook:<id>`, `dashboard:<id>`, or null to return to the query editor. Query tabs
and their selected index are stored separately in the project's editor state.
Missing/deleted document IDs and duplicate references are ignored on restore.
Closing an analysis tab removes its reference, never its saved document. Preserve
this field when editing saved work externally. Live outputs are not stored here.

## Assumption cells (local preview)

Assumption cells edit named values over time. Distribution choices, validation and
simulation belong to downstream code; the editor has no special distribution mode.

The `assumption` object uses `format: 1`, `valueSeries: true`, and `series`, an array
of `{id, name, color, valueColumn, points, monotonicity}`. IDs and case-insensitive
names must be unique. Names allow 1–64 characters; colors are six-digit hex strings.
There may be 1–24 series. Points are sparse `["YYYY-MM-DD", number]` controls;
intermediate periods use linear interpolation. Save values, never SVG geometry.

Timeline settings are shared: `grain` is `day`, `month` or `year`, and `horizon`
is 1–120 periods. `basis: "range"` uses `startDate` and includes that date as the
first period. All values are editable and marked `future`, even on past dates.
New range values start at zero. Monthly/yearly dates clamp to month end as needed;
a February 29 anchor returns to February 29 in later leap years.

`basis: "history"` (also the default for older cells) uses an earlier, successfully
run data cell named by `source`, with a shared `dateColumn`. Each series selects its
own numeric `valueColumn`. Use 2–1,000 unique dates and finite nonmissing numbers.
History stays fixed; `horizon` adds periods after the last observation. Refresh
promotes new actuals and retains remaining future controls by date.

`meanAxis` is the retained storage key for the shared value axis: `{min,max,snap}`.
Blank/null fields use Auto. Bounds include existing controls; snap is positive.
Automatic snapping uses `5 * 10^(floor(log10(max(abs(min),abs(max)))) - 2)`.
Range charts start at 0–100 and expand as needed. Exact entries bypass snapping.
Use separate cells for incompatible scales or units.

Per-series `monotonicity` is `none`, `ascending` (non-decreasing), or `descending`
(non-increasing). Equal values are allowed. The last actual anchors future edits;
earlier historical variation is exempt. Drag and ordinary click-add clamp to the
allowed limits. Exact entries and setting changes reject incompatible values.
Undo/redo cannot restore a shape that violates the current direction.

Run publishes a temporary table named after the cell, with only these columns:
- `series`: series name (VARCHAR).
- `date`: DATE.
- `value`: numeric value (DOUBLE).
- `segment`: `actual` or `future`.

Edits autosave and mark dependents stale; they do not execute downstream models.
Run the cell and its dependents to refresh. Outputs are session-local.

Legacy Normal cells convert on open to the original value series plus a uniquely
named `standard deviation` series. Both retain their controls and monotonicity.
A migrated deviation series uses `futureOnly: true` with historical timelines:
source dates supply the shared timeline, but no historical deviation values are
invented or output. `initialValue: 0` supplies an empty future-only curve. Legacy
mode/spread fields may remain for reading older formats but are not UI settings.
Code using the old `mean`, `sd`, or `distribution` output columns must select the
corresponding named series and its `value` column instead.

For a 100% stacked allocation, set `chartType: "percent"` on the assumption.
`percentSnap` is an optional positive percentage-point increment (default 1).
All series must cover the same dates and contain non-negative values. Each date
is normalized to 100%; zero-total history is rejected, while new all-zero future
periods start with equal shares. Future `series[].points` are saved as individual
percentages after editing. Output retains `series, date, value, segment`, with
`value` in percentage points (0–100), not fractions. Historical source data is
unchanged. Boundary edits transfer share between neighbors; allocation mode uses
fixed 0–100 bounds and does not apply per-series monotonicity.

Values over time and % of total are separate creation choices. Existing cells keep
their saved `chartType`; omitted `chartType` means values. There is no in-place
conversion control in the editor.
New percentage cells start in Date range mode with three monthly periods starting
on the current date and two named series at 50% each. This is a creation default;
existing saved allocations retain their series and values.

### Remote SQL queries (preview)

Saved SQL queries may include `connection`, an ID from `.studio/connections.json`.
Omit it or use an empty string for Local DuckDB. Preserve the ID when editing a
remote query; never silently change it to local. Connection metadata contains only
a provider and label plus provider-specific settings. Missing `provider` means
`bigquery` (project ID, location, byte limit). `postgres` uses a local `service`
profile name and `timeoutSeconds`; `snowflake` uses account/user/role/warehouse/
database and `timeoutSeconds`. Authentication uses local ADC, libpq profiles or
Snowflake browser SSO outside the project. Do not put tokens or
service-account keys in project files. Open remote queries in the SQL editor;
remote saved queries are not yet supported in dashboard tiles. Save an explicit
local snapshot to consume remote results in local analyses.

## BigQuery model drafts (preview)

Studio keeps SQL models in `.studio/bigquery-models.json`, separate from saved queries.
This is service-managed state: use the model UI rather than editing it while Studio
runs. Format 1 includes model UUID/revision, draft settings and SQL, published SQL
versions, and any pending warehouse job. Never edit published ownership identifiers,
etags or pending jobs to bypass a conflict. Model history contains SQL, not data.
Draft editor tabs may have `remoteModel` and string `modelRevision` metadata; restore
SQL in the UI and publish explicitly. Copying this file does not create independent
BigQuery objects, and deleting it does not remove warehouse objects.

BigQuery reference metadata (additive format 1): each model has an immutable
`reference` key. SQL may use `{{ reference_key }}` on that model's connection.
Draft `references` binds these keys to UUIDs; the service computes bindings and
compiled SQL. Publications additionally record `compiledSql` and `dependencies`.
Do not edit these fields to retarget dependencies. References use published outputs,
not arbitrary local files, secrets, or template expressions. Literal BigQuery
addresses are allowed but excluded from the managed dependency graph.


Snowflake authentication metadata (preview): `authentication` is `sso` by default or
`password_mfa`. The latter stores only `credentialId` (a native Keychain reference) and
`mfaMethod` (`push` or `passcode`). Never write passwords, MFA codes, tokens or credential
grants into the project. Native approval binds credentials to the saved destination;
copying a project does not transfer credential access.

Notebook SQL cells may store `connection` as a saved remote connection ID. Omit it or use an empty string for Local DuckDB. Remote cells execute one read-only query, then transfer its complete result to a session-local table named after the cell. Python/R and later local SQL cells consume that table. Remote SQL cannot directly reference local cells. Transfers exceeding 100,000 rows or 64 MB fail; display previews are never passed downstream. Changing the connection makes previous output stale.

BigQuery connection metadata may contain `authProfile`, an opaque ID of a Google
user profile stored only on this Mac. Never put OAuth tokens or credential files in the
project. Missing profile IDs must be reassigned in Studio connection settings; do not
silently remove the field or replace it with shared ADC. Notebook cells continue to
reference the connection ID, not an authentication profile directly.
