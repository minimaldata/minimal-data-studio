# Contributing

Minimal Data Studio is an early-stage local teaching tool. Useful contributions include reproducible bug reports, clearer teaching language, accessibility improvements, tests, and fixes to the file/database workflow.

## Start a change

See [the release policy](RELEASING.md): future builds remain previews until explicitly approved for students. Development changes must not automatically change the student download.

1. Follow the README setup instructions and run the app.
2. Open an issue before a large feature or architecture change so its scope can be discussed.
3. Create a branch for your change and keep the pull request focused.
4. Explain the problem, the new behavior, and how you tested it. Include screenshots for interface changes.

Use synthetic or public data in examples and bug reports. Remove local user names, private paths, student information, and credentials from screenshots and logs. Do not commit `project/`, database files, runtime saved queries, backups, or virtual environments.

## Tests

```sh
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
node --test tests/*.mjs
python3 scripts/check_frontend.py
```

The Python tests create disposable workspaces. Node.js 22 or later is needed for the frontend tests; it is not needed to run the app. The syntax helper checks the frontend module using a temporary file outside the repository.

For UI changes, also check file copy versus table import, duplicate names, paths containing spaces, errors, page reload, and keyboard navigation. Changes involving kernels should be checked in Python and R when R is available. The browser CI job exercises Chromium and Firefox. R execution and native macOS controls still need separate checks.

## Design constraints

- Keep setup and terminology understandable to beginners.
- Distinguish files, tables, views, code, and displayed results.
- Preserve source files and existing database objects on failed operations.
- Use the project folder consistently for relative paths.
- Keep the local, single-user execution model explicit.
- Retain data attribution and third-party notices.

By submitting a contribution, you agree to license it under the repository's MIT license. Please be respectful and make feedback specific and actionable.

Start with [AGENTS.md](AGENTS.md) and [architecture](docs/ARCHITECTURE.md). Run all local checks with `.venv/bin/python scripts/verify.py`.

## Browser tests

```sh
npm ci
npx playwright install chromium firefox
npm run test:browser
```

Use `MDS_TEST_PYTHON=/path/to/python` to select a Python with `requirements.txt` installed; otherwise the suite uses `.venv/bin/python`, then `python3`. Tests start their own loopback servers on assigned ports, with disposable projects and isolated registries. They stop those servers and remove test projects afterward. Never point the suite at an existing project.

GitHub Actions runs both browsers on Linux and uploads reports, screenshots and traces on failure. `npm run test:browser -- --project=firefox` runs one browser. The source UI currently loads pinned CDN assets, so these tests require internet access. Browser dependencies are development-only and are not bundled into the Mac app.
