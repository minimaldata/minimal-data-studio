# Interactive apps Preview: release gate

## Automated coverage in this pass

- Typed SQL binding, invalid parameters and injection-shaped values.
- Complete snapshot limits, missing columns, failed queries, create-only outputs.
- Query interruption and subsequent connection reuse.
- App API/state version checks and state export for incompatible code.
- Missing app folders do not block saving unrelated work.
- Save/reopen of inputs, controls, notes, assumptions and results.
- Unsaved SQL and app-state recovery across reload and server restart.
- Old recovery cannot replace a newer saved revision.
- Failed checkpoint writes remain visible; explicit save errors preserve prior data.
- Project copy to a different directory preserves sources and saved state.
- Iframe origin/network isolation; host confirmation for table writes.
- Packaged Python allowlist includes all interactive backend modules.

Tests: `tests/test_interactive_documents.py`, `tests/test_interactive_inputs.py`,
`tests/test_server.py`, and the interactive/executive browser suites. Run the
required `scripts/verify.py` checks as well. Source inspection is not a substitute
for the following native and release checks.

## Still required before publishing

Use disposable projects and dummy credentials only.

- Build the signed release candidate and open all three folder examples inside
  the native WKWebView. Verify reload, fullscreen, keyboard editing, source
  inspection, downloads, create-table confirmation, and dark/light appearance.
- Exercise native reload with unsaved SQL, an app state edit, an in-flight refresh,
  and a simulated write failure. Confirm warning/recovery paths without data loss.
- Copy the sample project to another Mac. Confirm local sources, SQL, snapshots
  and state survive; external credential/connection requirements stay explicit.
- Download the published candidate artifact through a browser so quarantine is
  present. Verify the exact app and installer signatures, stapling and Gatekeeper
  acceptance on a clean account/Mac. Do not waive warnings based on local launch.
- Check the archive contains no user projects, live recovery data or credentials.
- Use the “Preview” label and document the API/state contract and limits.

## Local candidate check — 2026-11-25

The isolated candidate is `0.8.0-preview.2`, build 18; this is not a published
version or a commitment to the next stable version number. Build 17 is superseded:
native inspection found that its navigation policy blocked `about:srcdoc` and
left interactive apps blank. The fix permits only `about:blank`/`about:srcdoc`
in child frames; main-frame navigation remains restricted. Native policy tests
cover both the allowed and rejected cases.

Verified on this Mac:

- Developer ID signing and relocated-bundle verification; bundled Python/R,
  R plots, SQL tables/views and restart persistence on disposable projects.
- The actual ProjectWindow controller in an isolated native QA harness rendered
  the parameterized starter, including saved parameters, notes and rows.
- Native fullscreen, note editing/save, app reload, input refresh, inline SQL
  inspection/run and preview results. Saved notes and snapshot were inspected
  in the disposable project's persisted document.
- A deliberately incompatible state version blocked app execution; its native
  download dialog exported the original state and version intact.
- A portable synthetic project ZIP includes app source, saved state, parameters,
  snapshots and refresh metadata, without user data or connections.

This does **not** mark the full native matrix above complete: the QA harness is
not an end-to-end run of the installed launcher. All-three-example checks,
keyboard shortcuts, failure/reload cases, clean-Mac Gatekeeper and another-Mac
portability remain release gates. Apple notarization, app/installer stapling and
download verification must be recorded for the final artifact before release.

## Explicit limitations

This runs reviewed, locally authored app code, not arbitrary untrusted plugins.
SQL remains a host-side capability; read-only SELECT is not a complete file-access
sandbox. Input queries use a cooperative execution deadline, not a killable worker
process. There is no dedicated cancel control, remote parameterized input API,
automatic saved-state migration, append/replace table mode, or plugin marketplace.
Do not promise these in release notes.

## Preview distribution record

On 2026-11-25 Apple accepted build 18's application submission
`d5614c12-5686-4c55-b7c6-8ebf6e326605` and installer submission
`07d9eabc-096f-421d-8f18-57e3ba37e41d`. Both tickets were stapled and validated;
Gatekeeper accepted both artifacts as Notarized Developer ID.

All three folder examples rendered in the native ProjectWindow integration
harness against the packaged launcher’s isolated QA project. The MDM simulator
generated results and the starter’s notes were verified in persisted state.
The full browser run initially passed 376/380 checks. The four failures exposed
test assumptions: a hidden first CodeMirror, coordinates captured before chart
layout finished, and checking a handoff before its reload completed. Targeted
checks passed 18/18 across three repetitions in Chromium and Firefox after fixing
those tests; application payloads were unchanged.

The user authorized an opt-in Preview release. This does not promote the student
baseline or certify the outstanding clean-second-Mac and physical input checks.
The native UI-control service timed out during the additional manual matrix;
those interrupted checks are not counted as passes. Keep these limitations in
Preview release notes and complete them before stable promotion.
