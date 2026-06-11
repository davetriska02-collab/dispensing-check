# Dispensing Check

An offline, self-contained web app for **UK dispensing GP practices**: margin
analysis for the partners, a price-blind formulary for the prescribers, from
one shared dataset.

1. **Margin ledger (partners / practice manager).** Dispensing practices buy
   medicines from wholesalers but are reimbursed at Drug Tariff prices minus the
   NHS discount-deduction "clawback". Profit on a line is
   `tariff × (1 − clawback) − purchase cost`. The ledger computes that margin,
   finds the cheapest supplier on file, flags loss-making lines, and totals the
   cash freed by switching — with a category breakdown, RAG margin-health bands,
   cost-per-unit comparison, a margin trend sparkline, a one-click "switch all to
   cheapest supplier" action, a switch-list export (printable sheet and CSV,
   grouped by target wholesaler), search / category / status filters, sortable
   columns, and a printable board report.

2. **Insights (visual dashboard).** Hand-rolled, dependency-free SVG charts:
   a margin trend area chart built from monthly snapshots, profit-by-category
   bars, top earners & drains, the biggest supplier-switch opportunities, and a
   monthly spend-mix donut. All charts follow the active theme and accent.

3. **Prescriber view (price-blind formulary).** Every prescriber sees the agreed
   **preferred line** + **clinically-equivalent alternative** per therapeutic
   choice, with doses, **at the point of prescribing** — and **never any cost,
   margin or supplier**. Commercial data stays with the partners. A soft PIN gates
   entry to the partner view on shared workstations.

The UI is configurable per workstation: light/dark theme, four text sizes (also
cycled by the topbar **aA** button), comfortable/compact density, and four accent
colours — all under **Settings → Appearance**, persisted locally.

**Data in:** tariff prices import from the NHSBSA Part VIII price list (CSV or
XLSX — the XLSX reader is hand-rolled, zero dependencies); monthly **price
concessions (NCSO)** paste or import and override the tariff until cleared;
**wholesaler statements/quotes** (AAH, Alliance, Phoenix or any CSV/XLSX)
import as date-stamped supplier quotes with stale-quote indicators after 60
days; **monthly volumes** import from ePACT2/PMR exports. Every import uses
column auto-detection with a manual mapping fallback and a
confirm-before-apply match review. **No live wholesaler price feeds are
bundled** (those are licensed) — the money maths runs entirely locally in the
browser; practice data is stored in `localStorage` and the imported tariff
dataset in IndexedDB, all on-device.

## Run it

No build step, no dependencies. Open `index.html` in a browser (Chrome/Edge/
Firefox), or serve the folder:

```
python3 -m http.server 8080   # then visit http://localhost:8080
```

Use the **Partner / manager ↔ Prescriber** switch in the top bar. In the partner
view, click **Load worked example** to explore with sample data.

## Layout

| File | Purpose |
|---|---|
| `index.html` | App shell (top bar, nav, content root) |
| `styles.css` | Glass UI; light/dark via the ◐ toggle |
| `engine.js` | Pure calculation engine (no DOM/storage). Loads as a `<script>` (`window.DispensingEngine`) and as a CommonJS module for the tests |
| `importers.js` | Pure import engine: XLSX/CSV parsing, column detection, product matching, NCSO parsing (`window.DispensingImporters`) |
| `app.js` | UI controller, `localStorage`/IndexedDB persistence, all views |
| `test/engine.test.js` | Node regression tests for the engine, incl. the prescriber price-blindness guarantee |
| `test/importers.test.js` | Node regression tests for the import engine, incl. an in-test XLSX fixture |

## Tests

```
npm test          # or: node test/engine.test.js
```

The suite covers the clawback model, per-line margins, cheapest-supplier
detection, the blank-price-is-not-£0 guard, loss flagging, totals, the category
breakdown, CSV round-trip + spreadsheet formula-injection guard, snapshot history,
and — importantly — that the prescriber projection carries **no** cost/margin/
supplier/`productId` data.

## CSV format

`name,pack,category,tariff,monthlyPacks,supplier,price,current` — rows sharing
`name`+`pack` group into one product with several supplier quotes; an empty price
cell means "unpriced" (it is **not** treated as £0). `current` (`1`/`yes`/`y`/`x`)
marks the supplier in use.

## Data & safety

- `localStorage` keys: `dc.products`, `dc.config`, `dc.formulary`, `dc.history`,
  `dc.role`, `dc.theme`, `dc.practiceName`, `dc.partnerPin`, `dc.textSize`,
  `dc.density`, `dc.accent`, `dc.tariffMonth`, `dc.concessions`,
  `dc.onboarded`, `dc.lastBackupAt`, `dc.lastExport`, `dc.backupNudgeAt`.
  The imported Drug Tariff dataset and the auto-backup file handle live in
  the `dispensingCheck` IndexedDB.
- **Auto-backup** (Chrome/Edge): pick a file once in **Settings → Backup**
  and every change is written to it automatically. JSON/CSV imports offer
  **Merge** (by id, then name + pack) or **Replace**. A first-run setup
  guide appears on first launch and can be re-run from Settings.
- Full JSON backup/restore and CSV import/export are in the **Import / export**
  tab. Imports that would replace existing data ask for confirmation first, and
  JSON backups are shape-validated on the way in.
- CSV export guards all cells (including numeric ones) against spreadsheet
  formula injection; the guard is stripped losslessly on re-import.
- **Settings → Danger zone** clears every `dc.*` key after a strong confirmation.
- The prescriber PIN is a soft gate for shared workstations, **not** strong
  security; the price-blindness is enforced by projecting the formulary through
  `prescriberFormulary()`, which strips every commercial field before render.
- Always verify clawback figures and reimbursement routes against the current
  Drug Tariff before acting.

## Information governance

Dispensing Check stores **commercial data only** (prices, supplier quotes,
formulary, settings, monthly margin snapshots) in `localStorage` in this browser
on this device. It holds no patient data, no NHS numbers and no clinical records.
Nothing is transmitted: the app makes zero network requests after page load, with
no cloud storage, no analytics and no third-party scripts. Because no patient data
is held or transmitted, this tool does not create a patient data flow requiring
DSPT assessment; practices should still follow local policy for commercial data.
Use **Import / export → Export JSON** for backups. The in-app **Data & IG**
page covers all of this in detail and explains how to verify it yourself in
browser DevTools.

## Status

v1.3.0. Engine and importers are regression-tested (196 tests); the UI is
framework-free vanilla JS with zero dependencies and no build step.
