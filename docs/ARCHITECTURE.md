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

State format 1 contains `tabs` and `active`. Each tab stores `name`, `sql` (the current code, regardless of language), `lang`, and `drafts` keyed by sql/python/r, with optional `savedId`, `orig`, and `view` metadata. Preserve code whitespace exactly. Results, live kernel state, browser-only tabs and DOM state are not serialized. Limits: 200 editor tabs and 2 MB of persisted JSON.

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
