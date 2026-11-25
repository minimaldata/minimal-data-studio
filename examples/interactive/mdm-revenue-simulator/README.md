# MDM revenue scenarios

Attach this folder. The declared `history` input automatically uses
`queries/history.sql`, selecting from the local `saas_subscription_kpis` view.
Refresh explicitly. The view supplies month_end and mrr_usd; decimal values arrive
as strings and this illustrative simulator converts them to JavaScript numbers.

Scenario assumptions, names, and latest results live in Studio's document state,
not these agent-maintained files. Run each scenario and Save document. Results
record code and input hashes, baseline, assumptions and capture time. Stale results
remain inspectable and are never silently replaced. This example retains the last
run per scenario, not a full immutable run archive. Up to eight scenarios supported.

This is monthly compound MRR growth from the latest historical month. ARR is a
run-rate calculation, not recognized revenue. It inherits the SaaS views' billing
and classification assumptions; it does not independently validate MDM data.

Last run details show the captured assumptions, baseline, timestamp, input fingerprint
and monthly result values. Outdated notices distinguish input, assumption and code
changes. Refreshing identical data does not invalidate a result. Saving after a
refresh preserves previous results with their original fingerprints on reopen.

The app.json input contract declares Historical recurring revenue (`history`),
requiring month_end as a date/timestamp and mrr_usd as numeric. Use Inspect SQL
in Data inputs to read the query; Studio checks the schema when refreshing.

Save results as table exports the selected scenario’s last calculated rows through
a Studio confirmation dialog. Choose a new table name; existing tables/views
are never overwritten. Run provenance and outdated status are included in rows.
