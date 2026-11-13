# User guide

A local workspace for learning SQL and data analysis. One HTML page, no build step: a local DuckDB file stores and executes SQL, with editor tabs, autocomplete, formatting, history, tables, charts, saved queries, dashboards, and notebooks with presentation mode.

## Run

```sh
cd minimal-data-studio
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python serve.py
```

Open http://localhost:8791. The server requires Python 3.9+, DuckDB and PyArrow (installed above). `python3 serve.py` also switches to the project environment automatically if its dependencies are unavailable in the launching Python. Internet access is needed for the frontend CDN libraries (Apache Arrow, CodeMirror, sql-formatter, Vega, GridStack, marked and DOMPurify). SQL executes on your computer; query results travel to the browser as Arrow data.

The welcome query works without any datasets. Open **Average sepal length by species**, **Flower overview**, or **Explore flower measurements** in the sidebar for the sample query, dashboard, and notebook.

## Main editor languages

Each tab has a **SQL / Python / R** selector. Switching preserves a separate draft for each language in that tab, including after reload. Syntax highlighting follows the language; SQL formatting and SQL autocomplete are enabled only in SQL mode.

- **Cmd/Ctrl+Enter** runs selected code. With no selection, SQL runs the statement at the cursor; Python and R run the whole tab.
- **Shift+Cmd/Ctrl+Enter** or **Run all** runs the whole tab in its selected language.
- Python/R use the same local kernel setup described below. Each run starts a fresh process; variables do not persist between runs. Loaded tables with identifier-safe names (such as `iris`) are available as dataframes when referenced in the code. Notebook filters are not injected into main-editor runs.
- End with a pandas DataFrame/Series or R data.frame to use the existing table, chart, copy, and export controls. Printed output and plots appear above results. Main-editor dataframe outputs can be registered with **Create table…**; notebooks also support named cross-language result chains.
- Save retains the active language, code, language drafts and chart settings. Old saved queries default to SQL. History records its language and opens an entry in a new tab. Saved Python/R queries also work as dashboard tiles when they return a dataframe.

Opening a saved query or dashboard executes its code, just as opening a notebook does. Python/R execute locally with your user permissions.

## Create tables and views from results

After running code in the main editor, use the buttons beside **Export CSV**:

- **Create table…** stores the complete last result as a named snapshot, for SQL, Python or R. It preserves values and column types, including empty-result schemas, without rerunning the code. Display filters, sorting and pagination do not change the saved rows.
- **Create view…** is available for SQL query results. It shows the last executed query for review and creates a live SQL view. For **Run all**, only the final statement becomes the view; preceding setup statements are not included. Editing the editor without running it does not change which query is used.

Choose a new name; existing tables and views are never overwritten by these buttons. All ordinary tables and views live in `project/.studio/workspace.duckdb`, including objects created directly with SQL. `INSERT`, `UPDATE`, `DELETE`, `ALTER`, and `DROP` survive reload and server restart. Explicit transactions follow SQL semantics: use `COMMIT` to retain their changes or `ROLLBACK` to discard them. An unfinished transaction rolls back when its browser connection closes.

Use **Delete** beside a table/view or SQL `DROP` to remove it. The sidebar lists durable objects in the `main` schema. View definitions come from the database; the **SQL** link opens `CREATE OR REPLACE VIEW` for editing. `CREATE TEMP TABLE` and notebook intermediate tables belong only to the current browser connection and disappear on reload. Browser pages share durable data but have separate temporary tables and transactions.

## Migration and backup

At server startup, legacy `.relations/` tables are imported from Parquet, and views are recreated in dependency order. Originals are retained; a copy is made in `project/.studio/migration-backup/` when there are records to migrate. A transaction records each successful import in the database, so deleting a migrated object does not cause it to return on restart. Failed migrations retain their source files, show a startup warning, and retry on the next server start. Existing names are never overwritten.

Saved queries, notebooks and dashboards remain in `project/saved_queries.json` without conversion.

To back up the complete workspace, stop the server cleanly, then copy the entire `project/` folder, including hidden `.studio/` contents, source files, exports and saved work. Do not copy only the database file while the server is running: committed changes may still be in its `.wal` file. `project/`, `.studio/`, `.relations/`, and runtime saves are excluded from Git. Launch only one writable server for a workspace database at a time.

## Datasets

