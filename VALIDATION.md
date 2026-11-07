# Validation

## Automated checks

Run the commands in [CONTRIBUTING.md](CONTRIBUTING.md). The current suite contains 15 Python tests and 2 Node tests, covering:

- Persistent CREATE/UPDATE/ALTER/DROP, restart recovery, explicit rollback, and temporary-table isolation.
- Legacy table/view migration ordering, collision preservation, retained originals, and failed-migration retry.
- Arrow snapshots, large integers, decimal values, nulls, and empty schemas.
- File copy without table import, numbered duplicates, relative SQL reads, file/table independence, traversal and outside symlink rejection.
- HTTP Origin/Host checks, private paths, saved-work version conflicts, and backup retention.
- Partial copy failures and retry state in the browser handler.

Tests operate in disposable workspaces rather than the user's running database.

## Manual browser verification

The development build has been exercised on macOS for:

- SQL/Python/R editor execution and language draft preservation.
- Table snapshots, live views, imports, reload and server restart.
- Notebook SQL filters, Python charts, R tables, and presentation mode.
- Separate Files and Database sections, the bring-file confirmation, full and relative paths, and table import.
- Reading the same project-relative CSV in SQL, Python and R; Python/R report the project working directory.

## Limits

Browser flows and R are not covered by CI yet. Windows, packaged desktop builds, large-data performance, assistive technologies, and untrusted multi-user hosting have not been validated. Automated tests passing should not be read as a claim that those configurations are supported.
