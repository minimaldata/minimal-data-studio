# Interactive documents — local prototype

In **Analyses → Interactive documents**, click **+** to create a sample.
Click the document to open its preview, adjust Scenario A and B, and click **Run scenarios**.
**Save document** keeps the source, input snapshot, assumptions, and results in
this project. Click the saved document to reopen its interface with saved controls and results.
The document list loads without executing apps; clicking an app starts its JavaScript.

**Edit** exposes HTML, CSS, JavaScript and named JSON inputs. This example expects
`baseline` to contain an array whose first row has a numeric `revenue` value.
You can enter JSON or run `SELECT 250000 AS revenue` in a query tab, return to the
document, and click **Use last query result as baseline**. This explicitly copies
the current result, including any remote preview limit; it is not a live query.

```javascript
const rows = studio.inputs.baseline;
const assumptions = studio.state;
// Render your interface using ordinary browser APIs.
// Stage JSON state for the host's Save document action:
studio.saveState({growth: 0.15, result: rows[0].revenue * 1.15});
```

Only named input data and document state enter the isolated preview. External
libraries, network fetches, database calls and credentials are not available.
Use reviewed code: this prototype is not a general untrusted-code service.
**Stop preview** destroys the frame. Navigating away also stops it; click the app again to resume from its staged state. Script errors appear above the preview.

Save conflicts keep local edits intact. Copy your code before reloading after a
conflict. Documents have a 4 MB combined storage limit, including saved inputs
and results. Their JSON lives in `.studio/interactive-documents.json` with backups
in `.studio/interactive-backups`. No existing notebook or query files are changed.

## Inspect app files

Use the folder icon beside an app name to **Show files**. Expand **Files** and any
subfolders, then click a source file. It opens a read-only tab; **Open app** returns
to the app. Inspecting HTML or JavaScript never executes it. Existing embedded
prototype documents list their HTML/CSS/JavaScript as **saved source**, rather than
pretending these are disk files.

Agent-authored apps can live in a project folder. Expand **Open app folder…** in
Interactive documents, enter its project-relative path, and open it. Save document
to retain the association, inputs and scenarios. For example:

```text
interactive/revenue-simulator/
  app.json
  index.html
  styles.css
  components/
    simulation.js
```

```json
{
  "format": 1,
  "name": "Revenue simulator",
  "entry": "index.html",
  "styles": ["styles.css"],
  "scripts": ["components/simulation.js"]
}
```

This first folder version uses an HTML fragment, local styles and classic scripts
listed in manifest order. List dependencies in `styles`/`scripts`; relative `<script
src>`/`<link>` tags and ES module imports are not resolved yet. Nested source files
are supported, but this is not a general web bundler. Source inspection supports
UTF-8 HTML, CSS, JS/MJS, JSON, Markdown, text and SVG, up to 100 files / 2 MB.
Hidden/private paths, dependencies folders and symlinks are excluded or rejected.

**Reload app** reads the latest folder source. Saving scenario state never
writes any source file. The project state stores the folder reference, inputs and
state separately. File previews are snapshots; use Show files again to reread
agent edits. Clicking an app opens its preview; inspecting a file never executes it.

Use **⛶** to enter fullscreen without restarting the app. **Exit fullscreen** or
**Esc** returns to Studio. If browser fullscreen is unavailable, the app fills the
workspace window instead. Assumptions and results remain intact during the toggle.

## Named data bindings

Open **Data inputs** (or **Edit** for an embedded document). Enter an input name,
choose a local table, view or saved SQL query, and click **Add input**. **Refresh
inputs** loads all bindings in one read-only DuckDB transaction. **Save document**
keeps both bindings and snapshots. Opening or reloading an app never refreshes data.
The panel shows each source, complete row count and refresh time.

Only local saved SQL SELECT queries are supported initially. Missing/deleted sources,
remote queries, duplicate column names, more than 10,000 rows per input or over 1 MB
combined fail visibly without replacing previous inputs. Filter/aggregate large
sources in a saved query. Dates use ISO strings; decimals and large integers use
strings to preserve precision. Apps choose explicit conversion for computation.

