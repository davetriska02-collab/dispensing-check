# Dispensing Check roadmap

Derived from the competitive benchmark (`gauntlet-dispensing-check-2026-06-11.md`).
Strategy in one line: kill the manual-entry tax with public data and the
practice's own files, then own the two things no competitor can copy - the
price-blind prescriber surface and the zero-IG local-first posture.

Architecture rules that hold for every release:

- The engine stays pure, dependency-free and fully unit-tested. Every parser
  and matcher lands as pure functions with tests before any UI touches it.
- Zero runtime dependencies remains a feature. Native platform APIs only
  (DecompressionStream for XLSX, DOMParser, File System Access API, IndexedDB).
- Practice data stays in localStorage; large reference datasets (Drug Tariff)
  go in IndexedDB so we never hit the ~5MB localStorage ceiling.
- Every import is confirm-before-apply: parse, preview the diff, then commit.
- Nothing ever leaves the device. Any feature that would need a server is out.

## v1.1 - Tariff intelligence (gauntlet M1, M2, M3, L2)

Theme: the app stops arriving empty. Public data in, action lists out.

1. **Drug Tariff import (M1).** User downloads the NHSBSA Part VIII file and
   drops it on the app. Support CSV directly and XLSX natively: XLSX is a zip
   of XML, readable with DecompressionStream('deflate-raw') plus DOMParser, no
   library needed. Parsed lines go to IndexedDB as a reference dataset with a
   month stamp. A matching pass proposes tariff prices for existing products
   (normalised token match on drug, strength, form, pack size - parsePackQty
   already exists); user confirms per line or accepts all. New engine module:
   pure parser + matcher with tests against captured sample files. Defensive
   parsing with a column-mapping fallback UI for the month NHSBSA changes the
   layout. Effort M.
2. **Price concession / NCSO import (M2).** Monthly DHSC concession list is a
   short table; accept CSV or pasted text. Concession price overrides tariff
   for the stamped month, loss-makers recompute, concession lines get a
   visible flag in ledger and reports. Engine: concession overlay function +
   tests. Effort S.
3. **Switch list export (M3).** One click on the ledger: CSV and printable
   sheet of recommended switches grouped by target wholesaler, with per-line
   and total savings. All data already computed by productMetrics. Effort S.
4. **IG one-pager (L2).** A short information-governance statement (no patient
   data, no cloud, nothing to DSPT-assess, data location, backup guidance)
   rendered as an in-app page and shipped in the README. Effort S.

Release gate: tariff import round-trips a real NHSBSA file; concession month
correctly flips a loss-maker; tests green.

## v1.2 - Five-minute start (B1, M4, B4)

Theme: win the adoption dimension outright. Nothing in the field starts
faster than opening a file; make the first five minutes prove it.

1. **First-run wizard (B1).** Guided flow: load sample -> import tariff ->
   add first real product -> see first insight. Skippable, never shown again,
   re-runnable from Settings. Effort S.
2. **Durable storage (M4).** File System Access API autosave to a
   practice-chosen folder where supported (Chrome/Edge), with graceful
   fallback to export reminders elsewhere. Import becomes merge-by-default
   (match on id, then name+pack) with a replace option, instead of
   replace-only. Engine: pure merge function with conflict rules + tests.
   Effort M.
3. **Commercial-grade polish (B4).** Keyboard-complete navigation, WCAG AA
   contrast audit across both themes and all four accents, charts in the
   printable board report. Effort S-M.

Release gate: a new user reaches a real margin insight in under five minutes
without reading the README; data survives a browser-profile wipe via autosave.

## v1.3 - Your own data, automatically (B2, M5)

Theme: the hinge release. Real buy prices and real volumes without licensed
feeds, from files the practice already receives.

1. **Wholesaler statement import (B2).** CSV templates for AAH, Alliance and
   Phoenix invoice/quote exports, plus a generic column-mapping fallback for
   anything else. Fuzzy product matching with a confirm screen (same matcher
   as tariff import); accepted lines update supplier quotes with a date stamp.
   Stale-quote indicator when a price is older than N days. Effort M, the
   single highest-value item in the plan.
2. **Volume import (M5).** Map monthly pack counts from ePACT2 or PMR CSV
   exports onto products, reusing the same mapping + confirm UI. Effort S-M
   once B2 lands.

Release gate: a practice can populate tariff, buy prices and volumes for its
top 50 lines entirely from imported files, zero typing.

## v2.0 - Own the prescribing side (L1, B3, L3)

Theme: the moats. These are the items the stress test says incumbents
structurally cannot copy.

1. **Prescriber surface (L1).** Export the formulary as a self-contained
   read-only HTML file (engine-stripped, provably price-blind) for the
   practice intranet or shared drive; printable consulting-room one-pagers per
   therapeutic class; exportable EMIS/SystmOne alert text so practices can
   hand-configure Nudger-style prompts pointing at their own formulary.
   Effort M.
2. **Concession-aware forecasting (B3).** Project next-month margin from the
   snapshot trend plus current concession status per line. Pure engine
   extension + a forecast band on the Insights trend chart. Effort M.
3. **Whole-dispensary P&L (L3).** Personally administered items and appliances
   as first-class categories with their own reimbursement and clawback
   treatment. GATED: needs domain validation (PA allowance, VAT treatment,
   fee structure) with a practising dispenser before the engine model is
   built. Do not guess the reimbursement rules. Effort M-L.

## Standing risks

- NHSBSA/DHSC file formats change without notice: every parser ships with a
  column-mapping fallback and captured-file regression tests.
- Name matching is the quality bottleneck for all imports: invest in the
  normaliser once (v1.1), reuse everywhere, and never auto-apply a fuzzy
  match without confirmation.
- File System Access API is Chromium-only: the fallback path must be
  first-class, not an afterthought.
- L3 reimbursement rules are domain-sensitive: built only after validation.
