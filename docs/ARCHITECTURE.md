# Architecture

The browser is the interface. A local Python service owns the database and runs code.

| Component | Responsibility |
|---|---|
| `index.html` | Editor, file browser, tables, charts, dashboards, notebooks; no build step |
| `serve.py` | Loopback HTTP API, saved-work writes and backups, project setup, kernel launches |
| `workspace_db.py` | DuckDB connections, SQL execution, Arrow transport, legacy migration |
| `project_files.py` | Project-relative navigation and non-overwriting file copies |
| `kernels/` | Fresh Python/R processes that exchange dataframes and plots |
| `examples/` | Clean public starter queries, notebook and dashboard |
| `tests/` | Disposable database, HTTP, project-file and frontend-handler checks |

Each browser page gets a database connection, with its own temporary tables and transactions. Durable tables and views are shared in `project/.studio/workspace.duckdb`. The service serializes database API operations. Query results travel as Arrow IPC; Python/R exchange tabular data as Parquet.

Python/R processes start in the project directory and receive referenced tables as dataframes. Their temporary execution files live outside the project. Each run has fresh interpreter state.

Queries, notebooks, dashboard layouts, folders, and shared chart colors live in `project/saved_queries.json`. Writes use file versions, atomic replacement, and backups. Editor drafts now live in the project database. Query history and display preferences still use browser localStorage.

Project file copies and table imports are separate operations. The file browser resolves paths within the project, rejects outside symlinks and managed files, and copies incoming files without overwriting. Executed code is not sandboxed.

Legacy tables/views and the previous native database are migrated without deleting their originals. Successful imports are recorded so a deliberate DROP is not reversed by a later startup. The user guide covers migration and backups.

## Frontend boundaries

- `frontend/side-panels.mjs`: collapse, resize and help-section preferences; editor refresh is an injected callback.
- `frontend/editor-select.mjs`: anchored dropdowns shared by query tabs, materialization controls and notebook cells, including keyboard handling and popup cleanup.
- `frontend/database-folders.mjs`: pure folder move validation, tested through module imports rather than extracting HTML source.
- `frontend/api.mjs`: checked HTTP responses and per-page database session transport.
- `frontend/desktop.mjs`: optional native update link; ordinary browser fallback remains usable.
- `frontend/preferences.mjs`: disposable browser preferences and legacy browser-state reads.
- `frontend/editor-drafts.mjs`: serialized, revision-checked editor autosave and explicit conflict recovery. Transport and notifications are injectable.
- `index.html`: DOM and CodeMirror integration, feature orchestration. This remains a large file; move features incrementally with behavioral checks rather than a wholesale rewrite.
- `draft-editor.js` and `sql-completion.js`: CSV draft editing and SQL completion respectively.

## Editor draft contract

`GET /editor-drafts` returns `{revision, state}`. A new project has revision 0 and null state. `POST /editor-drafts` accepts `{revision, state}` and returns the new revision, or HTTP 409 when another window saved first. The server checks the entire payload before writing under the workspace lock.

State format 1 contains `tabs` and `active`. Each tab stores `name`, `sql` (the current code, regardless of language), `lang`, and `drafts` keyed by sql/python/r, with optional `savedId`, `orig`, `view`, and `chart` metadata. Preserve code whitespace exactly. Results, live kernel state, browser-only tabs and DOM state are not serialized. Limits: 200 editor tabs and 2 MB of persisted JSON.

Storage is `_studio.editor_state` in the project's DuckDB file. It follows project moves and server port changes. Autosave pauses on conflicts/errors; explicit recovery appends named recovered copies to the latest project state with another revision check. It never forcibly replaces another window's drafts. Legacy localStorage drafts require an explicit import because their project ownership is ambiguous. This is current draft recovery, not version history or a substitute for backups.

## Other service boundaries

`project_launcher.py` handles project discovery, lifecycle and the running-project registry. `runtime_setup.py`/`runtime_probe.py` handle runtime selection and checks. `excel_files.py` and `draft_data.py` handle format-specific parsing/validation. `packaging/macos/Launcher.swift` is the native project manager and updater integration; it should call service contracts rather than duplicate database logic.

Browser vs native window choice should not alter persistence or execution contracts. A future remote connector should own connection configuration, catalog discovery, query/cancel behavior and capability reporting; the local service should retain secrets and distinguish local snapshots from remote data. No remote connector is implemented by this maintenance pass.

## Native credentials (local preview)

`packaging/macos/Credentials.swift` owns the native credentials window and Keychain operations. `Launcher.swift` opens it from the project manager. The build compiles a generated combination of the two source files; no secret values enter the browser/server APIs.

