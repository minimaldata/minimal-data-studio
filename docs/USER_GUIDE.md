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