`datasets.json` maps SQL table names to CSV or Parquet paths relative to the data directory:

```json
{"iris": "iris.csv"}
```

Configured datasets are imported once at server startup. A successfully imported dataset is never reloaded automatically, even if its source file changes or you drop its table. The optional `views.sql` is also a one-time bootstrap script. This prevents reloads and restarts from undoing SQL changes. New configured dataset names are imported on a later server start. Missing files produce a warning without preventing other imports.

**Files** shows files inside the project; **Database** shows tables and views. Choose **Bring files…**, select files from your computer, then confirm **Copy into project**. Copies go into `project/data/`; originals are unchanged, existing names receive a numbered suffix, and no database table is created yet. Select a project file to inspect/copy its full path (from the filesystem root) or project-relative path. Then choose **Import as table** for CSV, TSV, JSON or Parquet. Import creates a separate persistent table; editing that table does not edit the source file.

**Code starts here** shows the working directory and expands to its complete root-to-folder location. SQL, Python, and R runs all start in the project folder, including notebook cells. For example:

```sql
SELECT * FROM read_csv('data/iris.csv');
```

```python
pd.read_csv('data/iris.csv')
```

```r
read.csv('data/iris.csv')
```

Relative exports such as `exports/results.csv` also resolve from the project. The file list refreshes after editor runs, and **Refresh files** picks up changes made elsewhere. Explicit changes to the working directory inside Python/R affect that run only; the next run starts at the project again.

The file browser rejects paths outside the project, including symlinks that lead outside. App-managed saves and hidden files are omitted. This is a project-navigation boundary, not a code sandbox: native SQL/Python/R still have local user permissions.

By default, the project is `project/`. The existing database and saved queries/notebooks/dashboard file are copied there once on first launch; the old originals are retained. Bundled data files are copied into `project/data/`, and `project/exports/` is created. Use `--project-dir /absolute/path` for another workspace; existing legacy user work is migrated only into the default project. Stop the old server before first migration so DuckDB can checkpoint safely.

Use another seed-data directory with `python3 serve.py --data-dir /absolute/path`, or `SQL_LAB_DATA_DIR`. The database remains in the selected project’s `.studio/` folder. Change the port with `--port 8800`.

## Saving

On first launch the server creates `project/saved_queries.json` from `examples/saved_queries.json`. Queries, notebooks, charts, folders and dashboards are saved in that file; tables and views are stored in DuckDB, and displayed query outputs are recomputed. The example file remains a clean, shareable seed. The default `project/` folder, including data, database, saved work and backups, is Git-ignored.

Each save backs up the previous file (newest 50 retained), uses atomic replacement, and checks the browser's base version. Another tab's intervening save returns 409 and offers reload or explicit overwrite. Concurrent saves are serialized. Tabs, history and theme use namespaced browser storage.

## Python and R notebook cells

Python/R cells **execute code locally with your user permissions**, not in a sandbox. Open and run only notebooks you trust. Opening a notebook automatically executes its cells. The HTTP server binds only to loopback; database and kernel requests retain local Host checks and mutations require the editor Origin. Native SQL, like Python/R, can access local files with your user permissions.

Install Python dependencies in the project environment:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

The server uses `.venv/bin/python` when present, otherwise its own Python. Override with `SQL_LAB_PYTHON=/absolute/path/to/python`.

Install R separately, then its Parquet dependency:

```sh
mkdir -p .venv/R-library
Rscript -e 'install.packages("nanoparquet", lib=".venv/R-library", repos="https://cloud.r-project.org")'
```

The server includes `.venv/R-library` in R's library path if no `R_LIBS_USER` override is set. `Rscript` must be on PATH or in a conventional macOS installation location. R is optional; SQL and Python work without it.

Each cell runs in a fresh process. Referenced tables and previous named cell results are transferred as Parquet and become pandas DataFrames / R data.frames. Filters become named variables; SQL uses `{{filter_name}}`. End Python with a DataFrame/Series expression or R with a data.frame expression to pass a table to subsequent cells. Matplotlib and R figures return as PNGs. Other variables and imported packages do not persist between cells. Runs have a ten-minute timeout; temporary runs older than an hour are cleaned when another cell runs.

## Sample data and validation

`data/iris.csv` contains 150 public flower measurements, with attribution and license in [data/README.md](data/README.md). Examples are newly authored against this dataset. See [VALIDATION.md](VALIDATION.md) for extraction checks and browser verification.

