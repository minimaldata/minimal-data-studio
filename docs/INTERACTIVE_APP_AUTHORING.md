# Agent authoring guide: interactive apps (Preview)

Studio owns project storage, SQL execution, snapshots, save conflicts, and the
host confirmation for creating result tables. The app owns its interface, local
calculations, and state. Start with `examples/interactive/parameterized-review`
for a self-contained example, or the MDM examples for multi-input workflows.

## Files and versions

Use a project-relative folder with `app.json`, an HTML fragment, listed CSS and
classic JavaScript files, and optional SQL files. There is no bundler, package
installer, network access, or module resolver inside the frame. Never include
credentials or machine-specific paths. Do not edit the user's source SQL while
updating unrelated UI files.

Declare `format: 1`, `apiVersion: 1`, and a positive integer `stateVersion`.
Missing version fields mean 1 for compatibility with the initial prototype.
Unsupported API versions are blocked. A saved document's state version must
match the manifest before its code runs. Studio preserves mismatched state and
provides Download app state; it never silently resets or migrates it. Increase
stateVersion only for incompatible changes. For a migration, back up the project,
transform state explicitly with revision checks, and test both old and new cases.
App code hashes identify changes independently of the state schema version.

## The browser-side API

- `studio.apiVersion`: currently 1.
- `studio.inputs`: loaded, complete named snapshots. Treat them as immutable.
- `studio.state`: the last saved or locally staged app state.
- `studio.context`: API/state versions, code and input hashes, pending parameters,
  and per-input source, timestamp, columns, query hash, and applied parameters.
- `studio.saveState(object)`: stage JSON state, not an immediate explicit save.
- `studio.setInputParameters(object)`: stage declared scalar parameters. The user
  applies them in Data inputs; it does not execute SQL.
- `studio.saveResultsAsTable({suggestedName,description,columns,rows})`: propose
  a snapshot to a host dialog. It never writes without host confirmation and
  cannot replace existing objects. Do not claim success from the call itself.

Use textContent for dataset labels and values. Validate numeric conversions;
SQL decimals and large integers can arrive as strings. Keep missing values
separate from zero. Save assumptions and enough run provenance to identify stale
results. Comparing input/code hashes is useful; refreshing equal data should not
invalidate a result merely because its refresh time changed.

## SQL and refresh

Declare named inputs with required columns/types and SQL file paths. Use `$name`
placeholders with typed parameters; never interpolate strings into SQL. Parameter
values cannot stand in for identifiers. Run SQL previews unsaved text without
applying it. Save SQL writes the source with an optimistic comparison and backup.
Save & refresh commits SQL, then attempts a complete snapshot. If refresh fails,
the old snapshot stays intact even though SQL was saved.

Input queries must be one read-only SELECT. They have a 30-second execution
budget across the input refresh, plus a bounded wait for the project/database
lock. DuckDB interruption is cooperative; this is not a sandbox for hostile SQL.
Limits remain 10,000 rows per input and 1 MB for the combined snapshot. Use SQL
aggregation for large datasets. Keep local controls immediate; explicitly apply
controls that change the source query. Do not label old data with new parameters.

## Saving and recovery

Save document persists inputs, pending parameters and app state; it does not save
SQL drafts. A separate project-local checkpoint preserves unsaved app/SQL work.
Restore requires a matching saved revision. SQL recovery retains the original
source base, so a changed disk file still causes a save conflict. Invalid recovery
files do not replace saved work. Before agent updates, preserve user modifications
and use Studio's writer/revision controls; never patch live saved-state JSON.

## Before handing an app to the user

Check empty and missing inputs, nulls, parameter validation, failed refresh,
unsaved drafts, save/reopen, compatible and incompatible code changes, and a
project copy in another directory. Verify that local controls make no queries.
Review all chart labels, units, denominators and totals. Test narrow and wide
layouts, keyboard access and dark/light appearance. Include a README with the
required sources, calculations, assumptions and supported API/state versions.
