import csv
import uuid
import socketserver
import signal
import argparse, threading, base64, functools, glob, hashlib, http.server, json, os, re, shutil, subprocess, sys, tempfile, time, urllib.parse

root = os.path.realpath(os.path.dirname(__file__))
# Keep the familiar `python3 serve.py` launcher when the project environment exists.
try:
    import duckdb
    import pyarrow
except ImportError:
    venv_python = os.path.join(root, ".venv", "bin", "python")
    if os.path.exists(venv_python) and os.path.abspath(sys.executable) != venv_python:
        os.execv(venv_python, [venv_python, __file__, *sys.argv[1:]])
    raise SystemExit("Install dependencies with .venv/bin/python -m pip install -r requirements.txt")
from workspace_db import Workspace, ident
from project_files import ProjectFiles
from runtime_setup import RuntimeSetup
from project_launcher import ProjectLauncher, ServerLease
from draft_data import handle as handle_draft

parser = argparse.ArgumentParser(description="Run the local Minimal Data Studio workspace")
parser.add_argument("--port", type=int, default=8791)
parser.add_argument("--data-dir", default=os.environ.get("SQL_LAB_DATA_DIR", os.path.join(root, "data")))
parser.add_argument("--project-dir", default=os.path.join(root, "project"))
parser.add_argument("--seed-project", action="store_true", help="Copy bundled sample files into a new desktop project")
args = parser.parse_args()
port = args.port
os.environ.setdefault("R_LIBS_USER", os.path.join(root, ".venv", "R-library"))
data_root = os.path.realpath(os.path.expanduser(args.data_dir))
project_root = os.path.realpath(os.path.expanduser(args.project_dir))
if not os.path.isdir(project_root) and ('--project-dir' in sys.argv or project_root != os.path.join(root, 'project')):
    raise SystemExit(f'Project folder not found: {project_root}\nIt may have been moved or renamed. Choose its current location with Open project; the old folder will not be recreated.')
lease = ServerLease(project_root)
reused_url = lease.acquire()
if reused_url:
    if os.environ.get('MDS_READY_FILE'):
        with open(os.environ['MDS_READY_FILE'], 'w') as ready:
            json.dump({'url':reused_url}, ready)
    print(f'Minimal Data Studio: {reused_url.rstrip("/")}', flush=True)
    print('MDS_REUSED', flush=True)
    lease.close()
    raise SystemExit(0)
project_files = ProjectFiles(project_root)
options_file = os.path.join(project_root, '.studio', 'creation-options.json')
creation_options = json.load(open(options_file)) if os.path.exists(options_file) else None
# Migrate the previous single workspace only into the default project. Keep originals.
if project_root == os.path.join(root, "project"):
    old_db = os.path.join(root, ".studio", "workspace.duckdb")
    new_db = os.path.join(project_root, ".studio", "workspace.duckdb")
    if os.path.exists(old_db) and not os.path.exists(new_db):
        with duckdb.connect(old_db) as old:
            old.execute("CHECKPOINT")
        shutil.copy2(old_db, new_db)
if (creation_options and creation_options.get("sampleData")) or (creation_options is None and (args.seed_project or project_root == os.path.join(root, "project"))):
    if not os.path.exists(os.path.join(project_root, "data", "iris.csv")) and not os.path.exists(os.path.join(project_root, ".studio", "files-seeded")):
        for name in os.listdir(data_root):
            source = os.path.join(data_root, name)
            target = os.path.join(project_root, "data", name)
            if os.path.isfile(source) and not os.path.exists(target):
                shutil.copy2(source, target)
        open(os.path.join(project_root, ".studio", "files-seeded"), "w").close()