`studio.context` supplies `codeHash`, `inputsHash`, and `inputMetadata` (source,
row count, refresh time, content hash, SQL hash and column types). Scenario apps
should capture the hashes with results and mark old results outdated when code,
inputs or assumptions change. Studio keeps state; the app decides when to recompute.

The bundled `examples/interactive/mdm-revenue-simulator` demonstrates named
scenarios, duplication, comparison and saved latest results. Bind `history` to
`saas_subscription_kpis`. Results are projections of monthly recurring revenue,
not actual revenue recognition or a fitted prediction. Save document after running
scenarios. Each scenario retains its latest result; a full run archive is not yet
implemented.

### Declared input contracts

Folder apps can declare `inputs` in format-1 `app.json`:

```json
"inputs": {
  "history": {
    "label": "Historical recurring revenue",
    "required": true,
    "columns": {"month_end": "date", "mrr_usd": "number"}
  }
}
```

The key is the JavaScript name (`studio.inputs.history`); the label is shown in
Data inputs. Users select the declared input and connect a local source, rather
than inventing a variable name. Existing bindings remain valid. Apps without
input declarations retain the manual named-input interface.

Refresh reads the current manifest on the server and checks required bindings and
result-column types before applying any snapshot. Extra columns are allowed;
column names are exact and case-sensitive. `date` accepts DATE and TIMESTAMP,
`number` accepts integer, floating and decimal types, `string` accepts VARCHAR,
and `boolean` accepts BOOLEAN. Empty results still have their schema checked.
There is no implicit casting, column mapping, or null-value constraint. Use a saved
SQL query to alias/cast source columns. Failures retain the previous snapshot and
scenario state. These are refresh-time contracts, not a database permission boundary.

### SQL files supplied by an app

An input declaration may include `"sql": "queries/history.sql"`. The path is
relative to the app folder and must identify a readable `.sql` file within that
folder. The same private-path, symlink, file size and folder limits apply.

Studio automatically lists these inputs in Data inputs with Inspect SQL and
Refresh inputs. Inspect expands an inline SQL editor beneath the input row; Hide SQL collapses it. Refresh executes
one local SELECT per input in the shared read-only snapshot transaction, checks
the declared columns, and retains the existing row/byte limits. Nothing is run
on app open. SQL files do not receive credentials or arbitrary JavaScript queries;
parameter substitution and remote queries are not supported in this first slice.

A manifest SQL source takes precedence over a manual binding with the same name,
without deleting the stored binding or saved scenario state. Remove the `sql`
declaration to return to manual source selection. Refreshed metadata records
`kind: app-sql`, the relative file path and the SQL hash. Source files remain
agent-owned; saving a document only saves its snapshots and state.


Inline SQL edits are drafts until Save SQL (file only) or Save & refresh (file,
then all input snapshots). Saving requires the project writer and compares the
original source with disk; a conflict preserves the draft. Previous source is
copied to `.studio/sql-source-backups` before atomic replacement. Unsaved drafts
survive collapse and in-app navigation but are not persisted across page reloads.
Save document does not save SQL drafts; it saves the app state and input snapshot.

The Query results section shows the last successful snapshot, with a timestamp,
row count, and the first 100 rows. A failed query keeps the previous snapshot.
Saving SQL alone does not execute it or update those results. The read-only
SELECT and schema checks run at refresh time, so incomplete SQL can be saved.

Run SQL executes the current editor text as a bounded read-only preview, without
saving the file or replacing app inputs. SQL preview results are separate from
the App input snapshot. Save & refresh saves the file and replaces inputs only
on successful validation. Reload app and rerun scenarios to compute new results.


### Save app results as a table