Generic-password items use a service derived from the bundle identifier plus `.credentials.v1`, a random account ID, and a user-facing label. Listing requests attributes only, never secret data. Items are not configured for iCloud synchronization. Preview and stable bundle IDs therefore have independent credentials. Add, replace and remove operate on explicit item IDs; duplicate labels are rejected case-insensitively.

Every reveal creates a fresh LocalAuthentication context with device-owner authentication and no Touch ID reuse. Cancelled/failed authentication does not read the value. The native UI clears the revealed value after 20 seconds, on window focus loss, on app deactivation, or on close. No copy action is included. This is an application-level reveal gate, not a Keychain ACL requiring user presence on every read. Storing or connecting a credential does not authorize script access. Manual tasks use explicit native grants; see [Tasks](TASKS.md).

A local ad-hoc preview does not establish the final Developer ID Keychain access behavior across updates. Before release, verify storage/reveal/cancellation on supported Macs, denied/unavailable authentication, locked Keychain handling, and credential continuity across a signed app update. Never test with a user's existing keys.


Credential project associations live in native app preferences (`credentialProjects.v1`), keyed by the Keychain item's random ID. They contain only local folder identities and paths, never secret values. `CredentialProjects.swift` owns this mapping. Identity includes canonical path, filesystem device and inode: copied folders and replaced directories do not inherit associations. Moved/renamed projects must reconnect explicitly in this first version. Connections are organizational references, not script execution grants. Disconnect removes one association; deleting the Keychain item clears its associations. Replacement retains the single shared item and lists affected projects. Search matches credential names and associated project paths; This project uses the explicitly selected project in the credentials window.

## Analysis tabs (local preview)

Notebooks and dashboards share the main tab strip with queries, files, drafts and Tasks. `frontend/analysis-tabs.mjs` owns tab identity and rendering; closing a tab first flushes revision-checked saved work and never deletes the document. Failed/conflicting saves leave the tab open. Saved items remain in Analyses.

Within a browser session, notebook cell editors, undo histories, outputs, filters and scroll positions are retained as DOM/runtime state. Opening a notebook does not execute code; use Run all or a cell's Run button. Switching to another notebook waits for current notebook execution to finish. Complete temporary results are parked under private session table names and restored on return, preventing collisions between identical cell names without rerunning code or truncating results to the display limit. The query editor can still use the most recently selected notebook's temporary tables.

Dashboard tabs retain their GridStack instance, tile outputs, edit mode and scroll position. Refresh is explicit after the initial load. These live outputs and tab caches are not durable snapshots: reload requires running notebooks again. Saved-work file formats and revision checks are unchanged.

Open analysis tab references and the selected analysis tab are persisted as `workspace_tabs` in `saved_queries.json`, under the existing shared saved-work revision checks. Restoration is lazy: inactive tabs are listed without constructing editors or executing queries; the selected notebook opens without running cells, and the selected dashboard follows its normal initial refresh. Missing/duplicate references are ignored. Null active analysis restores the selected query from editor drafts. Closing a tab removes its reference but preserves the saved document. This metadata follows the project across server ports; browser-only `openNotebook`/`openDashboard` preferences are no longer used for restoration.

## Single browser editor (local preview)

`workspace_access.py` tracks one writer and a cooperative pending handoff per project server. `frontend/workspace-access.mjs` creates a fresh page identity, tags same-origin fetches, polls every three seconds, gates edits, and requests a handoff through `/workspace-access`. A viewing tab follows saved project changes by reloading when the server's saved-work version/change counter changes; it does not mirror live results or unsaved keystrokes. Query and notebook source survive through their normal stores.

The writer flushes editor drafts and shared saved work before yielding. Unapplied object definitions, unsaved task scripts/schedule settings, unsaved CSV drafts and active editor/notebook execution block transfer. Request cancellation is supported. A single-use, short-lived reload ticket lets the new writer reload fresh state before editing. Closing releases ownership; leases expire after 30 seconds without heartbeat. Resuming an old page never implicitly reclaims ownership, and unsaved local work prevents automatic reload. Heartbeats are independent of long-running project operations. Scheduled tasks are server-owned and continue through browser handoffs.

Once an updated browser registers, server POST/DELETE guards reject non-owner mutations with HTTP 423, including saved work, editor drafts, scripts, schedules, imports, DDL and kernels. Viewer query access is limited to one parsed SELECT in a read-only DuckDB transaction; native manager stop retains its existing token authorization. Native runtime probes use that private token only for kernel input/execution and runtime selection; it does not bypass browser ownership for saved work or tasks. Session creation/cleanup and named metadata endpoints remain available. This is stale-tab protection, not a security sandbox for untrusted users or code. Legacy no-client API operation is retained only before the first ownership handshake; an older browser is blocked once ownership activates. Origin/Host checks and revision conflicts remain in place.

