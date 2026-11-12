# Validation

## Automated checks

Run the commands in [CONTRIBUTING.md](CONTRIBUTING.md). The suite covers:

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

Browser CI covers Chromium and Firefox: draft persistence across reload/server restart, single-writer handoff, viewing-tab synchronization and stale-write rejection, SQL execution, dropdown anchoring and keyboard interaction, and explorer collapse/resize. R execution is not covered by CI yet. The released Mac app has separate packaging/notarization/update checks; these are not exercised by this command. Windows, large-data performance, assistive technologies, and untrusted multi-user hosting are not covered by this suite. Automated tests passing should not be read as a claim that those configurations are supported.

Editor draft tests cover exact code formatting, restart persistence, project isolation, invalid input, concurrent save serialization and conflict recovery. See `docs/BROWSER_CHECKS.md` for browser-specific verification.
