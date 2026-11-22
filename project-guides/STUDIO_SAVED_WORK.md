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

Saved-query names must be unique across folders (case-insensitive, ignoring surrounding spaces). Existing duplicate names can be retained when updating older documents, but new collisions are rejected.

Each query has `id`, `name`, `sql` (the source code, even for Python/R),
`lang` (`sql`, `python`, or `r`; omitted means SQL), `view` (`table` or `chart`),
and `chart` (configuration object or null). Prefer SELECT statements for SQL analyses.
Save retains the current chart settings and selected output view. Open editor drafts also retain chart settings across reloads; rerun the query to populate the chart. Temporary scatterplot zoom/pan and hover are not saved.
A chart references output column names, not SQL expressions. A basic configuration
is `{"type":"bar","x":"category","y":["amount"],"series":""}`.
Use `bar` or `line` for ordinary charts; `stacked` and `percent` are also supported. SQL must return suitable
categorical/temporal x and numeric y values. Begin with table view if uncertain.

For line, bar, stacked, and percent charts, `seriesLegend` accepts `inline`,
`list`, or `strip`; omit it for Auto. Auto uses a labeled legend for one to eight
ordinary series, a searchable list for more, and a color strip for multiple
recognized date cohorts. `seriesKind` (`series` or `cohorts`, omitted for Auto)
overrides that interpretation. A single series uses a compact name/color marker.
Existing explicit legend choices remain unchanged.

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
remote query; never silently change it to local. Current project connection files
contain links to the Mac-local catalog, plus provider and display labels. Older
project files with provider-specific settings migrate when opened in Studio.
Authentication uses local Google profiles/ADC, Keychain, libpq profiles or
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

Scatterplots use `{"type":"scatter","x":"height","y":["diameter"],"size":"weight","shape":"species","color":"age"}`.
X and Y are numeric (one Y field); each result row remains a point, without aggregation.
Size is an optional nonnegative numeric field, shape is categorical, and color uses
categories for text or a continuous scale for numbers. Omit size/shape/color for
uniform points. Missing/nonfinite axes or missing/negative sizes are skipped and
counted on the chart. These configurations work in saved queries, notebook outputs,
and dashboard tiles; charts use the result rows loaded by their parent analysis.

Scatterplot `brightness` optionally names a numeric column. Higher values produce
lighter fills while retaining the color hue and shape; lower values are darker.
The scale uses the plotted rows. Constant or missing values use medium lightness.
Brightness changes actual fill lightness, not transparency, and is included in PNGs.

Scatterplot `label` optionally names a column for point identification. Tooltips
and hover details always include the original result row number. Collapsed chart
settings and hover selection are temporary UI state, not saved data.

Large scatterplots accept up to 500,000 loaded points. More than 5,000 points use Canvas, and point inspection is enabled only when at most 5,000 points are visible. Zoom and pan stay available. Color, size and brightness scales remain tied to the full loaded result. This does not increase remote query preview limits or fetch more rows; transfer the full result to DuckDB explicitly when needed.

Time chart `grain` also accepts `hour`, `minute`, `second`, and `millisecond` via the clock menu. Bucketing and labels use UTC, with millisecond precision at the finest setting. The grain choice is saved with the chart. Zoom and pan are temporary. Magnifier mode offers Time only (default), Value only and Both axes; Reset restores both original ranges.

Scatter appearance is saved in optional `chart.scatterStyle`: `size` (area multiplier 0.25–4, default 1), `opacity` (0.05–1; default .75, or 1 when brightness is mapped), `outline` (boolean), `grid` and `legend` (default true), and `color` (six-digit hex, used when no color field is mapped). Appearance applies to SVG, Canvas, and PNG export. Point size scales mapped symbol areas without changing data; Reset appearance clears these overrides while preserving field mappings and titles.

Scatter category overrides are stored in `chart.categoryStyles`, keyed by channel (`color` or `shape`), source column name, and category label. Color values are six-digit hex; shapes are circle, square, diamond, cross, triangle-up/down/left/right. Category editors are searchable and show at most 40 matching entries at once. Numeric color continues to use its continuous scale.

`chart.scatterRules.size` and `.brightness` contain `field`, optional `inputMin`/`inputMax`, `outputMin`/`outputMax`, and `reverse`. They apply only when their field matches the current channel. Blank inputs use the full loaded result's range (size starts at zero). Size output is symbol area in px² (0–4000), multiplied by the overall Point size control; brightness output is HSL lightness percent (0–100). Ranges are linear and clamped. A constant brightness input maps to the output midpoint; missing brightness remains 50%. These are display mappings, not data transformations or conditional threshold rules.