SAVED_PATH = "/saved_queries.json"
SAVED_FILE = os.path.join(project_root, "saved_queries.json")
BACKUP_DIR = os.path.join(project_root, "backups")
save_lock = threading.Lock()
if not os.path.exists(SAVED_FILE):
    old_saved = os.path.join(root, "saved_queries.json")
    seed = old_saved if project_root == os.path.join(root, "project") and os.path.exists(old_saved) else os.path.join(root, "examples", "saved_queries.json")
    if creation_options is None:
        shutil.copyfile(seed, SAVED_FILE)
    else:
        examples = json.load(open(seed)) if creation_options.get('sampleNotebooks') else {}
        with open(SAVED_FILE, 'w') as saved_file:
            json.dump({'queries': [], 'notebooks': examples.get('notebooks', []), 'dashboards': []}, saved_file)
os.chdir(project_root)  # Native SQL resolves relative reads and writes from the project.
workspace = Workspace(root, data_root, project_root, migrate_legacy=project_root == os.path.join(root, "project"), seed_samples=creation_options is None or creation_options.get("sampleData", False))
runtimes = RuntimeSetup(root, project_root)
KEEP_BACKUPS = 50
presence = {}

KERNELS = os.path.join(root, "kernels")
RUNS_DIR = os.path.join(tempfile.gettempdir(), "sql-lab-runs")
RUN_TIMEOUT = 600  # seconds
MAX_INPUT = 1_000_000_000  # bytes per uploaded table


project_operation_lock = threading.RLock()

def missing_project_message():
    return f'Project folder not found: {project_root}. It may have been moved or renamed. Use Open project to choose its current location.'

def project_operation(function):
    @functools.wraps(function)
    def guarded(self, *a, **kw):
        with project_operation_lock:
            path = self.path.split('?')[0]
            recovery = path in ('/manager/stop', '/db/session', '/db/close', '/db/project/folders', '/db/project/choose-folder', '/db/project/switch')
            if not os.path.isdir(project_root) and not recovery:
                return self.send_json({'error': missing_project_message()}, 409)
            return function(self, *a, **kw)
    return guarded

def rename_project(name):
    global project_root, project_files, workspace, runtimes, SAVED_FILE, BACKUP_DIR
    if not isinstance(name, str) or not name.strip() or name != name.strip() or name in ('.', '..') or '/' in name or '\\' in name:
        raise ValueError('Enter a folder name without slashes or surrounding spaces.')
    if not os.path.isdir(project_root):
        raise ValueError(missing_project_message())
    previous = project_root
    destination = os.path.join(os.path.dirname(previous), name)
    if destination == previous:
        return {'project': previous, 'renamed': False}
    if os.path.lexists(destination):
        raise ValueError('A file or folder already has that name. Choose a different name; nothing was changed.')
    # Finish durable database writes before moving the folder. All HTTP mutations are serialized.
    runtimes.close()
    workspace.close()
    try:
        os.rename(previous, destination)
    except OSError as error:
        workspace = Workspace(root, data_root, previous, migrate_legacy=False, seed_samples=False)
        runtimes = RuntimeSetup(root, previous)
        raise ValueError(f'Could not rename the project: {error}. Reload the page to reconnect.')
    project_root = destination
    lease.project = destination
    os.chdir(destination)
    project_files = ProjectFiles(destination)
    SAVED_FILE = os.path.join(destination, 'saved_queries.json')
    BACKUP_DIR = os.path.join(destination, 'backups')
    workspace = Workspace(root, data_root, destination, migrate_legacy=False, seed_samples=False)
    runtimes = RuntimeSetup(root, destination)
    project_launcher.remap(previous, destination, f'http://localhost:{port}/')
    project_launcher._selected(destination, f'http://localhost:{port}/')
    return {'project': destination, 'renamed': True}


def version():
    try:
        with open(SAVED_FILE, "rb") as f:
            return hashlib.sha1(f.read()).hexdigest()
    except FileNotFoundError:
        return "none"


def backup():
    if not os.path.exists(SAVED_FILE):
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S") + f"-{time.time_ns()}"
    shutil.copy2(SAVED_FILE, os.path.join(BACKUP_DIR, f"saved_queries-{stamp}.json"))
    for old in sorted(glob.glob(os.path.join(BACKUP_DIR, "saved_queries-*.json")))[:-KEEP_BACKUPS]:
        os.remove(old)


