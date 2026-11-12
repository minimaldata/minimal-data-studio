# Manual tasks (local preview)

Tasks has its own Explorer tab. Query history lives in Analyses. Create a task to open a blank Python editor tab, or choose an existing project Python file in Task settings. New names suggest `scripts/name.py`. Save script writes the actual file; Save and run saves before starting. Settings and credential access are collapsible, with logs and run history below the editor. Unsaved buffers remain when switching tabs, and closing a dirty tab or leaving the page warns first. Script saves compare the loaded SHA-256 against the current file, rejecting stale edits rather than overwriting them. Run executes a snapshot of that file with the project's selected Python and the project folder as its working directory. Only one run of a given task can be active; different tasks may run concurrently.

Stop terminates the process group, escalating after two seconds. Files or external changes already made are not rolled back. Tasks are ordinary local Python processes, not a sandbox. They must not open the active Studio DuckDB file for independent writes; write an output file for subsequent import instead.

## Credential access

The Credentials indicator beside Run opens Task settings. Declare required environment names explicitly (for example `CFBD_API_KEY`); Studio does not infer requirements from Python source. Missing required bindings disable Run, and the server independently checks requirements and connected credential IDs before starting a process. Requirements can be saved while incomplete.

Manage credentials opens the native credential manager for the server’s project through its private launcher pipe; the browser cannot choose an arbitrary project path. After connecting keys, use Check credentials to refresh metadata without losing unsaved script edits. Select the keys and environment variable names in the task. The indicator turns green for connected selections and red for missing required or disconnected selected keys. Connection does not imply execution approval. The first run requests native approval showing the project, script, Python path and bindings. Repeat runs reuse that grant. Changing the main script bytes, runtime path or bindings requires another approval. Imported code is not separately fingerprinted: approve only scripts and dependencies you trust.

`TaskCredentials.swift` validates the project and script fingerprint and reads approved values from Keychain. `task_runner.NativeCredentials` communicates over the server's inherited stdin/stdout pipes, never HTTP. Values are supplied only to that task's child environment. Credential lists sent to the browser contain metadata, not values. Standalone/detached development servers cannot fetch Keychain values; open the project through the updated Mac preview for credential-backed execution.

Disconnecting a credential from the project prevents future resolution. Stopping a running process cannot revoke a credential already handed to that process. Reveal in the credentials manager still requires its own macOS authentication; normal approved task runs do not invoke Reveal.

Exact known secret values are redacted from streamed logs, including across chunks. Encoding or transforming a secret can defeat this redaction. Scripts can send secrets elsewhere or write them to files, so redaction is not a security sandbox.

## Persistence and implementation

- `frontend/tasks.mjs`: editor tabs, task list, polling, logs and revision-aware saves.
- `task_runner.py`: definitions, process lifecycle, environment construction and log redaction.
- `serve.py`: same-origin task endpoints and shutdown integration.
- `.studio/tasks.json`: revision and definitions (names, script paths, credential IDs/environment names only).
- `.studio/task-runs.json`: last 30 completed runs plus active runs, metadata and up to 100,000 trailing log characters each. No credential values or script snapshots are stored here.
- Native UserDefaults: grants keyed by project filesystem identity, task ID, script fingerprint, runtime path and bindings. Project copies do not inherit grants.

Run records include timestamps, status, duration, exit code and script hash. Interrupted runs are marked on restart. Task saves reject stale revisions to protect against another browser window's changes.

Interactive stdin, automatic retries, and direct database ingestion remain outside this version. Tests cover process stop, overlap prevention, environment isolation, redaction, rejected grants and persistence; browser tests cover creating, running, stopping and reopening tasks in Chromium and Firefox. Native credential resolution is also smoke-tested separately with a dummy Keychain item.


## Schedules (local preview)

Schedules run inside the project server while Studio is open and the Mac is awake. No launchd/cron job is installed. Each task offers an interval (1–10,080 minutes), daily time, or weekly day/time. Calendar schedules store an explicit IANA time zone. Nonexistent spring-forward times are skipped; ambiguous fall-back times run once.

Run the saved script successfully by hand before enabling a schedule. The scheduler remembers that script/runtime/credential fingerprint independently of bounded run logs. Changes to saved code, runtime path or credential bindings pause the schedule and require another successful manual run. Imported dependencies are not fingerprinted, as with manual credential grants. Unsaved editor text is never executed on a schedule.

`task_schedule.py` owns validation, next-run calculation and ticking. `.studio/task-schedules.json` stores schedule revisions, configuration, next due times, missed-event notices and successful manual-run fingerprints; no secret values. The polling loop runs every two seconds. Restart, sleep gaps, or a run more than 60 seconds late advance to a future occurrence without catching up. If a task is already active, that scheduled occurrence is skipped, with a notice. Pause does not cancel a currently running process; Stop does.

Scheduled runs cannot request a new native credential grant. A missing grant, disconnected key or run failure pauses the schedule. Logs distinguish scheduled runs from manual ones. Run now uses the normal manual flow, including credential approval where needed. Resume computes a new future occurrence and does not replay missed work. A schedule applies only to saved files and never updates imported tables automatically.