Native/backend deployment requires a preview restart. Do not update an active user's backend or interrupt scheduled work incidentally.

## Assumption notebook cells (local preview)

`frontend/assumption-model.mjs` validates calendar/history inputs, constructs the
D3 curve models, and samples a typed parameter table. `assumption-cell.mjs` owns
controls, exact-value inputs and chart lifecycle; source loading, persistence,
permissions and notebook execution are injected. Pinned NapkinCharts D3 sources
and D3 itself live in `frontend/vendor/napkin` (see PROVENANCE.md).

The notebook adapter reads an earlier temporary result, protects actuals, and
creates a temporary parameter table on Run using the existing SQL/Python/R input
transfer path. It never changes the source table. Configurations and sparse ISO
date control points live in saved notebook cells. Outputs remain session-local.
Committed chart edits autosave configuration and invalidate dependent results;
pointer previews do not run models. Downstream notebook execution rejects stale
or missing dependencies. The UI edits ordinary named values only. Legacy Normal
configurations migrate to value and deviation series; future-only deviation curves
reuse source dates without inventing historical observations. Published tables use
series/date/value/segment. Legacy distribution decoding remains for compatibility;
no sampling or correlation engine is embedded.

Run `node --test tests/test_assumptions.mjs` and the browser assumption scenario.
Set `MDS_TEST_R=1` for the browser check to exercise R when nanoparquet is installed.
The runtime files are included through the existing recursive frontend packaging.

Assumption multi-series: `createAssumptionSet` combines per-series curves on one
validated timeline. Selection gates model edits independently of undo history.
Saved series IDs identify curves; names identify rows in the published table.
The notebook adapter owns selection/list controls and shared axis settings.
Single-series saved cells migrate in memory; all series output remains available
to kernels, while the rendered output table uses the notebook preview row limit.

## External sources (local preview)

`remote_sources.py` owns non-secret, revision-checked connection metadata in
`.studio/connections.json`, BigQuery catalog access, background jobs and explicit
transfers. Google ADC resolves credentials on the server; no JSON key upload,
secret HTTP endpoint, or browser credential storage is provided. The native
Keychain task grants remain separate. `frontend/remote-sources.mjs` owns the
connection dialogs, explorer and remote transport. SQL tab metadata now carries
an optional `connection` ID; absent/empty means Local DuckDB. Missing remote IDs
fail closed. Saved queries, editor drafts and history preserve the destination.

Remote SQL is currently one BigQuery-validated SELECT, with dry-run byte estimates
and a maximum-bytes-billed job setting (default 1 GB). This is a product restriction,
not an authorization substitute: Google IAM still controls access. The connection
project is the query billing/catalog project, and location is explicit. Catalog
lists are currently limited to 500 datasets/tables; cross-project queries may use
fully qualified names. Local DuckDB autocomplete is disabled for remote tabs.

Remote jobs run on background threads; HTTP polling does not hold the project
operation lock while queries execute. Cancel requests are best-effort; remote
jobs may outlive Studio. The server retains at most 12 jobs with completed results
expiring after 30 minutes when another job starts. Results belong to their originating
database session and are not restored after reload. Browser previews fetch at most
1,000 rows. A local snapshot fetches the *original completed job*, never reruns SQL,
and rejects incomplete results or transfers over 100,000 rows / 64 MB. Local tables
record source query, job and fetch time as provenance, not an editable DuckDB SQL
definition. Snapshots can be used in ordinary local notebooks/Python/R. Remote
notebook cells/dashboard execution are not enabled in this first preview.

CSV/TSV files and named main-schema DuckDB relations may be uploaded explicitly.
The confirmation shows project.dataset.table. CSV types are inferred by DuckDB.
Uploads use a temporary BigQuery staging table followed by CREATE TABLE AS SELECT,
so even an existing empty destination is never appended to or overwritten. Staging
cleanup is attempted, with an expiration fallback and a visible cleanup warning.
Uploads require destination dataset create/write/delete permissions and incur the
normal warehouse storage/query charges. Stop/cancel cannot roll back completed writes.

### BigQuery SQL models (local preview)

`remote_models.py` owns `.studio/bigquery-models.json` (format 1). Each model has a
stable UUID, revision, editable draft, last successful publication, and append-only
published SQL versions. Exact SQL whitespace is retained. Editor tabs reference
`remoteModel` and a string `modelRevision`; their in-progress code remains in the
normal revision-checked editor store. Save/Cmd-S saves a model draft, never publishes.
`frontend/remote-models.mjs` owns draft settings, the editor toolbar, publication
review and SQL history. Existing uploads/catalog objects remain sources, not models.

