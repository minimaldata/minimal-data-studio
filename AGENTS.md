# Working on Minimal Data Studio

This is the application source. `project-guides/AGENTS.md` is a template for users' analysis projects, not instructions for developing Studio.

## Start here
- Read `docs/ARCHITECTURE.md` for boundaries and persistence contracts.
- Read `CONTRIBUTING.md`, `VALIDATION.md`, and `RELEASING.md` before verification or packaging.
- Inspect the current diff before changing files. Preserve unrelated work.
- Keep development local/preview unless the user explicitly requests publication. Never change release assets or stable feeds as part of an ordinary fix.

## Safety and scope
- Use disposable project folders and an isolated `MDS_PROJECT_REGISTRY` for tests. Do not run migrations, SQL, or destructive tests against a user's project.
- Preserve source files, project data, existing SQL definitions, and unsaved code. Failures must not silently overwrite another window's work.
- Bind the service to loopback. Preserve Origin/Host validation and private-path restrictions.
- Keep credentials out of project files, browser storage, logs, examples, and commits.
- Do not modify installed apps or restart user projects as an incidental test.

## Implementation
- Put reusable frontend behavior in `frontend/*.mjs`; keep DOM wiring in the page. Inject transport/state dependencies so behavior can be tested without scraping source text.
- `frontend/api.mjs` owns common HTTP/session behavior; `frontend/desktop.mjs` owns optional native integration. Browser operation must remain supported.
- Durable state belongs to a project, not its localhost port. Use revision checks for shared edits. Browser preferences are disposable.
- Maintain format compatibility. Any changed saved-work contract must update its guide and tests. Do not automatically import old browser drafts into an arbitrary project.
- Keep remote-source work behind a future connector boundary; do not spread provider-specific credentials or SQL rules through UI handlers.

## Verify and report
Run `.venv/bin/python scripts/verify.py` (Python dependencies and Node required). Add focused regression checks for changed behavior. For UI work, also exercise the browser using a disposable project; see `docs/BROWSER_CHECKS.md`. Native launcher, R, packaging, signing and updater flows require separate checks when affected.

Report what changed, what was actually tested, and remaining limits. Passing unit tests is not evidence that browser, native or release flows were exercised.