## Regression checks

```sh
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
node --test tests/test_imports.mjs
```

These tests use disposable database files and do not modify the working database.


### Previewing project files

Click a file in Files to open a read-only tab in the workspace. Markdown opens as a rendered document; CSV and TSV open as rows and columns; JSON opens as an expandable tree; Parquet opens as rows and columns. Previewing never imports a table or edits a file.

Use **Source** to inspect the original text, or **Schema** for Parquet column names and types. CSV/TSV previews preserve text values, including leading zeros and empty fields. Parsing errors remain visible, with source text available for inspection. Text previews are capped at 1 MB and table previews at 100 rows; limits are shown in the viewer. Markdown images are not loaded, and web links open separately.

**Details** contains full and project-relative paths with copy buttons. **Import as table** creates a separate database snapshot. **Open table** opens a SQL tab querying an existing linked table. Use **Reload file** to reread the source file after an external change. File tabs are currently kept for the page session.


### Explorer and help panels

Use the small arrow in either panel’s header to collapse it. A narrow **Explorer** or **Help** strip stays at the edge of the workspace; click its arrow to reopen the panel. Drag a panel’s inner edge to resize it, or focus that edge and use the left/right arrow keys. Its SQL, Python, R, and Minimal Data Studio sections contain nested syntax/app guides and explanations of common errors with suggested checks. Panel widths, visibility, and expanded help topics are remembered in this browser after reload. Both panels stay beside the editor rather than covering it; their widths adapt when the window is smaller.


### Runtime setup and terminal

Open **Help → Runtime setup** to check Python and R. Studio-managed is the default for each language. Python uses the app environment; R uses a detected R installation with Studio’s R package library. R itself is not bundled. Checks launch the chosen interpreter and load pandas, PyArrow, and matplotlib for Python, or nanoparquet for R.

Choose **Use my installation**, select a detected executable or enter its full path, then click **Use environment**. R requires Rscript. Choices are saved per project in .studio/runtimes.json and affect subsequent editor and notebook runs. An invalid executable leaves the previous choice intact; an interpreter with missing packages can be selected so you can repair it. SQL continues using the server environment.

Installation instructions link to official runtime downloads and provide a package-install command targeting the selected executable. No packages are installed automatically. Generated commands use a POSIX shell; Windows terminal support is not implemented.

The collapsible **Terminal** at the bottom of Help is a real local shell on macOS/Linux. It starts in the project directory and supports interactive prompts and Ctrl+C. **Clear** clears displayed scrollback; **Close** ends the shell and its foreground command. Collapsing leaves it running. Reloading/closing the browser normally closes its terminal session; terminals are not restored. Reopen the terminal after changing runtime choices. Selected runtime directories are placed on PATH. Exact executable paths are also available in the shell variables MDS_PYTHON and MDS_RSCRIPT. Use the generated setup commands when installing packages.

Commands have your local account’s permissions and can change files outside the project. Runtime settings do not sandbox code.

## BigQuery connections (preview)

Data separates Files, Local DuckDB, BigQuery, Snowflake, Postgres and CSV drafts. Add a BigQuery
connection with its Google Cloud project ID, dataset location and query byte limit.
Install the Google Cloud CLI, then run `gcloud auth application-default login`
once in your own Terminal. Studio uses these local credentials; no service-account
JSON upload is required. This is different from `gcloud auth login` alone.

The SQL connection selector is saved per tab/query. BigQuery runs one SELECT at a
time, displays up to 1,000 rows and shows the full row count and fetch time. Use
Save local snapshot to download the completed result into a new DuckDB table.
Snapshots are fixed copies; run the remote query again for fresh data. Files have
separate Import into DuckDB and Upload to BigQuery actions. Local database rows
also have an upload action on hover. Upload always creates a new table, never
replaces one; the confirmation shows its destination. Uploads are limited to
100,000 rows and 64 MB in this preview. Explicit full downloads use a separate
transfer budget. Local CSV upload infers column types.

Connection metadata follows the project; Google credentials stay on the computer.
The first version uses ADC configured externally; it does not include an in-app
Google OAuth login. Remote DDL/DML, view publishing, remote notebook execution and
automatic synchronization are not enabled. A Google permission, billing or location
error requires fixing the Google configuration; Studio cannot grant access.