Publication uses a five-minute, one-use server review token tied to the saved draft
revision and connection configuration. Google validates both the SELECT and generated
DDL with dry runs; the query budget also applies to execution. New names use CREATE,
never implicit adoption. Updates require the last recorded etag and `studio_model`
label immediately before CREATE OR REPLACE. This detects external changes but is
not a distributed lock: BigQuery DDL provides no etag compare-and-swap, so a concurrent
external writer between that check and execution is still a limitation. Only Studio
should manage these destinations. Published destination/type changes and removal
are deliberately not implemented in this preview (no drop/recreate conversion).

A durable pending intent with a client-chosen BigQuery job ID precedes execution.
Ambiguous network failures block further edits/publications until Check publication
status reconciles the job. Successful reconciliation records one SQL version;
definitive job failures clear pending state without creating a version. Missing jobs
remain blocked rather than risk duplicate execution; manual recovery is needed if
Google never accepted the request. This is SQL history, not historical warehouse
rows, automatic table refresh, or a scheduler. Restoring a version edits draft SQL
only and requires another explicit publication. Metadata is local to the project;
copying the entire project also copies model identities, not isolated warehouse targets.

### Managed model references (local preview)

`model_references.py` implements a SQL-aware, non-executing reference compiler.
Only `{{ reference_key }}` and explicit `{{ @model_uuid }}` are supported. Quoted
strings/identifiers (including triple quotes) and SQL comments are skipped. This is
not Jinja, dbt, arbitrary expression evaluation, or cross-warehouse federation.

Each model receives an immutable `reference` key scoped to its connection, initially
based on its destination table name. Collisions receive a numeric suffix. Existing
models receive keys deterministically when loaded; keys persist on the next model
write. Display names and draft destination edits never rename the key. Draft
`references` maps keys to stable UUIDs, retaining old bindings for history restoration.
The service, not the caller, creates these bindings. Missing bound UUIDs never
silently bind to a replacement with the same key.

`/remote/model-compile` is a read-only local metadata operation: returns compiled SQL,
direct upstream published models, and direct downstream draft/published dependents.
It does not contact Google. Unknown, missing, cross-connection, pending or unpublished
references block execution/publication. Incomplete drafts still save. Both draft and
would-be published graphs are checked for cycles, including self-reference. Literal
warehouse references are not parsed into dependency edges. Run compiles on the server
before Google dry run; model publication uses the same compiler, preserving authored
SQL. Publication review tokens freeze direct upstream publication IDs/etags and are
invalidated when an upstream changes. Warehouse etags are checked before publishing.
This is not a distributed transaction or an automatic downstream rebuild scheduler.

Versions retain authored SQL, compiled SQL, stable reference bindings, and dependency
publication metadata. Restoring SQL remains draft-only. `frontend/model-reference-hints.mjs`
provides context-aware CodeMirror suggestions inside braces, filtered by connection;
comments, strings and paste events do not trigger suggestions. Sources are still
queried by literal warehouse addresses unless a Studio model is created for them.


### Read-only provider adapters (local preview)

`remote_connectors.py` owns Postgres/Snowflake configuration validation, identifier
quoting, catalog reads, SELECT parsing, cancellation and DB-API→Arrow conversion.
`remote_sources.py` orchestrates jobs, per-session results and DuckDB snapshots.
Provider capabilities are derived server-side, never trusted from request metadata.
BigQuery alone supports model compilation/publication and uploads. Other providers
reject these actions at the backend as well as hiding them in the UI.

Connections gain an additive `provider` discriminator; absent means `bigquery` for
existing projects. Standard Postgres stores a libpq `service` and `timeoutSeconds`.
The Supabase Postgres preset instead stores `preset: supabase`, host, port 5432,
database, user, optional local CA path, timeout and a Keychain credential ID.
`frontend/supabase-settings.mjs` owns its guided setup. The native credential bridge
binds approval to the saved destination, CA path and project; passwords travel only
over the inherited pipe. Public CA trust is the default, with verified TLS always
enabled. Supabase uses the same read-only Postgres connector and transfer behavior.
No CLI installation or Supabase API key is required.

Snowflake stores account/user/role/warehouse/database and timeout. ADC, browser SSO
and native libpq profiles resolve credentials outside project state. No arbitrary
DSNs, password fields or SDK option passthrough are accepted. Errors from these two
new drivers are mapped to safe troubleshooting messages rather than exposing raw
DSNs/tokens. SQL parser diagnostic context is disabled to avoid logging SQL literals.

