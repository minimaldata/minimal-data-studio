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

Queries, notebooks, dashboard layouts, folders, and shared chart colors live in `project/saved_queries.json`. Writes use file versions, atomic replacement, and backups. Editor drafts, history, and preferences currently use browser localStorage.

Project file copies and table imports are separate operations. The file browser resolves paths within the project, rejects outside symlinks and managed files, and copies incoming files without overwriting. Executed code is not sandboxed.

Legacy tables/views and the previous native database are migrated without deleting their originals. Successful imports are recorded so a deliberate DROP is not reversed by a later startup. The user guide covers migration and backups.
