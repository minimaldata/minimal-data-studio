# Project manager (0.2.2 preview)

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

This is separate from the immutable, signed 0.2.1 candidate and is not published.