### BigQuery models: draft, review, publish

Expand a BigQuery connection to see **Published · Studio-managed**, **Local drafts**,
and **Data sources**. Existing warehouse tables/views and uploaded tables are sources;
Studio does not adopt them for replacement. Choose **New query**, write a remote SELECT, then choose **Save as model…**. Pick an existing dataset, a new
destination name, and View (saved SQL) or Table (stored results).

Models open in ordinary SQL editor tabs. Run previews results; Save draft / Cmd-S
saves locally. Closing a model tab saves its draft and keeps the model in the explorer. **Review & publish…** saves and validates the draft, then displays the
full destination, materialization, estimated scan, generated SQL and changes from
the previous publication. Only the final Publish button writes to BigQuery. Table
publication runs the full query, not only the displayed result rows. Tables do not
refresh automatically. A published model's destination and type stay fixed in this
preview; use a new model for another destination/type.

**SQL history** shows timestamped publications and diffs. Restore SQL to draft changes
the editor, never the live warehouse object or its historical data. Save or publish
that draft explicitly. If a publication times out, use **Check publication status**
before trying again. External changes and existing source names block replacement.
Project copies refer to the same remote destinations: they are not dev environments.

### Referencing another BigQuery model

Inside a model or BigQuery query, type `{{` and choose a Studio-managed model:

```sql
SELECT *
FROM {{ monthly_costs }};
```

The reference key is permanent and can differ from the model's display name. Find it
in model Settings or hover over the model in the explorer. Suggestions show models
on the current connection, including drafts marked “publish first.” Publish the
upstream model before running or publishing a dependent model. References use its
published table/view, never its unfinished SQL draft.

**Compiled SQL & dependencies** shows the SQL with full BigQuery addresses and the
models it uses; a model also shows which saved drafts/publications reference it.
This check stays local and doesn't execute SQL. Missing references and circular
dependencies have explicit errors. References in comments or quoted text are ignored.
Ordinary warehouse table names remain valid but aren't tracked as model dependencies.

Renaming a model's display name does not change its reference key. This feature does
not move warehouse objects, create datasets, automatically publish dependencies, or
refresh downstream stored tables. Publish upstream changes first, then explicitly
republish dependent tables when you want their stored results refreshed.


### Read-only Snowflake and Postgres (local preview)

Use the **+** next to the provider in Data. Give the connection a name, then:

- **Snowflake:** enter account identifier, user, read-only role, warehouse and database.
  Connect / refresh opens browser SSO. Your administrator must enable this authentication
  method and grant SELECT plus warehouse/database/schema USAGE. Secondary roles are disabled.
  This preview may ask you to sign in again when browsing or running another query.
- **Postgres:** enter a local libpq service profile name. Configure `~/.pg_service.conf`
  with host, port, database, read-only user and TLS CA settings; keep any password in
  `~/.pgpass` with permissions 600. The connection dialog links to the official setup
  instructions. Studio requires `sslmode=verify-full` and read-only transactions.

Connection settings in the project contain metadata only. Copying a project does not
copy its authentication. Snowflake key pairs and direct Postgres password entry are not supported by this preview.
Snowflake username/password + MFA is supported through the native preview as described below.

**Connect / refresh** lists accessible schemas; expand one to browse up to 500 objects.
Click an object for a quoted preview query, or **New query** for a blank editor on that
connection. Run executes one SELECT (including CTEs); Cancel requests cancellation.
The configurable query timeout is 1–300 seconds. A database read-only role is still
required: SQL checks are an editing guard, not a sandbox for arbitrary database functions.
Snowflake queries use warehouse compute and can incur charges.

The grid initially shows at most 1,000 rows. Studio retains a bounded preview;
explicit full transfers can save larger results to CSV or a new DuckDB table.
See the full-transfer controls below for budgets and Postgres rerun behavior.
Results expire after inactivity or a server restart. Once saved, the DuckDB snapshot
persists and can be joined to local files/tables. It does not refresh automatically.

Snowflake and Postgres have no upload, publish, model references or remote editing
in this preview. BigQuery keeps those features. For BigQuery, write SQL in **New query**
first, then choose **Save as model…** to name it and choose its destination/materialization.
That saves a local draft; publication remains a separate reviewed action.


### Snowflake username/password with MFA (local native preview)