`studio.saveResultsAsTable({suggestedName, description, columns, rows})` proposes a
result snapshot to Studio. Columns are `{name, type}` entries using string,
number, date, timestamp or boolean. The host shows a name/row-count/column
confirmation dialog; a frame message alone never creates a table. Only the
project writer can confirm. The server checks sizes, types and identifiers,
creates in main schema in a transaction, and refuses existing tables or views
(case-insensitively). There is no replace/append mode. Limits: 50 columns,
10,000 rows and 1 MB of row JSON. Invalid inserts roll back the whole table.
Created tables remain ordinary project data when the document is removed.

The MDM example exports the selected scenario's last run, including its original
assumptions, baseline, run identity, input/code hashes and outdated-at-export flag.
Changing assumptions without rerunning does not relabel old values as new output.

## Draft recovery and input status

Unsaved document state and inline SQL drafts are checkpointed after a short idle
period in `.studio/interactive-recovery/draft.json`. This is separate from Save
document and Save SQL. The sidebar reports whether a checkpoint succeeded; do
not close a window with a failed checkpoint without saving or copying the work.
Reload/close warns when unsaved work remains. On reopen, Restore draft recovers
work against the same saved revision. If a newer document revision exists,
restoration is disabled; Download recovery retains inspectable JSON without
replacing newer work. Keep saved version explicitly discards that checkpoint.
Only the active writer can checkpoint, restore, or discard. Checkpoints stay in
the project across port changes and server restarts. They are not a complete
archive: there is one latest interactive-work checkpoint per project.

Input rows identify a current snapshot, unsaved SQL, saved SQL needing refresh,
or unapplied parameter changes. Failed refreshes retain prior snapshots. Only
the latest requested refresh can apply its response. Run SQL remains a preview;
Save document does not commit SQL drafts. Opening an app never triggers a query.

## Parameterized SQL inputs

A folder app can declare typed scalar parameters alongside its inputs:

```json
"parameters": {
  "start_date": {"type": "date", "label": "From", "default": "2025-01-01"},
  "customer": {"type": "string", "label": "Customer", "default": "Example"}
}
```

SQL files use DuckDB named parameters, for example:

```sql
SELECT * FROM customers
WHERE became_customer_at >= CAST($start_date AS DATE)
  AND customer_id = $customer
```

Studio binds values rather than interpolating SQL. Parameters cannot substitute
identifiers, table names, or SQL fragments. Types are string (up to 1,000
characters), finite number, ISO date, and boolean; each requires a valid default.
At most 20 are allowed. Unknown parameters and undeclared SQL placeholders fail.

Data inputs renders parameter controls and **Apply & refresh inputs**. Edits are
staged in the document and never run a query automatically. Save document retains
them, including unapplied changes. Snapshot metadata records the values actually
used, separately from pending values. Run SQL uses pending parameters for its
preview. All existing complete-snapshot limits and read-only checks still apply.

Apps read pending/default values from `studio.context.parameters` and may stage
changes with `studio.setInputParameters({start_date: '2026-01-01'})`. This only
changes the host's pending values; the user applies them in Data inputs. It is not
a general SQL or network API. App-local sliders and filters can still operate
entirely on the loaded snapshot. Parameterized remote queries and cancellation
are not part of this first implementation.

## Compatibility and bounded execution

Interactive apps remain a Preview feature. Folder manifests can declare
`apiVersion: 1` and `stateVersion: 1` (both default to 1). Unknown API versions do
not execute. If an app's state version differs from its document's saved version,
Studio keeps the state and offers Download app state instead of running the new
code against it. Missing or broken app source also leaves saved state downloadable
and does not prevent saving other documents. App diagnostics lists recent script
and preview errors with their app folder; these diagnostics are session-local.

Input queries now have a 30-second execution deadline for each refresh/preview,
with bounded waits for project and database locks. Progress displays elapsed time,
not a guessed completion percentage. Timeout errors retain the previous snapshot
and release the query connection. Interruption is cooperative; noncooperative
extension code is not guaranteed to stop instantly. This is not a general
untrusted-SQL service. A dedicated Cancel query button is still not provided.

See [the agent authoring guide](INTERACTIVE_APP_AUTHORING.md) and the self-contained
`examples/interactive/parameterized-review` starter.