Postgres uses verified TLS, a read-only transaction, statement timeout and a named
server cursor. Snowflake disables secondary roles, uses an explicitly selected role
and server statement timeout; async submission exposes the running job ID for Cancel.
SELECT AST validation rejects scripts, writes, SELECT INTO, locks and Snowflake SYSTEM$
commands. This is not an authorization boundary for functions: use real read-only roles.
No credentials or remote access were used by adapter/transport tests.

Both adapters fetch batches and retain at most 100,000 rows/64 MB of Arrow data,
showing at most 1,000 rows. Bounds limit retained data, not total process RAM or driver
prefetch allocation. A result that exceeds either limit cannot be snapshotted. Complete
retained Arrow results preserve common dates, timestamps, decimals and empty typed
schemas; nested objects/arrays become JSON text. Unsupported values fail with a cast
suggestion. A snapshot never re-executes SQL or opens a new remote connection.
Catalogs show at most 500 schemas/objects and report truncation. Each operation closes
its connection; SSO connection pooling and persistent remote query history are deferred.


### Snowflake Keychain authentication (local preview)

Snowflake metadata accepts `authentication: sso | password_mfa` (missing means SSO).
Password MFA adds a `credentialId` and `mfaMethod: push | passcode`. Plaintext password,
token and passcode settings are rejected. `/remote/credentials` returns connected IDs
and labels only; `/remote/manage-credentials` opens the existing native manager.

`RemoteSources` shares TaskRunner's `NativeCredentials` instance and lock, serializing
requests over the inherited launcher pipes. `resolve-connection` never has an HTTP
endpoint. The launcher rereads the saved connections file inside the project, matches
account/user/role/warehouse/database/authentication/credential metadata, checks the
credential's project association, then asks for connection-specific native approval.
Its persisted grant hashes project filesystem identity and connection metadata.
One-time passcodes are entered in a native secure field and cleared, not persisted.
Credential values return over the private pipe into the Snowflake connector and do not
enter logs, job status or HTTP results. Driver errors remain sanitized. The connector
uses `username_password_mfa` with MFA token caching enabled by default; no account-wide MFA policy
changes are made. Keychain approval is separate from Snowflake MFA authentication.

`tests/native_connection_credentials.swift` exercises the real Keychain/pipe path with
an isolated service, preferences suite and disposable project. It verifies correct
resolution, destination mismatch refusal and project-disconnect refusal, then deletes
its dummy credential. Compile it after CredentialProjects.swift, Credentials.swift and
TaskCredentials.swift (without Launcher.swift). Never use real passwords for this test.

### Snowflake session reuse

Each `RemoteSources` owner has an in-memory `SnowflakeSessions` pool keyed by the
complete saved connection configuration. Browsing and querying lease the same
session serially; waiting queries can be cancelled without cancelling its current
user. Request-local cancellation handles are detached before returning a session,
so cancelling an old job cannot affect a later query. No credentials or session
tokens are serialized to project files or browser storage.

Saving connection settings retires the previous session, including queued leases;
active operations finish before it closes. Project shutdown/rename closes idle
sessions and retires active ones. Authentication/connection failures and cancelled
operations discard the session; ordinary SQL errors preserve it. Failed queries
are never replayed automatically. A later request can authenticate again after
session expiry. Snowflake keep-alive remains off. MFA approval caching uses the connector’s secure-local-storage extra and macOS Keychain, subject to account policy. Native credential approval includes this behavior. No caching toggle is exposed.

Remote result display is initially 1,000 rows. `/remote/result` accepts an explicit
`limit` (1,000–100,000) to expand the display from retained Snowflake/Postgres rows
or the original BigQuery job. It never resubmits SQL. The connector's
`availableRows` reports the retained prefix, not a full count for truncated
results. Explicit transfers use `remote_transfers.py` and session-owned
`/remote/transfer-plan`, `transfer-start`, `transfer-status`, and `transfer-cancel`.
They bypass the bounded `full_result` path, which remains for notebook inputs.
A confirmed 1 MB–100 GB budget (default 1 GB) bounds Arrow batch bytes and CSV
output bytes. Staging lives on project disk. CSV publication uses an exclusive
hard link; DuckDB creation and provenance commit in one transaction. Dual-output
transfers stream once to CSV and Parquet staging, validate both destination names,
and link the CSV just before the DuckDB commit. A caught commit failure removes
the newly linked CSV and rolls back the table. Cross-resource publication cannot
be crash-atomic: a process or machine crash between the link and commit can leave
a complete CSV without a table. Cancellation
and failure remove staging and leave no published partial result. Only one transfer
runs per project, with a one-hour deadline checked between batches.
BigQuery retrieves its job; Snowflake retrieves its query ID under the session lease.
Postgres uses a complete cached result or an explicitly acknowledged SELECT rerun
through a server cursor. Provider failures never trigger automatic reruns.
Display filtering and pagination do not affect transfers. These limits are not
warehouse cost or total driver-memory bounds.

