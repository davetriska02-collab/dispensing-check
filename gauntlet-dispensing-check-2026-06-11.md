# The Gauntlet: Dispensing Check vs the UK dispensing-margin market

Date: 11 June 2026. Prepared with the-gauntlet skill, first run.

## 1. Scoping summary

- **Product:** Dispensing Check v1.0.0 - an offline, browser-based margin ledger plus price-blind prescriber formulary for UK dispensing GP practices. Zero dependencies, data in localStorage, prices entered manually or by CSV. No bundled price feeds.
- **Users:** GP partners and the practice manager (buyers and margin users); prescribers (price-blind formulary view).
- **Deployment context:** NHS primary care, rural dispensing practices in England, Wales and Scotland.
- **Comparables:** direct substitutes only - tools whose job is dispensary margin analysis, profitability or buying optimisation for dispensing practices.
- **Dimensions ranked:** 1) UX / ease of adoption, 2) feature depth.

**Evidence caveat:** all vendor sites blocked direct fetching (HTTP 403), so competitor evidence comes from search-served page copy and trade sources, marked shipped / partial / claimed / absent accordingly. All sources accessed 11 June 2026. Dispensing Check's own column is marked from its codebase, not its ambitions.

**Notable scoping finding:** "RxMargin", named in the project README as the product Dispensing Check is an alternative to, could not be found as a live product anywhere - no website, vendor, EMIS partner listing, DDA exhibitor entry or trade-press mention. The README should stop naming it.

## 2. Competitor roster

| # | Product | Vendor | What it is |
|---|---------|--------|------------|
| 1 | Dispex (+ Nudger, formularies, DispexCD) | Dispex Ltd | Membership service for dispensing practices: dispensary-friendly formularies (27 class comparisons, per-wholesaler), Nudger point-of-prescribing alerts in EMIS/SystmOne, loss-making-lines list, benchmarking, training. dispex.net |
| 2 | e-CASS (dispensing doctor tier) | Cambrian Alliance | Buying group + cloud ordering platform: live multi-wholesaler comparison, per-line Drug Tariff margin with clawback input, pre-transmission loss checks, monthly profit reports, native EMIS Web tab. cambrianalliance.co.uk |
| 3 | PSUK portal | Phoenix Medical Supplies | Wholesaler-owned membership: ordering portal with over-tariff alerts, profitability guide, account-manager practice visits. psuk.co.uk |
| 4 | Drug Comparison | Drug Comparison Ltd | Independent web ordering platform: multi-wholesaler comparison, real-time tariff margin tracking, pack/brand optimisation, £100/month, 30-day free trial. drugcomparison.co.uk |
| 5 | Wavedata | WaveData Ltd | Price-intelligence data subscription: 60,000+ products, market prices vs Drug Tariff, updated every 15 minutes. Data, not a workflow tool. wavedata.co.uk |
| 6 | Dispensing Doctor Solutions | DDS Ltd | Consultancy: dispensary profitability audits, procurement stratification, training. Services, not software. dispensing-doctor.co.uk |

Adjacent but excluded as direct substitutes: Titan PMR and ProScript Connect (full PMRs with EPS for dispensing doctors but no evidenced margin tooling), Charac (patient-facing), DDA (trade body, not a vendor).

## 3. Feature matrix

Marks: **S** shipped (verified), **P** partial, **C** claimed (unverified), **A** absent. DC = Dispensing Check.

### Buying and price intelligence

| Feature | Dispex | e-CASS | PSUK | DrugComp | Wavedata | DC |
|---|---|---|---|---|---|---|
| Live multi-wholesaler price feed | A | S | P (own prices only) | S | S (data only) | A (manual entry by design) |
| Live Drug Tariff feed | P (monthly updates) | S | S (alerts) | S | S | A (manual entry) |
| Cheapest-supplier identification per line | P (monthly per-wholesaler formularies) | S | P | S | P (data, no workflow) | S (across entered quotes) |
| Price concession (NCSO) awareness | C (loss list updated for concessions) | A (not evidenced) | A | A (not evidenced) | P (market data shows spikes) | A (signposts NCSO in copy only) |
| Order building and transmission to wholesalers | A | S | S | S | A | A (by design) |
| Pre-transmission loss/over-tariff checks | A | S | S (over-tariff emails) | S | A | A (no ordering) |
| Pack and brand optimisation | C (formulary guidance) | S | P | S | A | A |

