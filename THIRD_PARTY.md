# Third-party components and data

The MIT license in this repository covers this project's source code. It does not replace the licenses of datasets, runtimes, packages, or frontend libraries.

## Included sample data

`data/iris.csv` is derived from UCI's Iris dataset and is distributed under CC BY 4.0. Attribution, source, DOI, and the changes made to the file are documented in [data/README.md](data/README.md).

## Runtime dependencies

Python dependencies are declared in `requirements.txt`: DuckDB, pandas, PyArrow, and matplotlib. Source users install R and `nanoparquet` separately; the alpha.3 Mac app bundles them. Their upstream distributions include their license notices.

The frontend loads CodeMirror, sql-formatter, GridStack, marked, DOMPurify, Vega, Vega-Lite, Vega-Embed, Apache Arrow, and xterm.js from CDNs. Versioned URLs are listed in `index.html`; these library assets are not vendored in this repository.

The Mac app includes a checksum-verified python-build-standalone CPython distribution and the exact packages in `packaging/macos/requirements.lock`. Their original license files and package metadata remain inside `Contents/Resources/python`, including Python’s `lib/python3.11/LICENSE.txt` and package `*.dist-info` license/notice files. See the bundled R section below. Frontend CDN assets are not bundled.

## Bundled R (alpha.3 and later)

The Mac app includes R 4.6.2 (GPL-2 or GPL-3), its recommended packages, and nanoparquet 0.5.2. Original COPYING, package DESCRIPTION, LICENSE and copyright files are retained in `Contents/Resources/R`. Optional X11/Cairo/Tcl interfaces are omitted. Native library load paths and launcher paths are relocated by `packaging/macos/bundle_r.py`; the code is signed with the Studio Developer ID. The app communicates with R as a separate process.

Matching R and nanoparquet source archives are provided as release assets alongside the binary. Upstream sources: https://cran.r-project.org/src/base/R-4/R-4.6.2.tar.gz and https://cran.r-project.org/src/contrib/nanoparquet_0.5.2.tar.gz. R’s macOS build tools and library dependency sources are at https://mac.r-project.org/tools/ and https://mac.r-project.org/src/. Each component retains its own license.