In Snowflake connection settings choose **Username/password + MFA**. Use
**Manage credentials…** to open the native credential manager, add a credential
containing your Snowflake password, and connect it to this project. Return to the
connection dialog, choose **Refresh credentials**, select that password, and save.
Only the credential ID is saved in the connection file. Password entry and authenticated
Reveal remain in the Mac app; no password field exists in the browser.

Choose **Approve a push notification**, or **Enter a one-time code in the Mac app**.
On Connect / refresh or Run, the native app asks for permission to use the password
for that saved connection. It names the project, account, user and role. Once approved,
the same connection can reuse that permission; changing the destination or credential
selection requires approval again. One-time codes are prompted natively and are never
saved. Cancelling approval/code entry stops the connection attempt.

Studio reuses Snowflake sessions and automatically requests MFA approval caching
in macOS Keychain, for up to four hours when the account permits it. No account
settings are changed. One-time-code mode still prompts for a code before connecting;
push mode can reconnect without another prompt while cached approval is valid. Snowflake authentication policy still applies. A standalone
`serve.py` process cannot use Keychain: open the project through the updated Mac preview.
Local preview identities have separate Keychain stores from the released app.

Snowflake browsing and queries share an authenticated session while the project
server is running. Concurrent requests wait their turn on that connection. MFA
may be needed again after session expiry, changing connection settings, restarting
the project, or cancelling a running query. A failed query is never automatically
rerun. Passwords remain in Keychain; Studio does not save session tokens to the project.

Remote SQL displays up to 1,000 rows. **Save full output…** opens a confirmation
with CSV selected by default. Choose CSV, a DuckDB table, or both; each output
has its own name. Selecting both fetches the remote result once. The dialog shows
the full row count and rough size when available. CSVs save to the project's `exports` folder.
The default transfer budget is 1 GB, adjustable from 1 MB to 100 GB. This is a
transfer limit, not a warehouse scan-cost limit; query cost and timeout settings
still apply. Transfers show progress and can be cancelled. A failure or cancellation
does not publish a partial file or table, and existing destinations are not overwritten.

BigQuery and Snowflake read the original query result without rerunning SQL.
Postgres uses a retained complete result when available; otherwise the dialog
requires acknowledgement before rerunning the SELECT, which may return different
data. Expired remote results fail rather than silently rerunning. Full transfers
stream in batches to disk and have a one-hour limit; sufficient free disk is required.
Notebook inputs retain their separate 100,000-row / 64 MB completeness limits.

BigQuery, Snowflake and Postgres are grouped under **External databases** in the
Data explorer. Collapse this group to make more room for local files and tables.
Each connection has New query, refresh and settings controls. While connecting,
Studio shows credential approval/sign-in guidance; Snowflake push guidance means
check your authenticator if prompted, not that a notification was delivered.
Cached approval may skip the push. A green Connected message confirms the last
successful operation, not a continuously monitored connection.

### Remote queries in notebooks
SQL cells have their own connection selector (Local DuckDB by default). Choose a saved external connection, run one SELECT query, and use the cell name as a dataframe in later Python or R cells. Complete results are copied locally before downstream cells run, up to 100,000 rows / 64 MB; the visible table is still a preview. Oversized or incomplete results block dependent cells. Filter or aggregate remotely, then rerun. Remote SQL runs in the warehouse and cannot join local notebook tables directly.

### Different Google accounts
In BigQuery connection Settings, choose **Authentication profile**. Expand **Add or
reconnect an account**, enter a label, and choose **Add Google account…**. Complete
Google sign-in in your browser, then save the connection. The verified email appears
in settings and under the connection name. Reuse a profile for other projects, or add
a separate profile for another Google account. The Google Cloud CLI must be installed.

To keep your existing Terminal login as an independent profile, choose **Use current
ADC as a profile**. This copies and verifies it without changing Terminal’s ADC. Existing
connections remain on the explicitly labeled shared System ADC until you select a profile.
Google tokens are stored in private files on this Mac, outside the Studio project—not in
browser storage or exported projects. Reconnect an expired profile from settings. Profiles
do not travel with a copied project; choose/add the appropriate profile on another Mac.
The selected connection’s project supplies the quota project and needs the corresponding
Google permissions; the query byte limit still applies.

Connection names turn amber while a request/sign-in is pending, green after success,
and red after failure. Hover or keyboard-focus the name row to reveal Refresh and Settings.