### Margin analysis

| Feature | Dispex | e-CASS | PSUK | DrugComp | Wavedata | DC |
|---|---|---|---|---|---|---|
| Per-line margin after clawback | A | S (user clawback input) | A | P (tariff margin; clawback not evidenced) | A | S |
| Clawback models (DD flat rate + pharmacy group rates) | A | P (single input) | A | A | A | S |
| Loss-making line identification | C (static list) | S | S (alerts) | S | P | S |
| Switch-saving quantification (£/month, £/year) | A | S (% savings on switches) | A | S | A | S |
| Whole-dispensary ledger incl. lines bought outside the platform | A | A (covers own orders only) | A | A (own orders) | A | S (anything entered) |
| Margin trend over time | A | P (monthly reports) | A | P (per period) | S (market level) | S (snapshots + trend chart) |
| Category profit breakdown | A | S (spend by supplier, line reports) | P | P | A | S |
| RAG margin-health bands | A | A | A | A | A | S |
| Cost-per-unit comparison | A | A (not evidenced) | A | A (not evidenced) | A | S |
| Benchmarking vs other practices | C (member benchmark form) | A | A | A | P (market averages) | A |
| Printable board report | A | S (monthly profit report) | P (savings reports) | P | A | S |

### Prescribing side

| Feature | Dispex | e-CASS | PSUK | DrugComp | Wavedata | DC |
|---|---|---|---|---|---|---|
| Dispensary-friendly formulary content | S/C (27 class comparisons, monthly) | A | C (profitability guide) | A | A | S (practice-authored entries) |
| Point-of-prescribing nudge inside EMIS/SystmOne | S (Nudger) | A | A | A | A | A |
| Price-blind prescriber view (commercial data stripped) | A | A | A | A | A | S (engine-enforced) |

### Non-feature dimensions

| Dimension | Dispex | e-CASS | PSUK | DrugComp | Wavedata | DC |
|---|---|---|---|---|---|---|
| Pricing | Membership, unpublished | Unpublished, buying-group model | Membership, unpublished | £100/month, 30-day trial | Credits from £500 | Free, open code |
| Self-service start | A (apply for membership) | A (account manager) | A (account manager) | S (trial sign-up) | A (manual onboarding) | S (open a file) |
| Offline capable | P (PDF formularies) | A | A | A | A | S (fully offline) |
| Where data lives | Vendor cloud (DispexCD: London DC) | Vendor cloud | Phoenix infrastructure | Vendor cloud | Vendor cloud | The practice's own browser |
| Patient data held | None evidenced | Order data | Order data | Order data | Price data | None at all |
| Stated DSPT / DCB0129 posture | None found | None found | None found | None found | None found | n/a (no data leaves device) |
| PMR / clinical system integration | EMIS + SystmOne (Nudger config) | EMIS Web native tab | EMIS (FMD) | EMIS partner | None | None (CSV only) |
| Training / support | Webinars, events | Business managers | Account-manager visits | Trial + docs | None described | README only |

## 4. Gap analysis

### Table stakes Dispensing Check is missing

