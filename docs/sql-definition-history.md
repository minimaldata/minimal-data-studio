# SQL definition history (preview)

Database combines tables and views. Use the Open button (shown on hover or keyboard focus) to open its reusable
SQL editor with results underneath. History expands from its bottom-right corner. Clicking the name expands columns; Copy name
copies the quoted SQL name to the clipboard; Copy columns copies the column list.

The object editor accepts one SELECT query, including WITH. Applying can create a view
or materialize a table under the same name. Replacement and its history entry
are transactional. Failed SQL leaves the old object and SQL version intact.
Concurrent edits must reload before applying over a newer version. Dependencies
are never dropped with CASCADE.

Versions records SQL text, recording time, output kind and a diff against the
previous SQL version. Reset to this version loads the historical SQL into the editor without executing
it or changing the saved object. Run preview inspects its output; Apply changes
executes the reviewed SQL using current source data and appends a new version. This is not data versioning: INSERT/UPDATE/DELETE and
manual changes to source files are not tracked, and old result rows are not saved.

SQL executed through Studio's editor captures view definitions and straightforward
CREATE TABLE ... AS queries. Tables saved from SQL results retain their source
query. Existing views can expose their current catalog definition; previously
created tables cannot recover their original SELECT. Imported files and CSV
drafts show provenance, not invented SQL or data snapshots. They have no SQL
versions until a SELECT definition is supplied.

History is stored in `_studio.definition_versions` in the project's DuckDB file.
History is scoped to each object's lifetime; dropping and recreating a name starts
a new history. Historical versions are retained internally after deletion but
are not a deleted-object recovery interface. SQL changed outside Studio is only
observed when its catalog definition changes; intermediate external edits cannot
be reconstructed.

## Organizational Database folders (preview)

Use + beside Database to create folders (a path such as `Lessons/Trees` creates
subfolders). Folder actions create a child, rename/move its path, or remove the
folder tree. Removing folders moves their objects up to the parent; it never
removes a table or view. Drag an object or folder header onto a folder (or Database root). Folder moves
include every subfolder and object; self/descendant drops and name collisions
are blocked. For objects, you can also open one and use
**Move to folder…**. The move dialog also offers Database root.

Folders and object assignments persist in the project's DuckDB `_studio`
metadata. They do not create schemas, move data files, or change SQL names.
Table/view names remain case-insensitively unique throughout `main`. Import,
draft creation, result creation, and ordinary SQL duplicate-name errors identify
the existing object's type and organizational folder. New objects start at root.

## Notebook output snapshots (preview)

Successful SQL, Python, and R cell outputs offer **Create table…**, with a table
name and Database folder picker. This copies the complete session result into a
persistent table, including rows beyond the displayed preview. Duplicate names
are rejected with the existing object's location. Rerunning the notebook does
not update a saved snapshot.

Changes to cell code, filter values, or upstream notebook outputs require a rerun
before creation. The dialog explains stale output and offers to rerun the notebook.
This check does not detect external changes to source tables or files.
Snapshot metadata records the notebook, cell, language, and run time; it does not
claim the cell SQL is an independently reusable definition. Views are not offered.

Objects without a saved SQL definition open as data previews. Their origin is
shown, but SQL editing, Apply changes, materialization changes, and SQL restore
are unavailable. The server enforces the same rule before modifying an object.
To transform an import or snapshot, use a separate query and create a new table.
