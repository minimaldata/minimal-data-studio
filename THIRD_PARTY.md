# Third-party components and data

The MIT license in this repository covers this project's source code. It does not replace the licenses of datasets, runtimes, packages, or frontend libraries.

## Included sample data

`data/iris.csv` is derived from UCI's Iris dataset and is distributed under CC BY 4.0. Attribution, source, DOI, and the changes made to the file are documented in [data/README.md](data/README.md).

## Runtime dependencies

Python dependencies are declared in `requirements.txt`: DuckDB, pandas, PyArrow, and matplotlib. R and `nanoparquet` are installed separately and are optional. Their upstream distributions include their license notices.

The frontend loads CodeMirror, sql-formatter, GridStack, marked, DOMPurify, Vega, Vega-Lite, Vega-Embed, and Apache Arrow from CDNs. Versioned URLs are listed in `index.html`; these library assets are not vendored in this repository.

Before shipping offline assets or bundled desktop runtimes, retain the license files and notices for the exact versions being redistributed. That packaging work has not been completed here.