1. **Live Drug Tariff data.** Every serious competitor knows current tariff prices; Dispensing Check makes the practice type them in. This is the single biggest adoption tax and it falls on the dimension the user ranked first, ease of adoption. (NHSBSA publishes Part VIII data monthly; the wholesaler side is licensed, the tariff side is not.)
2. **Price concession (NCSO) awareness.** Concessions materially change which lines are loss-makers. DHSC publishes the monthly list. Dispensing Check only mentions NCSO in body copy.
3. **A route from analysis to action.** e-CASS, Drug Comparison and PSUK end in a transmitted order. Dispensing Check ends in a flag. Even without wholesaler EDI, there is no exportable "switch list" or order sheet.
4. **Team-grade persistence.** localStorage in one browser profile, with manual JSON backup, is fragile for a multi-staff dispensary. Competitors are multi-user cloud accounts.
5. **Volume import.** Competitors see order volumes automatically. Dispensing Check needs monthly pack counts typed in; there is no ePACT2 or PMR-export mapping.

### Parity

- Per-line margin after clawback: parity with e-CASS, ahead of everyone else, and the only product modelling both the dispensing-doctor flat rate and pharmacy group rates.
- Loss-maker flagging and switch-saving quantification: parity with e-CASS and Drug Comparison, within the data the practice has entered.
- Reporting: the printable board report and trend charts are competitive with e-CASS's monthly reports.

### Where competitors are simply better

- **e-CASS** is better at live buying optimisation: real prices, real orders, clawback-adjusted line profit on actual purchasing, inside EMIS Web. Dispensing Check cannot see a single real price on its own.
- **Drug Comparison** is better at adoption-with-data: £100/month gets a working tool with live feeds in 30 days of free trial. Dispensing Check is free but arrives empty.
- **Dispex** is better on the prescribing side today: the Nudger fires inside EMIS and SystmOne at the moment of prescribing. Dispensing Check's formulary lives in a separate browser tab the prescriber must choose to open.

### White space nobody covers well

1. **Price-blind prescriber formulary as a product surface.** Dispex's Nudger is an alert configuration, not a UI, and it is not price-blind by design. Nobody else touches the prescribing side at all. Dispensing Check's engine-enforced commercial stripping is unique in the field.
2. **Offline, local-first, zero patient data.** Every competitor is cloud-dependent; the customer base is rural. No vendor makes an information-governance virtue of holding nothing.
3. **Whole-dispensary P&L.** Platform tools only see lines ordered through them. Nobody offers a complete ledger covering personally administered items, appliances and off-platform purchases.
4. **Transparent, self-service entry for single-site practices.** Only Drug Comparison publishes a price, and it is positioned at pharmacies. Everyone else requires membership applications or account managers.

## 5. Exceed plan

### Tier 1: Match (close the table stakes)

| # | Item | Effort | Rationale | Neutralises |
|---|------|--------|-----------|-------------|
| M1 | Drug Tariff import: parse the NHSBSA Part VIII monthly data (user-downloaded file, no licensing barrier) and auto-fill tariff prices by product match | M (file parsing + matching UI) | Removes the largest manual-entry burden; tariff data is public | Field |
| M2 | Concession (NCSO) list import: flag concession lines and recompute loss-makers at concession price | S (same import pattern, small list) | Loss-maker accuracy in the months it matters most | Dispex |
| M3 | Switch list export: one-click CSV/PDF order sheet of recommended supplier switches, grouped by wholesaler | S (data already computed) | Gives the analysis a route to action without EDI | e-CASS, Drug Comparison (partially) |
| M4 | Durable storage: export-reminder nudges, File System Access API auto-save to a practice-chosen folder, and import-merge rather than replace | M (merge semantics need care) | localStorage fragility is a real objection in a team setting | Field |
| M5 | Volume import: map pack counts from ePACT2 / PMR CSV exports onto products | M (column-mapping UI) | Kills the second manual-entry burden | e-CASS EMIS integration (partially) |

### Tier 2: Beat (win the user's top dimensions: UX, then features)

