# Browser regression checks

Use a disposable project and isolated registry. Never use a student's working database. The full checklist supplements `scripts/verify.py`. Core scenarios run through `npm run test:browser` in CI; the remaining scenarios are manual.

1. Open the empty project. Create SQL, Python and R tabs, switch languages, enter indented multiline code. Reload; names, code, active tab and language drafts should return. Results are intentionally not restored.
2. Stop this disposable server and restart the same project on a different port. The same editor drafts should appear. A different empty project must not inherit them.
3. Open the project in two browser windows. The second must be viewing-only and follow saved code. Use Edit here to transfer ownership; the first must stop editing. Unsaved task code must block handoff until saved or closed, and Cancel request must leave the original writer in control. Close the writer and reclaim from the remaining window. Direct stale writes must receive HTTP 423; revision conflicts still protect against external changes.
4. Stop the service while editing. Confirm a visible storage error and a navigation warning. Restart, recover, and verify no code was silently lost.
5. Put an unrelated old draft in browser storage. It must not automatically appear in this project's editor; recovery requires explicit confirmation.
6. Exercise Run, language switching, file preview, notebook output, sidebar and update-link fallback. Check the console for missing module/import errors.

The draft controller and server invariants are automated. `tests/browser/studio.spec.mjs` adds real browser checks using the isolated server fixture in `fixtures.mjs`. Unload edge cases and native controls still require separate manual checks.


Assumption cells: run a dated source cell, add Assumption, select history/date/value,
load history, drag future controls and undo, select named series, edit exact values,
Run, and consume the named table in Python/R. Verify actuals stay fixed, invalid
history is explained, saves survive reload, and edits mark downstream outputs stale.
Legacy Normal cells must retain their mean and deviation as ordinary series. Optional local
R check: `MDS_TEST_R=1 npm run test:browser -- tests/browser/assumptions.spec.mjs`.