Scatterplot `chart.scatterStyle.legends` optionally stores individual `color`, `shape`, `size`, and `brightness` visibility booleans. Omitted entries are visible; the existing `scatterStyle.legend: false` hides all legends while preserving individual choices.

Line charts may set `chart.showAllSeries: true` to retain every series instead of folding smaller series into Other. Regular and percent stacked bars retain all series by default; `showAllSeries: false` explicitly groups smaller series. Their cohort strip uses `stripColors` and changes emphasis only, never stack totals. The point limit still applies; palette colors may repeat.

For line charts with more than eight series, `chart.seriesLegend` selects `"strip"` (default, sequential cohort colors and sparse labels) or `"list"` (searchable list). Strip selections are transient highlights: they do not filter rows or rescale axes.

Line-chart interaction settings are independent: `seriesLegend` accepts `inline`, `list`, or `strip`; `hoverBehavior` accepts `all` or `selected`. Omitted/`auto` values choose inline/all through eight displayed series and strip/selected above eight. Explicit settings override the count and are saved with the query/notebook chart. Runtime selections remain transient.

`chart.stripColors` customizes the cohort strip and matching lines: `palette` is
`default`, `viridis`, `blue`, `blue-orange`, or `custom`; custom endpoints are
hex `start` / `end` colors, and `reverse` flips the range. This is chart-local.
`chart.lineTooltip` applies to **Compare selected series**: `show`, `labels`,
`dots`, and `guide` toggle hover elements; `position` is `cursor` or `corner`;
`decimals` is null (chart format) or 0–6; `prefix`, `suffix`, `title`, and
`valueLabel` are plain text. `seriesLabels` maps original series names to display
labels. `fields` contains up to 12 `{column, label}` entries from result columns.
Extra fields describe source rows in the plotted bucket: a consistent value is
shown, mixed values (including mixed null/non-null) say “Multiple values,” and
missing observations remain explicit. These fields are not SQL expressions or HTML.

`chart.seriesKind` sets series meaning on line and stacked charts: `"series"`, `"cohorts"`, or `"auto"` (also the default when omitted). Auto recognizes date-based series names as cohorts. Series mode hides calendar selection grouping; Cohorts mode uses cohort terminology but calendar grouping still requires valid date/month names. This does not combine or change result rows.

Stacked bar and percent charts support `chart.stackHover` (`"selected"`, default, or `"segment"`) and `chart.stackTooltip`: `show`, `labels` (combined percentage label), `position` (`"cursor"` or `"corner"`), `title`, `valueLabel`, `decimals` (null or 0–6), `prefix`, and `suffix`. These affect display only; selected summaries always use the full bar denominator. No selection falls back to a segment tooltip. Pan/zoom is transient and does not change chart rows or normalization.

Notebook data cells may optionally store `codeHeight` and `outputHeight` in pixels
(80–1600). These are independent notebook editor dimensions, not chart data or
presentation-slide layout. Omit a field for automatic/default sizing. Code height
applies to SQL, Python and R editors; output height applies to tables and charts.
The resize handle's double-click/Home action removes the corresponding field.

### External connection links

External databases are configured in **Connections** in the Mac project manager,
then added to each project. Format 2 of `.studio/connections.json` contains links
(`id`, `connectionId`, `name`, `provider`, and optional `preset`), not host/account
settings or credential values. Do not invent or replace these IDs when generating
analyses. Saved queries and notebook cells refer to the project-local `id`.

On another Mac, these links may be unavailable. Use **Reconnect** to choose a
connection explicitly before running remote SQL. Removing a link from a project
does not delete the connection, remote data, or saved analyses. SQL model definitions
and their history remain part of the project.

Scatterplot X supports text categories automatically. `xType` is `auto` (default), `numeric`, or `category` (including numeric codes). `categoryOrder` is `source` (default) or `alphabetical`. `jitter` is horizontal spread in category units (0–0.4, default 0.2). Spread is deterministic per result row and visual only; tooltips preserve category names. Missing X/Y values are skipped. Category positions are equally spaced and zoom/pan retain labeled category ticks. These options persist with the chart.

Categorical scatter `pointLayout` is `jitter` (default) or `beeswarm`. Beeswarm packs uniform circles in screen space without changing Y; resize is settled before repacking. Mapped size/shape or more than 5,000 points uses jitter instead with a notice. Dense groups retain all points and may overlap when the category runs out of space. Export uses the same packing.

Categorical scatterplots also accept `boxOverlay: true`, `boxPoints: "all" | "outliers" | "none"`
(default all), and `boxCounts: false` to hide sample counts. `categoryOrder` additionally
accepts `medianAsc` and `medianDesc`. Summaries use finite plotted observations from the
full loaded result, linear-interpolated quartiles, and observed whiskers within 1.5 IQR;
zooming and hiding ordinary points do not recompute them. These are not whole-source
statistics when the query result is a limited preview.