def python_exe():
    return runtimes.selection("python")


def rscript_exe():
    return runtimes.selection("r")


def r_literal(p):
    """A filter value as R code: dates as Date, multi-choice as a character vector."""
    v, kind = p.get("value"), p.get("kind")
    s = lambda x: '"' + str(x).replace("\\", "\\\\").replace('"', '\\"') + '"'
    if v is None or v == "":
        return "NULL"
    if kind == "multi":
        return "c(" + ", ".join(s(x) for x in v) + ")" if v else "character(0)"
    if kind == "date":
        return f"as.Date({s(v)})"
    if kind == "number":
        return str(float(v))
    return s(v)


def run_dir(run_id):
    if not re.fullmatch(r"[\w-]{8,64}", run_id or ""):
        raise ValueError("bad run id")
    return os.path.join(RUNS_DIR, run_id)


def clean_old_runs():
    for d in glob.glob(os.path.join(RUNS_DIR, "*")):
        if time.time() - os.path.getmtime(d) > 3600:
            shutil.rmtree(d, ignore_errors=True)


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        clean = urllib.parse.unquote(urllib.parse.urlsplit(path).path)
        if clean == SAVED_PATH:
            return SAVED_FILE
        if clean.startswith("/project/"):
            return os.path.join(root, "__not_found__")
        if clean.startswith("/data/"):
            target = os.path.realpath(os.path.join(data_root, clean[len("/data/"):]))
            if os.path.commonpath([data_root, target]) != data_root:
                return os.path.join(root, "__not_found__")
            return target
        # Do not expose the environment, Git metadata or automatic backups.
        if any(part.startswith(".") or part == "backups" for part in clean.split("/") if part):
            return os.path.join(root, "__not_found__")
        return super().translate_path(path)

    def end_headers(self):
        if self.path.split("?")[0] in (SAVED_PATH, "/saved-work-copy"):
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Version", version())
        elif self.path.startswith("/db/") or self.path.split("?")[0] == "/relations":
            self.send_header("Cache-Control", "no-store")
        else:  # recheck on every load (a quick 304 when unchanged), so rebuilt data and editor changes show up
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def from_editor(self):
        """Requests must come from the editor page on this machine: other websites can't set Origin to
        localhost, and the Host check stops DNS-rebinding tricks."""
        origin = urllib.parse.urlparse(self.headers.get("Origin", ""))
        host = self.headers.get("Host", "")
        return origin.hostname in ("localhost", "127.0.0.1") and origin.port == port and host in (f"localhost:{port}", f"127.0.0.1:{port}")

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path, _, query = self.path.partition("?")
        if path == SAVED_PATH:
            with save_lock:
                with open(SAVED_FILE, 'rb') as saved_file:
                    return self.send_binary(saved_file.read(), 'application/json')
        if path == "/app-info":
            return self.send_json({"native_updater": os.environ.get("MDS_NATIVE_UPDATER") == "1", "version": os.environ.get("MDS_APP_VERSION", "Preview")})
        if path == "/project-metadata":
            if self.headers.get("Host", "") not in (f"localhost:{port}", f"127.0.0.1:{port}"):
                return self.send_error(403)
            if not workspace.lock.acquire(blocking=False):
                return self.send_json({"busy": True})
            try:
                objects = workspace.catalog_objects(workspace.connection).values()
                return self.send_json({"tables": sum(o['kind'] == 'table' for o in objects),
                                       "views": sum(o['kind'] == 'view' for o in objects)})
            finally:
                workspace.lock.release()
        if path == "/project-health":
            if self.headers.get("Host", "") not in (f"localhost:{port}", f"127.0.0.1:{port}"):
                return self.send_error(403)
            return self.send_json({"app": "minimal-data-studio", "project": hashlib.sha256(os.fsencode(str(project_root))).hexdigest()})
        if path.startswith("/db/"):
            return self.database_request("GET")
        if path == "/relations":
            return self.send_json({"error": "Storage has moved to DuckDB. Reload the editor."}, 410)
        if path != "/kernel/result":
            return super().do_GET()
        q = urllib.parse.parse_qs(query)
        try:
            f = os.path.join(run_dir(q.get("run", [""])[0]), "result.parquet")
        except ValueError:
            return self.send_error(400)
        if self.headers.get("Host", "") not in (f"localhost:{port}", f"127.0.0.1:{port}") or not os.path.exists(f):
            return self.send_error(404)
        with open(f, "rb") as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    @project_operation
    def do_POST(self):
        if self.path == '/manager/stop':
            if self.headers.get('Host', '') not in (f'localhost:{port}', f'127.0.0.1:{port}') or not __import__('hmac').compare_digest(self.headers.get('X-Studio-Token', ''), lease.token):
                return self.send_error(403)
            self.send_json({'stopping': True})
            threading.Thread(target=server.shutdown, daemon=True).start()
            return
        if self.path == '/workspace-presence':
            if not self.from_editor():
                return self.send_error(403)
            key = self.headers.get('X-Client', '')
            if not key or len(key) > 100:
                return self.send_error(400)
            now = time.monotonic()
            presence[key] = now
            for other in list(presence):
                if now - presence[other] > 20:
                    del presence[other]
            return self.send_json({'tabs':len(presence)})
        if self.path.startswith("/db/"):
            return self.database_request("POST")
        if self.path.split("?")[0] == "/relations":
            return self.send_json({"error": "Storage has moved to DuckDB. Reload the editor."}, 410)
        if self.path.split("?")[0] in (SAVED_PATH, "/saved-work-copy"):
            with save_lock:
                return self.handle_post()
        return self.handle_post()

    @project_operation
    def do_DELETE(self):
        if self.path.startswith("/db/"):
            return self.database_request("DELETE")
        return self.send_json({"error": "Reload the editor to use the local database."}, 410)

    def send_binary(self, body, content_type="application/octet-stream"):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    @project_operation
    def database_request(self, method):
        if method != "GET" and not self.from_editor():
            return self.send_error(403)
        if self.headers.get("Host", "") not in (f"localhost:{port}", f"127.0.0.1:{port}"):
            return self.send_error(403)
        path, _, query = self.path.partition("?")
        q = urllib.parse.parse_qs(query)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 <= length <= MAX_INPUT:
                return self.send_error(413)
            body = self.rfile.read(length) if method == "POST" else b""
            if path.startswith("/db/runtime/") or path.startswith("/db/terminal/"):
                if method != "POST":
                    return self.send_error(405)
                key = q.get("session", [""])[0]
                with workspace.lock:
                    workspace.session(key)
                req = json.loads(body or b"{}")
                if path == "/db/runtime/check":
                    return self.send_json(runtimes.check(req["language"]))
                if path == "/db/runtime/select":
                    return self.send_json(runtimes.choose(req["language"], req["mode"], req.get("path", "")))
                if path.startswith("/db/terminal/"):
                    return self.send_json(runtimes.terminal(key, path.rsplit("/",1)[1], req))
                return self.send_error(404)
            with workspace.lock:
                if path == "/db/session" and method == "POST":
                    info = workspace.new_session()
                    if not os.path.isdir(project_root):
                        info["warnings"] = info["warnings"] + [missing_project_message()]
                    info["canOpenFinder"] = sys.platform == "darwin"
                    return self.send_json(info)
                key = q.get("session", [""])[0]
                session = workspace.session(key)
                if path.startswith("/db/drafts/") and method == "POST":
                    return self.send_json(handle_draft(workspace, session, path.rsplit("/", 1)[1], json.loads(body)))
                if path == "/db/close" and method == "POST":
                    runtimes.stop_terminal(key)
                    workspace.close_session(key)
                    return self.send_json({"closed": True})
                if path == "/db/project/rename" and method == "POST":
                    return self.send_json(rename_project(json.loads(body).get("name")))
                if path == "/db/project/choose-folder" and method == "POST":
                    return self.send_json(project_launcher.pick_folder(json.loads(body).get("path", project_root), json.loads(body).get("mode") == "create"))
                if path == "/db/project/folders" and method == "GET":
                    return self.send_json(project_launcher.folders(q.get("path", [project_root])[0]))
                if path == "/db/project/switch" and method == "POST":
                    req = json.loads(body)
                    if req.get("mode") not in ("open", "create"):
                        raise ValueError("Choose Open or Create project.")
                    return self.send_json(project_launcher.open(req["path"], req["mode"] == "create", req.get("name", ""), req.get("sampleData", False), req.get("sampleNotebooks", False)))
                if path == "/db/project/open-folder" and method == "POST":
                    if sys.platform != "darwin":
                        return self.send_json({"error": "Open in Finder is available on macOS."}, 400)
                    opened = subprocess.run(["/usr/bin/open", "-a", "Finder", project_root], capture_output=True, text=True, timeout=10)
                    if opened.returncode:
                        return self.send_json({"error": "Could not open the project folder in Finder."}, 400)
                    return self.send_json({"opened": True})
                if path == "/db/notebook/create-table" and method == "POST":
                    return self.send_json(workspace.create_notebook_table(session, json.loads(body)))
                if path == "/db/database-folders" and method == "POST":
                    return self.send_json(workspace.database_folders(session, json.loads(body)))
                if path == "/db/name-check" and method == "POST":
                    return self.send_json({'message': workspace.duplicate_name_message(session, json.loads(body)['name'])})
                if path == "/db/definition" and method == "POST":
                    req = json.loads(body)
                    return self.send_json(workspace.definition_info(session, req['name']))
                if path == "/db/definition/apply" and method == "POST":
                    return self.send_json(workspace.apply_definition(session, json.loads(body)))
                if path == "/db/definition/source" and method == "POST":
                    req = json.loads(body)
                    workspace.record_definition(session, req['name'], req.get('query'), req.get('origin'))
                    return self.send_json({'saved': True})
                if path == "/db/query" and method == "POST":
                    return self.send_binary(workspace.query(session, json.loads(body)["sql"]), "application/vnd.apache.arrow.stream")
                if path == "/db/project/preview" and method == "GET":
                    preview = project_files.preview(q.get("path", [""])[0], q.get("sheet", [None])[0], q.get("header", [1])[0])
                    preview['tables'] = workspace.file_tables(session).get(preview['relative'], [])
                    return self.send_json(preview)
                if path == "/db/project/files" and method == "GET":
                    listing = project_files.listing(q.get("path", [""])[0])
                    linked = workspace.file_tables(session)
                    for entry in listing['entries']:
                        entry['tables'] = linked.get(entry['relative'], [])
                    return self.send_json(listing)
                if path == "/db/project/bring" and method == "POST":
                    return self.send_json(project_files.bring(q.get("name", [""])[0], body))
                if path == "/db/project/excel-csv" and method == "POST":
                    req = json.loads(body)
                    return self.send_json(project_files.excel_csv(req["path"], req.get("sheet"), req.get("header", 1), req.get("name")))
                if path == "/db/project/import-plan" and method == "POST":
                    request = json.loads(body)
                    file = project_files.resolve(request["path"])
                    return self.send_json(workspace.plan_import(session, file, request.get("name"), request.get("sheet"), request.get("header", 1)))
                if path == "/db/project/import" and method == "POST":
                    request = json.loads(body)
                    if request.get("plan"):
                        return self.send_json(workspace.execute_import_plan(session, request["plan"]))
                    file = project_files.resolve(request["path"])
                    return self.send_json(workspace.import_path(session, file, sheet=request.get("sheet"), header=request.get("header", 1)))
                if path == "/db/import" and method == "POST":
                    return self.send_json(workspace.import_file(session, q.get("name", [""])[0], body))
                if path == "/db/arrow" and method == "POST":
                    workspace.arrow_table(session, q.get("name", [""])[0], body)
                    return self.send_json({"ok": True})
                if path == "/db/drop" and method == "POST":
                    data = json.loads(body)
                    if data.get("kind") not in ("table", "view") or not isinstance(data.get("name"), str):
                        raise ValueError("Invalid table or view")
                    c = session['conn']
                    catalog = c.execute('SELECT current_database()').fetchone()[0]
                    workspace.sync_definitions(c)
                    c.execute(f'DROP {data["kind"].upper()} {ident(catalog)}.main.{ident(data["name"])}')
                    workspace.sync_definitions(c)
                    return self.send_json({"deleted": True})
                if path == "/db/file":
                    file = workspace.file(session, q.get("name", [""])[0])
                    if method == "POST":
                        file.write_bytes(body)
                        return self.send_json({"ok": True})
                    if method == "GET":
                        return self.send_binary(file.read_bytes())
                    if method == "DELETE":
                        file.unlink(missing_ok=True)
                        return self.send_json({"ok": True})
                return self.send_error(404)
        except Exception as e:
            return self.send_json({"error": str(e)}, 400)

    def handle_post(self):
        path, _, query = self.path.partition("?")
        if path not in (SAVED_PATH, "/saved-work-copy", "/kernel/input", "/kernel/run"):
            return self.send_error(404)
        if not self.from_editor():
            return self.send_error(403)
        length = int(self.headers.get("Content-Length", 0))
        if path == "/kernel/input":
            return self.kernel_input(urllib.parse.parse_qs(query), length)
        if path == "/kernel/run":
            return self.kernel_run(length)
        if length > 5_000_000:
            return self.send_error(413)
        try:
            data = json.loads(self.rfile.read(length))
            assert isinstance(data.get("queries"), list)
        except Exception:
            return self.send_error(400, "expected {\"queries\": [...]}")
        copied = path == '/saved-work-copy'
        id_map = {}
        if copied:
            with open(SAVED_FILE) as f:
                latest = json.load(f)
            group = 'Recovered ' + time.strftime('%Y-%m-%d %H-%M-%S') + '-' + uuid.uuid4().hex[:6]
            for kind in ('queries', 'notebooks', 'dashboards'):
                for item in data.get(kind, []):
                    id_map[item['id']] = str(uuid.uuid4())
            for kind in ('queries', 'notebooks', 'dashboards'):
                for item in data.get(kind, []):
                    item['id'] = id_map[item['id']]
                    item['name'] = item.get('name', 'Untitled') + ' (copy)'
                    item['folder'] = group
                    if kind == 'dashboards':
                        for tile in item.get('tiles', []):
                            tile['query_id'] = id_map.get(tile.get('query_id'), tile.get('query_id'))
                    latest.setdefault(kind, []).append(item)
                latest.setdefault('folders', {}).setdefault(kind, []).append(group)
            data = latest
        current, client = version(), self.headers.get("X-Client")
        if not copied and self.headers.get("X-Base-Version") != current:
            return self.send_error(409, "saved_queries.json changed since this tab loaded it")
        backup()
        tmp = SAVED_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp, SAVED_FILE)
        if copied:
            return self.send_json({'work':data, 'idMap':id_map, 'folder':group})
        self.send_response(204)
        self.end_headers()

    # one input table for a run, as Parquet: /kernel/input?run=<id>&name=<table>
    def kernel_input(self, q, length):
        name = q.get("name", [""])[0]
        if not re.fullmatch(r"[A-Za-z_]\w*", name) or length > MAX_INPUT:
            return self.send_error(400)
        try:
            d = os.path.join(run_dir(q.get("run", [""])[0]), "inputs")
        except ValueError:
            return self.send_error(400)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, name + ".parquet"), "wb") as f:
            left = length
            while left > 0:
                chunk = self.rfile.read(min(left, 1 << 20))
                if not chunk:
                    break
                f.write(chunk); left -= len(chunk)
        self.send_response(204)
        self.end_headers()

    # run a cell: {run, lang: "python" | "r", code, params: {name: {kind, value}}}
    def kernel_run(self, length):
        try:
            req = json.loads(self.rfile.read(length))
            d, lang = run_dir(req["run"]), req["lang"]
            assert lang in ("python", "r")
        except Exception:
            return self.send_error(400)
        clean_old_runs()
        os.makedirs(d, exist_ok=True)
        params = req.get("params") or {}
        if lang == "python":
            exe, script, code_file = python_exe(), os.path.join(KERNELS, "run_python.py"), "code.py"
            with open(os.path.join(d, "params.json"), "w") as f:
                json.dump(params, f)
        else:
            exe, script, code_file = rscript_exe(), os.path.join(KERNELS, "run_r.R"), "code.R"
            if not exe:
                return self.send_json({"error": "R isn't installed yet. Install it with:\n  brew install --cask r\nthen run this cell again.", "stdout": "", "figures": [], "result": False})
            with open(os.path.join(d, "params.R"), "w") as f:
                f.write("\n".join(f"{k} <- {r_literal(v)}" for k, v in params.items() if re.fullmatch(r"[A-Za-z_]\w*", k)) + "\n")
        with open(os.path.join(d, code_file), "w") as f:
            f.write(req.get("code", ""))
        t0 = time.time()
        error = None
        try:
            p = subprocess.run([exe, script, d], cwd=project_root, env=runtimes.environment(lang), capture_output=True, text=True, timeout=RUN_TIMEOUT)
            if p.returncode != 0 and not os.path.exists(os.path.join(d, "error.txt")):
                error = (p.stderr or p.stdout or f"exited with code {p.returncode}")[-20_000:]
        except OSError as e:
            error = "Runtime could not start. Check Help → Runtime setup. " + str(e)
        except subprocess.TimeoutExpired:
            error = f"Stopped after {RUN_TIMEOUT // 60} minutes."
        read = lambda n: open(os.path.join(d, n)).read() if os.path.exists(os.path.join(d, n)) else ""
        figures = [base64.b64encode(open(f, "rb").read()).decode() for f in sorted(glob.glob(os.path.join(d, "fig_*.png"))) if os.path.getsize(f) > 0]
        variables = []
        try:
            if read("variables.json"):
                variables = json.loads(read("variables.json"))
            elif read("variables.tsv"):
                import io
                variables = list(csv.DictReader(io.StringIO(read("variables.tsv")), delimiter="\t"))
        except (ValueError, csv.Error):
            pass
        self.send_json({
            "variables": variables,
            "stdout": read("stdout.txt"), "error": error or read("error.txt") or None, "figures": figures,
            "result": os.path.exists(os.path.join(d, "result.parquet")), "ms": round((time.time() - t0) * 1000),
        })


class LocalHTTPServer(http.server.ThreadingHTTPServer):
    def server_bind(self):
        # HTTPServer normally reverse-resolves the bind address. That can stall
        # macOS hosts with slow DNS; this loopback-only server needs no lookup.
        socketserver.TCPServer.server_bind(self)
        self.server_name = "localhost"
        self.server_port = self.server_address[1]


handler = functools.partial(Handler, directory=root)
server = LocalHTTPServer(("127.0.0.1", port), handler)
port = server.server_address[1]
lease.publish(f"http://localhost:{port}/")
project_launcher = ProjectLauncher(root, data_root, project_root, f"http://localhost:{port}/")
if os.environ.get("MDS_READY_FILE"):
    with open(os.environ["MDS_READY_FILE"], "w") as ready:
        json.dump({"url": f"http://localhost:{port}/"}, ready)
def stop_server(signum, frame):
    raise KeyboardInterrupt
signal.signal(signal.SIGTERM, stop_server)
print(f"Minimal Data Studio: http://localhost:{port}", flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
    project_launcher.close(stop_children=False)
    runtimes.close()
    workspace.close()
    lease.close()
