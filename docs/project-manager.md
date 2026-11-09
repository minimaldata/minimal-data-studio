# Project manager (0.2.2)

The native launcher lists verified running projects by name and full folder path.
Open returns to the workspace; Start reopens a stopped project. Stop asks the user
to save code and finish queries, then shuts down only that project. Saved files
and tables stay in place. Quit stops projects owned by that launcher, including
projects opened from browser controls; projects owned by another instance stay up.

Servers advertise into a per-user registry with private permissions. Health
checks verify the exact canonical project path. A lifetime file lock is acquired
before seeding files or opening DuckDB; concurrent starts reconnect to the same
server. Symlink paths resolve to the same project. Older servers without this
registry are not discoverable; DuckDB still rejects conflicting database access.
Stop requires a random per-server token and a loopback Host. No PID-based killing
is used for discovered servers. Runtime files/ports are not project identities.

Browser tabs heartbeat independently, including duplicated tabs. The workspace
shows when another tab is present, and gives recovery instructions if disconnected.
Saved queries/notebooks/dashboards require an exact file version for every save;
client IDs and force headers cannot bypass the comparison. A conflict offers
Reload latest (with a warning) or Save this tab as copies. Copies are appended to
the latest saved work with new IDs in a Recovered folder; dashboard query links
are remapped to the copied queries. CSV drafts and SQL definitions retain their
existing revision checks. Arbitrary SQL execution is not a versioned data editor.

Open may create another browser tab: native apps cannot reliably focus a matching
tab across every browser. Conflict checks provide protection regardless of tab
count. Closed tabs age out of the presence notice after 20 seconds.

Introduced in 0.2.2. Project data remains outside the application bundle.

The launcher also offers New project with sample-data/notebook choices, recent projects persisted in app preferences, and Finder shortcuts. Database size is the DuckDB file size on disk (not RAM). Running projects supply live user table/view counts; stopped projects show cached counts marked last opened. Metadata checks skip a busy database rather than blocking queries. New project creates a new folder and never replaces an existing folder.

Runtime status offers Check all, Details / Troubleshoot, and Update Studio. Checks use the most recently opened running project (otherwise the first running project) and label the project and completion time. The probe uses real HTTP session/query, kernel upload/run/result endpoints, validates SQL results and Python/R Parquet transformations, and closes its temporary SQL session. It does not change user tables. Checks run automatically when a project opens or reopens, after its server is ready. Check all remains available for retries. Passing runtimes display green checkmarks, failures red crosses, and pending checks a neutral ellipsis. Results are snapshots; a later project check supersedes an earlier check so delayed results cannot replace the current status. A stopped or unreachable server reports connection failures for all runtimes. The details show selected runtime versions/modes and the failed stage. Bundled runtime updates use the existing Sparkle updater; custom installations are configured in workspace Help.

Python and R selectors in the manager share the workspace Help settings stored in each project’s `.studio/runtimes.json`. They offer Studio-managed, detected executable paths, and Choose installation. Selecting an environment saves through the server and reruns the end-to-end checks. The selected project is labeled above the controls. Invalid executable choices leave the prior setting intact and show an error; missing packages appear as failed checks. SQL continues to use bundled DuckDB.

Runtime controls are collapsed by default beneath a green All Systems Operational or red Error summary. Pending checks show Checking systems…; before checks they show Not checked. Expanding reveals the existing checks and nested Advanced settings.