`chart.boxStatistics` optionally contains `boxLow`/`boxHigh` (percentiles, default
25/75), `center` (`median` or `mean`), `whiskers` (`iqr`, `range`, or `percentile`),
and `whiskerLow`/`whiskerHigh` (default 5/95). The `iqr` mode uses observed endpoints
within 1.5 times the chosen box span; with custom box bounds the UI calls this
“1.5× box range.” Percentile whiskers use interpolated quantiles and expand to
contain the box bounds if necessary. Outliers follow the chosen whisker bounds.
Median sorting always uses the median, regardless of the center-line choice.

Categorical scatter `violinOverlay: true` adds a smoothed Gaussian density shape
per category; it can combine with `boxOverlay`. Existing `boxPoints` and `boxCounts`
apply to either overlay. Density uses all loaded plotted observations, a bounded
128-bin approximation, and an automatic robust bandwidth. Shapes stop at observed
min/max and have equal maximum widths (width does not encode sample count). Groups
with fewer than three values or no variation show a small range mark instead of
an invented density. Zoom does not recompute the distribution.

### Direct Postgres connections

Postgres connections can store a host, port, database and username plus a Keychain
credential reference in the central Mac connection registry. Password values never
enter project files. Existing service profiles remain supported under Advanced.
Verified TLS is required: a public CA may need no extra file; private CAs require
a certificate selected in setup. Studio can create its own optional SSH tunnel using the SSH host, port, username
and private-key path. An optional Keychain reference supplies an encrypted key’s
passphrase. The native app confirms the server fingerprint on first use and
blocks changed keys. Private-key contents and passphrase values are never stored
in the project. Database TLS remains verified through the tunnel.

## Calculator scratchpad

The optional top-level `calculator` object is project-owned scratch work (version 1):
`expression` (arithmetic with `$1` snapshot references), `snapshots` (records with `id`, numeric `value`, `label`, `detail`, and ISO `time`), and `history`
(up to 30 records with `expression`, numeric `result`, and `time`). Preserve it when
editing other saved work. It uses the same file revision/writer protection as analyses.
Snapshots never refresh with source data. Percentages are fractional values (25% =
0.25). Selection totals apply only to explicitly selected visible cells, not the
full database result. Calculator arithmetic uses JavaScript numbers, not arbitrary
precision accounting arithmetic; unsafe integer inputs are skipped.

Calculator `inputDecimals` and `resultDecimals` optionally control display rounding (0–8 decimal places; null means Auto). Stored values, arithmetic and history retain full precision.

Calculator snapshots have no 100-record lifetime cap. Individual-value insertion is limited to 100 values per action. Updating an active aggregate reuses its snapshot only while it appears once in the current expression and is not referenced by history; otherwise it creates a new snapshot. Existing saved values and history are preserved.

Typing or editing the calculation, inserting an operator, or moving the caret ends the active selection. Later chart selections create a new operand and cannot update the earlier selection’s snapshot.

### Table copy format

The optional top-level `table_copy_format` in `saved_queries.json` is `standard`
(default, including unknown values), `sql`, or `sql-distinct`. It is saved through the normal
project revision checks. It controls Cmd/Ctrl+C for selected result-table cells,
including notebook outputs; editor text and explicit Copy TSV/CSV exports are
unchanged. SQL values use raw cell values, preserve displayed row order and
repeats, double embedded single quotes, and leave typed numbers unquoted.
One column becomes a comma-separated list; multiple columns become row tuples.
For disjoint selections, unselected positions within selected rows/columns become
NULL placeholders. Dates are quoted strings, booleans TRUE/FALSE, and nulls NULL.

`sql-distinct` uses SQL formatting but removes duplicate rendered values (one
column) or complete tuples (multiple columns), retaining first appearance. NULL
appears once; numeric and quoted text literals remain distinct.

The optional `copy_include_headers` boolean defaults to true and controls column
names in table selections, explicit Copy TSV, and copies from column inspection.
SQL modes prepend quoted names as the first row (or first value for one column),
separate from data deduplication. CSV exports retain headers.

Copying selected cells and whole rows/columns preserves the same underlying
numeric precision. SQL values retain booleans as TRUE/FALSE, format dates and
decimals using their column types, and quote text (including numeric-looking text).
Column selections cover filtered loaded rows across pages. The footer identifies
this scope; remote selections are labeled “Loaded preview only” and never fetch
additional rows. Use Save full output for the complete remote query result.
