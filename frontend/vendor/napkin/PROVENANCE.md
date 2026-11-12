# NapkinCharts dependency

Source: https://github.com/minimaldata/napkinCharts/tree/main/d3
Retrieved 2026-11-11. The upstream D3 APIs are experimental.

Pinned Git blob identities:
- model.js: 63b1d68f1320d885799df5385d27a2b94529d796
- chart.js: 450bc8d55a530a15da1b93bc2259c3562c5b5e05
- alignment.js: d46cf9b7968e0724c681521e4de285f64dff1cb6
- tooltip-behavior.js: ad3b006062b9d5724dd62d82a13a6e07bdc1ff92
- chart.css: 048b0fb1232f40e4a3ac3ce0a869efee96471123

These files are vendored unmodified. Studio integration lives in
frontend/assumption-model.mjs and frontend/assumption-cell.mjs.
D3 7.9.0 and its ISC license are included locally; no new CDN is needed.
The included NapkinCharts model, chart, alignment, tooltip and CSS files are
licensed under MIT by their owner, minimaldata, with authorization recorded on
2026-11-11. See LICENSE in this directory. This grant covers the included files;
D3 retains its separate ISC license in D3-LICENSE.