### Google authentication profiles (local preview)
`google_profiles.py` owns Mac-local Google user profiles outside project folders, under
`~/Library/Application Support/Minimal Data Studio/google-profiles/`. Profile directories
are mode 700 and credential files mode 600. `MDS_GOOGLE_PROFILES_DIR` is a process-level
override for isolated testing. Project connections store only an `authProfile` ID;
`RemoteSources.view()` adds name/account metadata for display, never tokens.

Sign-in uses the installed Google Cloud CLI in an isolated `CLOUDSDK_CONFIG` staging
directory. A Google userinfo call verifies the email before the profile is committed.
The default gcloud/ADC configuration is never switched or rewritten. Copying the current
ADC is an explicit action and supports authorized-user credentials only. Reconnecting
must return the same verified account; another account requires a new profile. CLI output
is discarded and staging directories are removed. Sign-ins time out after five minutes;
a cross-process file lock prevents concurrent sign-in flows. Closing the settings dialog
does not cancel an already-open Google login; Refresh profiles retrieves completed profiles.

Clients load the selected profile explicitly and use the connection project for the
quota project. Missing profiles fail closed; they never fall back to the default ADC.
Legacy connections without `authProfile` keep system ADC behavior and are labeled shared,
with account unverified. Completed query jobs retain their original connection settings,
so changing profiles cannot redirect later result retrieval to a different identity.

## Scatterplot output charts

`frontend/scatter-chart.mjs` owns row-preserving point preparation, Vega-Lite
encoding and optional field controls. The shared chart adapter in `index.html`
uses it for query, notebook, dashboard and PNG output. Numeric X/Y never use
bar/line aggregation, time bucketing, cumulative transforms or series folding.
Size maps nonnegative numbers to symbol area; shape is categorical and color
inherits numeric or categorical semantics from the result schema. Saved chart
configuration uses optional `size`, `shape`, and `color` column names.

Scatterplot brightness is a numeric field mapped to HSL lightness after Vega-Lite
compilation by `applyScatterBrightness`. This preserves hue, avoids background-dependent
opacity, adds a brightness legend, and is shared by on-screen and PNG rendering.

Shared navigation is owned by `frontend/chart-navigation.mjs`; scatter-specific scale setup and viewport caching live in `frontend/scatter-viewport.mjs`. Zoom and pan change only axis domains; point encodings retain their scales. Viewports are temporary, scoped to each result and X/Y mapping; PNG export uses the current viewport. Tooltips are view-owned and clear on point exit, pan, blur, and finalization.

The scatter magnifier toggles rectangular zoom instead of pan. A translucent selection is clamped to plot bounds, committed on pointer release, and cancelled by Escape, lost capture or window blur. Drags smaller than five pixels on either axis are ignored. A completed box zoom automatically returns to pan mode. It shares the temporary viewport and Reset behavior.

Adaptive scatterplots (local preview): `frontend/scatter-detail.mjs` raises the scatter-only ceiling to 500,000 prepared points (other charts remain at 20,000). More than 5,000 total points use Canvas; smaller results retain SVG. A derived viewport dataset filters marks on both axes, while encoding scales still use the complete result. Above 5,000 visible points, a separate non-interactive overview mark draws every visible row; at or below that threshold, the detailed mark enables hover/highlighting. No sampling or extra query is performed. The browser still holds the full loaded result: this is not a database-backed million-row density viewer. Canvas navigation computes plot bounds from the view origin and dimensions. Pan events coalesce per animation frame. Large extents use iteration rather than spread arguments. Categorical legends show at most 12 entries with a notice; underlying categories are retained.

Synthetic grid benchmarks on the development Mac in headless Chromium/Firefox: 100,000 points prepared in approximately 1.2 seconds, 500,000 in 5–5.3 seconds (chart selection/setup included; query fetch excluded). These are regression observations, not guarantees for other hardware or encodings. Browser checks cover overview, detail, reset, tooltip cleanup, and pan.

Time navigation and sub-day granularity (preview): `frontend/time-chart.mjs` owns UTC buckets, timestamp keys/labels, clock-menu controls and temporary X viewports. Hour/minute/second/millisecond choices are behind a clock icon; ordinary day-through-year controls remain visible. Distinct millisecond buckets keep full timestamp keys. Coarser buckets retain existing Sum/Average behavior; selecting a finer grain does not create observations. Intraday year comparisons are not offered. Line timelines share the navigation controls in X-only mode: horizontal range selection, pan, +/- and reset, with Time only as the default. The magnifier reveals Time only / Value only / Both axes choices; pan and +/- follow that choice, and Reset restores both axes. Y uses its original Vega domain until a value-window override is set. Year overlays retain their categorical axis without navigation. Viewports are temporary and do not modify query results or saved chart grain.

