# Third-party components and data

The MIT license in this repository covers this project's source code. It does not replace the licenses of datasets, runtimes, packages, or frontend libraries.

## Included sample data

`data/iris.csv` is derived from UCI's Iris dataset and is distributed under CC BY 4.0. Attribution, source, DOI, and the changes made to the file are documented in [data/README.md](data/README.md).

## Runtime dependencies

Python dependencies are declared in `requirements.txt`: DuckDB, pandas, PyArrow, and matplotlib. R and `nanoparquet` are installed separately and are optional. Their upstream distributions include their license notices.

The frontend loads CodeMirror, sql-formatter, GridStack, marked, DOMPurify, Vega, Vega-Lite, Vega-Embed, Apache Arrow, and xterm.js from CDNs. Versioned URLs are listed in `index.html`; these library assets are not vendored in this repository.

The Mac app includes a checksum-verified python-build-standalone CPython distribution and the exact packages in `packaging/macos/requirements.lock`. Their original license files and package metadata remain inside `Contents/Resources/python`, including Python’s `lib/python3.11/LICENSE.txt` and package `*.dist-info` license/notice files. R is not bundled. Frontend CDN assets are not bundled.
