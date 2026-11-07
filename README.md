# Minimal Data Studio

A local workspace for teaching and learning SQL, Python, and R. Explore files, query a persistent DuckDB database, and turn results into charts, notebooks, and dashboards in a browser interface.

**Early-stage software.** The current distribution runs from source. Desktop installers and offline frontend assets are not included yet. Development and browser testing currently focus on macOS; Windows has not been validated.

## What it does

- Switch between SQL, Python, and R in editor tabs.
- Keep project **Files** separate from **Database** tables and views.
- Learn full and project-relative paths, with one project working directory across languages.
- Bring files into a project before choosing whether to import them as tables.
- Keep database changes across reloads and server restarts.
- Save queries, build charts and dashboards, and combine languages in notebooks.

## Run locally

Use Python 3.11 (recommended), Git, and a terminal. On macOS or Linux:

```sh
git clone https://github.com/minimaldata/minimal-data-studio.git
cd minimal-data-studio
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python serve.py
```

Open **http://localhost:8791**. Stop the server with Ctrl+C. The frontend currently loads libraries from CDNs, so internet access is required to load the interface. R is optional; SQL and Python work without it.

Try **Average sepal length by species** or **Flower overview** in the sidebar. The included Iris data is public and separately licensed; see [data attribution](data/README.md).

To use R, install R and then install `nanoparquet`:

```sh
mkdir -p .venv/R-library
Rscript -e 'install.packages("nanoparquet", lib=".venv/R-library", repos="https://cloud.r-project.org")'
```

## Where your work lives

The first launch creates an ignored `project/` folder:

```text
project/
  data/                     # Files brought into the project
  exports/                  # A place for exported files
  .studio/workspace.duckdb   # Persistent tables and views
  saved_queries.json        # Saved queries, notebooks, dashboards
  backups/                  # Previous versions of saved_queries.json
```

Files you import and database tables are separate copies. Updating a table does not change its source file. All languages start in the project directory. Ordinary SQL changes persist; temporary tables and unfinished transactions do not survive a closed connection.

Back up the whole project folder, including hidden files, after stopping the server. Use `--project-dir /absolute/path` to select another project. Never commit student work, private datasets, database files, or credentials.

## Local execution model

This is a single-user local tool, **not a hosted service or a sandbox**. SQL, Python, and R execute with your local account's permissions. Opening a saved query, notebook, or dashboard may execute code. Run only code and notebooks you trust; do not expose the server publicly. See [SECURITY.md](SECURITY.md).

## Contributing

Bug reports, teaching feedback, documentation improvements, and code contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

- [User guide](docs/USER_GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Validation and test coverage](VALIDATION.md)
- [Development priorities](ROADMAP.md)

## License

Project source code is licensed under the [MIT License](LICENSE). The Iris sample dataset uses **CC BY 4.0**, as described in [data/README.md](data/README.md). Third-party packages retain their own licenses; see [THIRD_PARTY.md](THIRD_PARTY.md).