Scatter appearance controls live in `scatter-chart.mjs` and persist as `scatterStyle`. They apply before the shared SVG/Canvas/export pipeline; hover preserves the configured outline on exit, and dimming never makes a low-opacity point brighter. Brightness uses opaque marks by default but respects explicit appearance opacity.

`frontend/scatter-mappings.mjs` owns category override resolution, numeric input/output mapping and their Style controls. Category domains are sorted and retain the same full-result palette and shapes through zoom; per-column overrides are keyed by category text. Explicit size rules use fixed clamped domains/ranges. Brightness rules drive both the mark calculation and gradient legend. Rule editing is buffered until Apply, with invalid ranges shown inline. Overrides and rules are shared by SVG, Canvas and export and saved with the chart.

Large Canvas scatterplots remove Vega's generated `window:resize` handlers from width/height signals. `frontend/chart-resize.mjs` owns a container ResizeObserver and a 250 ms trailing debounce. During editor/sidebar/dashboard resize drags, repaint waits for pointer release/cancellation; unrelated resize events with identical dimensions do no work. The current canvas stays in place and chart pointer interaction pauses while resize is pending. Finalization disconnects the observer/listeners and cancels timers. This reduces resize repaint work, not initial chart preparation, mapping edits or query costs.

Chart-settings disclosure is layout-only: it retains the existing controls and Vega view, without saving configuration or rebuilding chart data. The existing resize lifecycle handles the changed plot dimensions (settled resize for large Canvas charts).

Line charts with more than eight displayed series use the searchable `line-series.mjs` picker. Pins and isolate mode are runtime-only; hover and pins update Vega signals. Switching grouping, series identity, or the visible subset selects a fresh time viewport, preventing stale Y scales. Crowded charts use per-line hover instead of the all-series tooltip pivot.

`line-hover.mjs` indexes observed timestamps for selected-series comparisons. A shared guide and markers use current Vega scales; tooltip rows follow the original series order, with explicit missing observations. Pinning keeps all lines and axes unchanged; dragging, leaving, Escape, scrolling, tab hiding, and finalization clear transient hover details. Screenshot shortcut keypresses and window blur leave tooltips visible.

Selected-series hover values are measured as SVG text and placed beside their observation dots. Placement avoids other value labels, dots, endpoint labels, tooltip bounds, and plot edges; values that cannot fit remain available in the comparison tooltip.

`line-settings.mjs` resolves legend presentation and hover independently, with count-based defaults only when the corresponding chart setting is automatic. Selected-series hover works for temporal and categorical line axes; settings persist through the existing chart config save path.

`line-appearance.mjs` owns chart-local strip palettes, selected-hover settings,
with tooltip controls mounted in their own collapsible Chart settings section and palettes under Style,
and safe merging of extra tooltip fields. `chartData` collects only the configured
extra columns, preserving a value only if all source rows in the plotted bucket
agree. Folding into Other merges this metadata as well. Tooltips render text nodes,
never evaluate templates, and retain stable underlying series identifiers.

Cohort-strip calendar selection grouping lives in `line-series.mjs`. Original, month, quarter, and year groups map back to the original series identities; they never aggregate chart values or change axes. Grouping is transient inspection state alongside pins. Only valid ISO date/month series offer calendar grouping. Partial groups expose `aria-pressed="mixed"`; clicks and drags from partial/empty groups select, while fully selected groups deselect. Drag previews restore their initial pin set before applying the current range, so shrinking or cancellation restores unaffected selections.

Grouped strip hover uses a separate `hoveredSeries` Vega signal to emphasize all members without mutating pins or rebuilding chart data. Leaving the segment clears that temporary emphasis; existing selections remain highlighted. Keyboard focus uses the same behavior.

Regular stacked bars reuse the cohort strip with transient pins and grouped hover. `stacked-interaction.mjs` handles segment hover; opacity signals never filter stack input. The tooltip aggregates bar totals across every segment and displays share only for nonnegative bars with a positive total. Stacked charts default to all series; smaller-series grouping remains explicit. Percent stacks share these inspection controls and retain full-bar normalization. Negative values produce a clear message directing users to regular stacked bars; zero totals have no percentage contribution.

