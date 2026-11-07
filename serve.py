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

parser = argparse.ArgumentParser(description="Run the local Minimal Data Studio workspace")
parser.add_argument("--port", type=int, default=8791)
parser.add_argument("--data-dir", default=os.environ.get("SQL_LAB_DATA_DIR", os.path.join(root, "data")))
parser.add_argument("--project-dir", default=os.path.join(root, "project"))
args = parser.parse_args()
port = args.port
os.environ.setdefault("R_LIBS_USER", os.path.join(root, ".venv", "R-library"))
data_root = os.path.realpath(os.path.expanduser(args.data_dir))
project_root = os.path.realpath(os.path.expanduser(args.project_dir))
project_files = ProjectFiles(project_root)
# Migrate the previous single workspace only into the default project. Keep originals.
if project_root == os.path.join(root, "project"):
    old_db = os.path.join(root, ".studio", "workspace.duckdb")
    new_db = os.path.join(project_root, ".studio", "workspace.duckdb")
    if os.path.exists(old_db) and not os.path.exists(new_db):
        with duckdb.connect(old_db) as old:
            old.execute("CHECKPOINT")
        shutil.copy2(old_db, new_db)
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
    shutil.copyfile(seed, SAVED_FILE)
os.chdir(project_root)  # Native SQL resolves relative reads and writes from the project.
workspace = Workspace(root, data_root, project_root, migrate_legacy=project_root == os.path.join(root, "project"))
KEEP_BACKUPS = 50
last_write = {"version": None, "client": None}  # who wrote the current version

KERNELS = os.path.join(root, "kernels")
RUNS_DIR = os.path.join(tempfile.gettempdir(), "sql-lab-runs")
RUN_TIMEOUT = 600  # seconds
MAX_INPUT = 1_000_000_000  # bytes per uploaded table


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
    venv = os.path.join(root, ".venv", "bin", "python")
    return os.environ.get("SQL_LAB_PYTHON") or (venv if os.path.exists(venv) else sys.executable)


def rscript_exe():
    for p in [shutil.which("Rscript"), "/opt/homebrew/bin/Rscript", "/usr/local/bin/Rscript", "/Library/Frameworks/R.framework/Resources/bin/Rscript"]:
        if p and os.path.exists(p):
            return p
    return None


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
        if self.path.split("?")[0] == SAVED_PATH:
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

    def do_POST(self):
        if self.path.startswith("/db/"):
            return self.database_request("POST")
        if self.path.split("?")[0] == "/relations":
            return self.send_json({"error": "Storage has moved to DuckDB. Reload the editor."}, 410)
        if self.path.split("?")[0] == SAVED_PATH:
            with save_lock:
                return self.handle_post()
        return self.handle_post()

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
            with workspace.lock:
                if path == "/db/session" and method == "POST":
                    return self.send_json(workspace.new_session())
                key = q.get("session", [""])[0]
                session = workspace.session(key)
                if path == "/db/close" and method == "POST":
                    workspace.close_session(key)
                    return self.send_json({"closed": True})
                if path == "/db/query" and method == "POST":
                    return self.send_binary(workspace.query(session, json.loads(body)["sql"]), "application/vnd.apache.arrow.stream")
                if path == "/db/project/files" and method == "GET":
                    return self.send_json(project_files.listing(q.get("path", [""])[0]))
                if path == "/db/project/bring" and method == "POST":
                    return self.send_json(project_files.bring(q.get("name", [""])[0], body))
                if path == "/db/project/import" and method == "POST":
                    file = project_files.resolve(json.loads(body)["path"])
                    return self.send_json(workspace.import_path(session, file))
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
                    c.execute(f'DROP {data["kind"].upper()} {ident(catalog)}.main.{ident(data["name"])}')
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
        if path not in (SAVED_PATH, "/kernel/input", "/kernel/run"):
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
        current, client = version(), self.headers.get("X-Client")
        own_write = client and last_write == {"version": current, "client": client}
        if self.headers.get("X-Force") != "1" and self.headers.get("X-Base-Version") != current and not own_write:
            return self.send_error(409, "saved_queries.json changed since this tab loaded it")
        backup()
        tmp = SAVED_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp, SAVED_FILE)
        last_write.update(version=version(), client=client)
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
            p = subprocess.run([exe, script, d], cwd=project_root, capture_output=True, text=True, timeout=RUN_TIMEOUT)
            if p.returncode != 0 and not os.path.exists(os.path.join(d, "error.txt")):
                error = (p.stderr or p.stdout or f"exited with code {p.returncode}")[-20_000:]
        except subprocess.TimeoutExpired:
            error = f"Stopped after {RUN_TIMEOUT // 60} minutes."
        read = lambda n: open(os.path.join(d, n)).read() if os.path.exists(os.path.join(d, n)) else ""
        figures = [base64.b64encode(open(f, "rb").read()).decode() for f in sorted(glob.glob(os.path.join(d, "fig_*.png"))) if os.path.getsize(f) > 0]
        self.send_json({
            "stdout": read("stdout.txt"), "error": error or read("error.txt") or None, "figures": figures,
            "result": os.path.exists(os.path.join(d, "result.parquet")), "ms": round((time.time() - t0) * 1000),
        })


print(f"Minimal Data Studio: http://localhost:{port}", flush=True)
handler = functools.partial(Handler, directory=root)
server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
    workspace.close()
