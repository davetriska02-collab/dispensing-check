# Dispensing Check

An offline, self-contained web app for **UK dispensing GP practices** — a working
alternative to RxMargin. It does two jobs from one shared dataset:

1. **Margin ledger (partners / practice manager).** Dispensing practices buy
   medicines from wholesalers but are reimbursed at Drug Tariff prices minus the
   NHS discount-deduction "clawback". Profit on a line is
   `tariff × (1 − clawback) − purchase cost`. The ledger computes that margin,
   finds the cheapest supplier on file, flags loss-making lines, and totals the
   cash freed by switching — with a category breakdown, RAG margin-health bands,
   cost-per-unit comparison, a margin trend sparkline, a one-click "switch all to
   cheapest supplier" action, and a printable board report.

2. **Prescriber view (price-blind formulary).** Every prescriber sees the agreed
   **preferred line** + **clinically-equivalent alternative** per therapeutic
   choice, with doses, **at the point of prescribing** — and **never any cost,
   margin or supplier**. Commercial data stays with the partners. A soft PIN gates
   entry to the partner view on shared workstations.

All prices are entered or CSV-imported by the practice. **No live Drug Tariff or
wholesaler price feeds are bundled** (those are licensed) — the money maths runs
entirely locally in the browser; data is stored in `localStorage`.

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
| `app.js` | UI controller, `localStorage` persistence, all views |
| `test/engine.test.js` | Node regression tests for the engine, incl. the prescriber price-blindness guarantee |

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
  `dc.role`, `dc.theme`, `dc.practiceName`, `dc.partnerPin`.
- Full JSON backup/restore and CSV import/export are in the **Import / export** tab.
- The prescriber PIN is a soft gate for shared workstations, **not** strong
  security; the price-blindness is enforced by projecting the formulary through
  `prescriberFormulary()`, which strips every commercial field before render.
- Always verify clawback figures and reimbursement routes against the current
  Drug Tariff before acting.

## Status

Standalone scaffold (v0.1.0). Engine is regression-tested; the UI is framework-free
vanilla JS. Intended to be mounted into its own repository.