When stack cohorts are pinned, the stack tooltip summarizes their contributions at the hovered X value against the complete bar total. Its SVG overlay labels the combined percentage at the top of the plot, aligned to the hovered bar; disconnected selections use a sigma prefix to identify a combined share. No pins uses the original segment tooltip. Tooltip/overlay handlers and selection listeners are scoped to the chart view lifecycle.

Series meaning is persisted as `chart.seriesKind`. `resolveSeriesKind` in `line-series.mjs` centralizes explicit overrides and the date-based Auto default for strip labels, calendar controls, and stacked selection tooltip wording. Grouping remains transient and is ignored in Series mode without clearing selected identities.

Stacked charts share the grouped settings layout with line charts. Their `stackHover` and `stackTooltip` settings are separate from line inspection settings. `stacked-navigation.mjs` zooms the categorical scale range while retaining its complete domain and stack input, clips plotted marks, and hides out-of-range category labels. Value zoom uses domainRaw. The shared navigation controls support both orientations, category/value/both box zoom, drag pan and reset; tooltip overlays clear during navigation. Viewport caches include chart type and orientation so percent and absolute domains do not leak into each other.

Bar navigation (regular, stacked, and % of total) uses bounded viewports: at full
extent dragging is inactive, zoom-out stops at the original extent, and panning
preserves the zoom span while clamping to its edges. Category-only navigation is
the default in either orientation; explicitly choosing value/both-axis zoom is
still supported. Reset restores both extents and category-only navigation. Time-series
line charts use these same bounds, with time-only navigation by default and after
Reset. Scatterplots use the same bounded navigation with both axes enabled by
default: full extent disables dragging, and zoomed views clamp independently to
the original X and Y ranges.

Notebook resizing uses `frontend/notebook-resize.mjs`. Code and output handles
store optional `codeHeight`/`outputHeight` on their cell through normal saved-work
persistence. Dragging changes container height; release refreshes CodeMirror or
signals chart resize. Chart resize observers skip active notebook drags, including
Canvas deferred repaint. Reset removes the size override; folded sections hide
their handle. Keyboard arrows adjust size and Home resets; viewing-only windows
cannot change sizes. Presentation slide layout remains independent.


## Chart and notebook UI boundaries

This is an incremental extraction, not a new framework or saved-work format.

- `chart-controller.mjs` owns screen embedding and tooltip attachment/failure
  cleanup, scatter inspection setup, renderer choice, and navigation/resize wiring.
  Callers retain the returned Vega view and finalize it when replacing output.
- `chart-navigation.mjs` owns shared gestures and controls. `chartNavigationPolicy`
  declares each chart's bounds, default axes, optional axis picker and time rounding.
  Existing CSS classes remain unchanged. Scatter, time and stacked viewport modules
  still own their chart-specific scale transforms and transient caches.
- `notebook-cell.mjs` mounts data-cell code editors, output controls, folding and
  resize handles. Execution, project-aware completion, persistence and notebook
  ordering stay in the page and are passed as explicit callbacks. It does not own
  global notebook state or run queries during rendering.
- `tests/browser/chart-helpers.mjs` shares drag, resize, settled-layout and saved-work
  mechanics. Individual scenarios retain their assertions; helpers never swallow
  failures or retry mutations.

Chart data preparation/spec construction, chart settings, notebook execution and
presentation layout remain in their existing locations. Further extraction should
follow a concrete maintenance need rather than moving code just to shrink a file.

### Tab browsing

`frontend/tab-tools.mjs` owns the temporary preview slot and tab search/context menus.
Files, database objects and saved analyses can reuse a single preview slot; edited
or explicitly kept documents are retained. New query, task and CSV draft tabs remain
permanent. Preview status is session-only: restored tabs are retained on reload.
The page supplies close callbacks; notebooks/dashboards flush revision-checked saved
work before closing, and query/task editors retain their unsaved-work protections.
Closing a tab does not delete its saved document. Menus operate on the displayed
order; grouped search activates the existing tab rather than opening a duplicate.

The open-tabs list is rendered by `frontend/open-tabs-menu.mjs`. Its search and
checkbox selection survive tab-bar redraws; close operations use each editor's
existing guards and save callbacks. Active and preview state comes from the tab
registry, while dirty/running status is read from the owning editor. The menu
never deletes a saved document or directly mutates editor collections.

Supabase's certificate picker sends only a size-limited PEM public certificate to
`/remote/import-certificate`. The server validates the PEM with TLS parsing, rejects
private keys and extra content, and stores a content-addressed copy outside projects
in the per-user application support certificates directory (`MDS_CERTIFICATES_DIR`
can override this for tests). The saved connection contains only its local path.
Choosing a certificate does not change a saved connection until Save is clicked.
