# Runs one notebook Python cell. usage: run_python.py <run_dir>
# run_dir holds code.py, params.json ({name: {kind, value}}) and inputs/<name>.parquet.
# Each input becomes a pandas DataFrame named after its table or cell, and each filter a variable.
# Writes stdout.txt, error.txt (if it failed), result.parquet (if the last line is a DataFrame or Series)
# and fig_NN.png for every matplotlib figure left open.
import ast, contextlib, datetime, io, json, os, sys, traceback

run = sys.argv[1]
os.environ.setdefault("MPLBACKEND", "Agg")
import pandas as pd

ns = {"__name__": "__main__", "pd": pd}
inputs = os.path.join(run, "inputs")
for f in sorted(os.listdir(inputs)) if os.path.isdir(inputs) else []:
    if f.endswith(".parquet"):
        ns[f[: -len(".parquet")]] = pd.read_parquet(os.path.join(inputs, f))
for name, p in json.load(open(os.path.join(run, "params.json"))).items():
    v, kind = p.get("value"), p.get("kind")
    if kind == "date" and v:
        v = datetime.date.fromisoformat(v)
    elif kind == "number" and v not in (None, ""):
        v = float(v) if "." in str(v) else int(v)
    elif v == "":
        v = None
    ns[name] = v

out = io.StringIO()
code = open(os.path.join(run, "code.py")).read()
try:
    tree = ast.parse(code, "<cell>")
    # like a notebook, the value of a final expression is the cell's result
    last = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        exec(compile(tree, "<cell>", "exec"), ns)
        value = eval(compile(ast.Expression(last.value), "<cell>", "eval"), ns) if last else None
    if isinstance(value, pd.Series):
        value = value.to_frame()
    if isinstance(value, pd.DataFrame):
        df = value if isinstance(value.index, pd.RangeIndex) else value.reset_index()
        df.columns = [str(c) for c in df.columns]
        df.to_parquet(os.path.join(run, "result.parquet"), index=False)
    elif value is not None and not type(value).__module__.startswith("matplotlib"):
        out.write(repr(value) + "\n")
except Exception:
    # the lines of the cell that led to the error, then the error itself (not pandas' internals)
    etype, err, tb = sys.exc_info()
    lines = code.splitlines()
    where = [f"line {fr.lineno}: {lines[fr.lineno - 1].strip()}" for fr in traceback.extract_tb(tb) if fr.filename == "<cell>" and 0 < fr.lineno <= len(lines)]
    if isinstance(err, SyntaxError):
        where = []  # its message already shows the line, with a caret
    with open(os.path.join(run, "error.txt"), "w") as f:
        f.write("\n".join(where + ["".join(traceback.format_exception_only(etype, err)).strip()]))

if "matplotlib.pyplot" in sys.modules:
    plt = sys.modules["matplotlib.pyplot"]
    for i, num in enumerate(plt.get_fignums()):
        plt.figure(num).savefig(os.path.join(run, f"fig_{i:02d}.png"), dpi=144, bbox_inches="tight")
with open(os.path.join(run, "stdout.txt"), "w") as f:
    f.write(out.getvalue()[-200_000:])

# A bounded, read-only snapshot; the next run still starts with a fresh process.
variables = []
for name, obj in sorted(ns.items()):
    if name.startswith("_") or isinstance(obj, type(pd)) or callable(obj):
        continue
    try:
        if isinstance(obj, pd.DataFrame):
            dimensions = f"{len(obj)} rows × {len(obj.columns)} columns"
            preview = obj.iloc[:5, :10].to_string(index=False)
        elif isinstance(obj, pd.Series):
            dimensions = f"{len(obj)} values"
            preview = obj.head(5).to_string()
        elif type(obj) in (str, int, float, bool, list, tuple, dict, set, type(None)):
            dimensions = f"{len(obj)} items" if hasattr(obj, "__len__") else ""
            import reprlib
            preview = reprlib.repr(obj)
        else:
            dimensions, preview = "", "Preview unavailable"
        variables.append(dict(name=name, type=type(obj).__name__, dimensions=dimensions, preview=preview[:3000]))
    except Exception:
        continue
    if len(variables) >= 100:
        break
with open(os.path.join(run, "variables.json"), "w") as f:
    json.dump(variables, f)
