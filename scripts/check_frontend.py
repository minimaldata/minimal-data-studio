"""Extract the no-build frontend module for `node --check`."""
from pathlib import Path
import tempfile
import subprocess

source = (Path(__file__).resolve().parents[1] / "index.html").read_text()
module = source.split('<script type="module">', 1)[1].split('</script>', 1)[0]
target = Path(tempfile.gettempdir()) / "minimal-data-studio-check.mjs"
target.write_text(module)
subprocess.run(["node", "--check", str(target)], check=True)
print("Frontend module syntax passed.")
