# Inspection tools (development preview)

These tools are not yet in the student download.

- **Copy column names:** use the copy icon beside a table or view in Database, then paste into the editor. Names appear one per line, separated by commas, and remain in schema order (no trailing comma). Names containing spaces or punctuation use SQL double quotes.
- **Inspect a value:** double-click a result or file-preview cell, or focus it and press Enter. The read-only inspector distinguishes NULL from an empty string and reveals escaped text and invisible whitespace.
- **Profile a column:** use the small profile button beside its header. Counts cover the rows returned by the last run, independent of sorting, pagination and display filtering. File previews cover only loaded rows. Includes nulls, empty strings, surrounding whitespace, distinct values and the ten most frequent values.
- **Variables:** after a main-editor Python/R run, expand Variables above the result. It lists up to 100 objects with types, dimensions and bounded previews. Imported dataframes are included. Snapshots can survive an error partway through execution. Each run still starts fresh; these are not persistent, editable runtime objects.

No inspection action edits source data or creates a table. The student baseline stays pinned until explicitly approved for promotion.

## Project controls

Open project, New project and Bring files live in the top project bar, separate from the Run/Format/Save toolbar. Use Choose folder for the native Mac folder picker. The dialog displays the selected path and whether it contains a Studio project. Existing projects are identified by their valid .mdsproject marker or local database. New project creates a new named subfolder and refuses to overwrite an existing folder. A reminder asks you to save code before switching; cancel to return to the editor and use Save if needed.

Each project has its own local server and working directory so existing tabs cannot silently run against a different database. Servers remain available until the app closes, allowing a return to earlier projects. Closing the app stops the project servers it started. The desktop launcher remembers the selected project; this launcher integration is source-only until a future preview build is packaged.

New project uses a native name/location dialog. Sample data and sample notebooks are optional and unchecked by default; choosing notebooks also includes their required sample data. Empty projects contain no example tables, saved queries, notebooks, or dashboards. Creation choices are recorded in `.studio/creation-options.json`, so reopening an empty project does not seed examples later. Existing folders are never overwritten.

## Excel files

Bring an `.xlsx` workbook into Files and open its read-only preview. Choose a sheet and the one-based header row, then click Update preview before Import as table. Import as table opens a dialog with a suggested name and the SQL that will execute. Choose an unused table name; existing table and view names are rejected, including differences in capitalization. Excel imports explain the Python preparation step before the displayed DuckDB SQL runs. All columns import as text to preserve mixed values; dates become ISO text, and Excel display formatting is not retained. Blank rows are skipped; adjusted blank/duplicate headers are shown.

The preview shows up to 100 data rows. Import checks the whole selected sheet and rejects missing saved formula results or Excel errors; Studio never recalculates formulas or edits the original workbook. Formula results must first be recalculated/saved in a spreadsheet application. Limits: 512 columns, 250,000 rows, or 2 million cells. `.xls` and Excel export are not included. These changes have not been packaged or published to students.


## Complete tabular file viewing

Excel, CSV, TSV and Parquet previews scan all rows (within explicit limits of 250,000 rows, 512 columns and 2 million cells), then display 100 rows per page. Previous/Next and Go to data row access the full dataset; Excel additionally shows original worksheet row numbers. Raw text source excerpts retain the separate 1 MB limit. Excel scans actual populated cells rather than trusting worksheet dimensions, includes late unnamed columns with generated names, pads earlier rows, and checks formulas/errors throughout the sheet. Generated header notices are visible and unresolved formula/error findings disable import. Oversized files show an explicit limit error rather than a truncated table.

### Contextual SQL completion

SQL editors and notebook cells suggest relations after FROM/JOIN and columns in
SELECT/WHERE/ON/GROUP BY/ORDER BY. CTE names are labeled CTE; their columns are
inferred from named projections, aliases, explicit CTE column lists, and simple
wildcards, including chained CTEs. Inference reads the query without executing it.
Complex unaliased expressions and advanced wildcard transformations are not fully
resolved; explicit output aliases give the most reliable suggestions. Comments,
string literals, and paste events do not trigger suggestions. Ctrl+Space remains
available after pasting.

Automatic suggestions wait for a 250 ms pause and at least two identifier
characters (or an explicit alias followed by a dot). Spaces, commas, newlines,
SQL keywords, paste and programmatic editor changes do not open suggestions.
Automatic completion also stays quiet when the clause context is unknown;
Ctrl+Space still allows an explicit request. Moving the cursor, blurring the
editor, or pressing Escape cancels pending suggestions.
