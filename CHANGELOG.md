# Changelog

## v1.1.0 — 2026-06-11

Tariff intelligence: the app stops arriving empty. Public data in, action
lists out. Still zero dependencies, still fully offline.

### Added

- **Drug Tariff import** — import the NHSBSA Part VIII price list as CSV or
  XLSX (the XLSX reader is hand-rolled: ZIP parsing plus the browser-native
  DecompressionStream, no libraries). Column auto-detection with a manual
  mapping fallback, pence/pounds handling, live preview, and a
  confirm-before-apply match review with exact/strong/weak confidence
  badges. The full tariff dataset is stored on-device in IndexedDB for
  matching products added later; the ledger shows the tariff month.
- **Price concessions (NCSO)** — paste or import the monthly concession
  list; matched lines use the concession price in every margin calculation,
  carry an NCSO flag in the ledger, and clear with one click. Backups
  preserve concession prices.
- **Switch-list export** — the recommended supplier switches as a printable
  sheet grouped by target wholesaler (with subtotals) and as CSV.
- **Data & IG page** — an in-app information governance statement: what is
  stored, what never is (no patient data), where it lives, and how to verify
  the zero-network claim in DevTools. Summarised in the README.
- `importers.js`: a pure, tested import engine (XLSX/CSV parsing, column
  detection, name normalisation, product matching, concession parsing) with
  68 tests including an in-test XLSX fixture. 128 tests total.

### Changed

- The engine honours a `concessionPrice` on a product, exposing
  `tariffBase` and `onConcession` in metrics; loss-makers are recomputed at
  concession prices.
- README no longer names a comparator product that could not be verified to
  exist.

## v1.0.0 — 2026-06-11

First stable release of Dispensing Check: an offline margin ledger and
price-blind prescriber formulary for UK dispensing GP practices. Zero
dependencies, no build step — open `index.html` or serve the folder.

### Added

- **Insights dashboard** — hand-rolled, theme-aware SVG charts: margin trend
  area chart built from monthly snapshots, profit-by-category bars, top
  earners & drains, biggest supplier-switch opportunities, and a monthly
  spend-mix donut with legend.
- **Ledger search, filter & sort** — search by product or supplier, filter by
  category and status (loss-making / switchable / unpriced), sortable columns
  with null-last ordering. Filters affect the table only; totals always cover
  all lines.
- **Appearance options** — light/dark theme, four text sizes (Settings or the
  topbar **aA** button), comfortable/compact density, and four accent colours
  (indigo, teal, violet, amber). All persisted per workstation.
- **Settings danger zone** — clears every `dc.*` localStorage key after a
  strong confirmation.
- 31 new engine regression tests (51 total).

### Fixed

- Empty-ledger panel buttons were dead (only the first matching action button
  was bound).
- CSV/JSON import silently replaced existing data — now asks for confirmation
  first.
- JSON backup import now shape-validates products, formulary and history.
- CSV export now guards numeric cells (tariff, packs, price) against
  spreadsheet formula injection; the guard is stripped losslessly on
  re-import.
- Modal dialogs close on Escape and autofocus their first field.
- Money formatting no longer shows "−£0" for values that round to zero.

## v0.1.0

Initial scaffold: margin ledger with clawback model, RAG margin bands,
cheapest-supplier detection, loss flagging, category breakdown, CSV/JSON
import/export, price-blind prescriber formulary, and a 20-test engine suite.