| # | Item | Effort | Rationale | Neutralises |
|---|------|--------|-----------|-------------|
| B1 | Five-minute first-run: guided onboarding that goes sample data, tariff import, first real product, first insight | S (UI flow over existing pieces) | Beat Drug Comparison's 30-day trial with a 5-minute no-sign-up start; nothing in the field starts faster than opening a file | Drug Comparison |
| B2 | Wholesaler statement import: CSV templates for AAH / Alliance / Phoenix invoice and quote exports the practice already receives | M (per-format parsing, fuzzy product matching) | Real buy prices without licensed feeds: the practice's own data, entered in seconds | e-CASS, Drug Comparison |
| B3 | Concession-aware margin forecasting: project next-month margin from trend plus concession status per line | M (engine extension + chart) | Deeper analytics than e-CASS's backward-looking monthly report | e-CASS |
| B4 | Accessibility and print polish to commercial grade: keyboard-complete navigation, WCAG AA contrast across themes, board report with charts | S-M (audit + fixes) | UX is the ranked top dimension; nobody in this field competes on craft | Field |

### Tier 3: Leapfrog (exploit the white space)

| # | Item | Effort | Rationale | Neutralises |
|---|------|--------|-----------|-------------|
| L1 | Prescriber formulary as a first-class surface: shareable read-only formulary link/file for the practice intranet, printable consulting-room one-pagers, and exportable EMIS/SystmOne alert text so practices can hand-configure Nudger-style prompts pointing at their own formulary | M | Owns the prescribing side with the only price-blind design in the field | Dispex Nudger |
| L2 | Zero-IG posture as a marketed feature: a one-page information-governance statement (no patient data, no cloud, nothing to DSPT-assess) shipped in the app and README | S | Converts the architecture into a procurement advantage no cloud vendor can copy | Field |
| L3 | Whole-dispensary P&L: explicit support for personally administered items, appliances and off-platform purchases as categories with their own clawback and reporting treatment | M-L (engine categories + VAT/fee nuances need domain validation) | The complete ledger nobody offers; platforms only see their own order flow | e-CASS |

### Stress test: why have competitors not done the leapfrog items already?

- **L1 (price-blind prescriber surface).** The incumbents with prescribing-side reach are buying groups and wholesalers whose revenue comes from order flow; their incentive is to put prices in front of buyers, not to build informationally separated prescriber tools that generate no orders. Dispex could do it but is an education and membership business with thin software capability; the Nudger is configuration inside someone else's system, which is exactly what a content company rather than a product company builds. The structural conflict is real, so this passes.
- **L2 (zero-IG, local-first posture).** Every incumbent's business model depends on holding the data: Wavedata's entire product is the collected price exhaust, Cambrian and PSUK monetise order flow through their platforms, Drug Comparison's value is its live central feeds. Local-first directly forfeits the data and the lock-in. They have not done it because it would dismantle how they make money, not because it lacks value to the practice. Passes.
- **L3 (whole-dispensary P&L).** Platform vendors only see lines ordered through them; covering off-platform purchases means asking users to do manual entry that produces no transactions and no revenue for the vendor. For a practice-owned tool the completeness is the point. The caveat: this is also genuinely laborious for the user, which is why M5/B2 (automated volume and price import) must land first or L3 inherits the manual-entry tax. Passes, conditional on import work.

### Sequencing note

M1, M2 and B1 are the highest leverage per unit of effort: they attack the manual-entry tax on the user's top-ranked dimension and need no licensing, no partnerships and no architecture change. L2 is nearly free and should ship with the next release. B2 is the hinge item: once the practice's own wholesaler statements flow in, Dispensing Check has real buy prices without ever touching licensed feeds, and the rest of the plan compounds.

## Sources

Competitor evidence: vendor pages of dispex.net, dispensingcd.co.uk, cambrianalliance.co.uk, psuk.co.uk, drugcomparison.co.uk, wavedata.co.uk, dispensing-doctor.co.uk, titanpmr.com, emishealth.com, dispensingdoctor.org, plus trade sources (thebusinessmagazine.co.uk, pharmacymentor.com, practiceindex.co.uk, pharmaco.co.uk), all accessed 11 June 2026 via search-served page copy (direct fetches blocked). Full URL list is held in the Phase 2 dossier. Dispensing Check evidence: repository code at v1.0.0.
