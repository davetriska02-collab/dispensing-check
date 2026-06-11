/* Dispensing Check — engine tests. Run: node test/engine.test.js (or npm test) */
'use strict';
const E = require('../engine.js');

let pass = 0;
let fail = 0;
function check(cond, msg) {
  if (cond) {
    console.log('  OK  ' + msg);
    pass++;
  } else {
    console.error('  FAIL  ' + msg);
    fail++;
    process.exitCode = 1;
  }
}
const approx = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const C = E.DEFAULT_CONFIG;

// clawback model
check(approx(E.deductionRateFor('generic', C), 0.1118), 'dispensing-doctor flat rate 11.18%');
check(approx(E.deductionRateFor('branded', { mode: 'pharmacyGroups', groupRates: { branded: 5 } }), 0.05), 'pharmacy group branded 5%');
check(E.deductionRateFor('generic', { mode: 'dispensingDoctor', ddRate: 150 }) === 1, 'clawback clamped to 100%');

// margins
const prof = {
  id: 'p1', name: 'Atorvastatin 20mg', pack: '28', category: 'generic', tariff: 1.43, monthlyPacks: 180,
  suppliers: [{ name: 'A', price: 0.78 }, { name: 'B', price: 0.62 }], currentSupplier: 'A',
};
const m = E.productMetrics(prof, C);
check(approx(m.netReimb, 1.43 * (1 - 0.1118)), 'net reimbursement applies clawback');
check(m.best.name === 'B' && approx(m.bestCost, 0.62), 'cheapest supplier detected');
check(approx(m.switchSavingMonthly, (0.78 - 0.62) * 180), 'switch saving = cost delta * packs');
check(approx(m.costPerUnit, 0.78 / 28), 'cost per unit computed from pack qty');
check(m.band === 'good', 'healthy margin banded good');

// blank price not treated as £0
const blank = { id: 'b', name: 'X', pack: '28', category: 'generic', tariff: 1, monthlyPacks: 10,
  suppliers: [{ name: 'A', price: 0.55 }, { name: 'B', price: '' }], currentSupplier: 'A' };
const bm = E.productMetrics(blank, C);
check(bm.best.name === 'A' && approx(bm.switchSavingMonthly, 0), 'blank-price supplier excluded (no fake saving)');

// loss maker
const loss = { id: 'l', name: 'Y', pack: '8', category: 'generic', tariff: 1.21, monthlyPacks: 40,
  suppliers: [{ name: 'A', price: 1.35 }], currentSupplier: 'A' };
check(E.productMetrics(loss, C).lossMaker === true, 'line bought above net reimbursement flagged loss');

// totals
const t = E.practiceTotals([prof, loss], C);
check(t.lossCount === 1 && t.switchableCount === 1, 'totals identify loss + switch lines');
check(approx(t.annualProfitCurrent, t.monthlyProfitCurrent * 12), 'annualised totals');

// category breakdown
const cb = E.categoryBreakdown([prof, { id: 'c', name: 'Z', pack: '28', category: 'branded', tariff: 5, monthlyPacks: 10, suppliers: [{ name: 'A', price: 4 }], currentSupplier: 'A' }], C);
check(cb.length === 2, 'category breakdown one row per category');

// CSV round trip + formula-injection guard
const csv = E.toCsv([prof]);
const back = E.parseCsv(csv);
check(back.length === 1 && back[0].suppliers.length === 2, 'CSV round-trips product + suppliers');
const danger = E.toCsv([{ id: 'd', name: '=cmd', pack: '1', category: 'generic', tariff: 1, monthlyPacks: 1, suppliers: [{ name: 'A', price: 1 }], currentSupplier: 'A' }]);
check(danger.indexOf("'=cmd") !== -1, 'CSV export guards formula-leading name');
check(E.parseCsv(danger)[0].name === '=cmd', 'guard stripped on re-import (lossless)');

// formulary / prescriber price-blindness
const entries = [
  {
    id: 'f1', therapeuticClass: 'Type 2 diabetes · SGLT2 inhibitor',
    preferred: { name: 'Dapagliflozin 10mg', dose: '28 tablets, once daily', productId: 'p1' },
    alternatives: [{ name: 'Empagliflozin 10mg', dose: 'clinically equivalent option' }],
    note: 'first line', cost: 12.34, margin: 5.0, // commercial fields that must NOT leak
  },
];
const pf = E.prescriberFormulary(entries);
check(pf.length === 1 && pf[0].items.length === 1, 'prescriber formulary groups by class');
const safe = pf[0].items[0];
const json = JSON.stringify(safe);
check(json.indexOf('12.34') === -1 && json.indexOf('margin') === -1 && json.indexOf('productId') === -1 && json.indexOf('cost') === -1,
  'prescriber-safe entry carries NO cost/margin/supplier/productId data');
check(safe.preferred.name === 'Dapagliflozin 10mg' && safe.alternatives[0].name === 'Empagliflozin 10mg', 'prescriber entry keeps clinical names + doses');

// snapshots
let h = E.upsertSnapshot([], { monthlyProfitCurrent: 100 }, '2026-05');
h = E.upsertSnapshot(h, { monthlyProfitCurrent: 120 }, '2026-06');
h = E.upsertSnapshot(h, { monthlyProfitCurrent: 130 }, '2026-06');
check(h.length === 2 && h[1].monthlyProfitCurrent === 130, 'snapshot upsert dedupes by month, keeps latest');

// ── parsePackQty ────────────────────────────────────────────────────────────
check(E.parsePackQty('28') === 28, 'parsePackQty: plain integer');
check(E.parsePackQty('no digits') === null, 'parsePackQty: no digits returns null');
check(E.parsePackQty('0') === null, 'parsePackQty: zero returns null (must be > 0)');
check(E.parsePackQty('2.5ml') === 2.5, 'parsePackQty: decimal with unit');

// ── clampPct ─────────────────────────────────────────────────────────────────
check(E.clampPct(-5) === 0, 'clampPct: negative clamped to 0');
check(E.clampPct('abc') === 0, 'clampPct: non-numeric clamped to 0');

// ── priceValue ───────────────────────────────────────────────────────────────
check(E.priceValue('abc') === null, 'priceValue: non-numeric string returns null');
check(E.priceValue(0) === 0, 'priceValue: zero is a valid (non-null) price');

// ── marginBand ───────────────────────────────────────────────────────────────
check(E.marginBand(null) === null, 'marginBand: null pct returns null');
const customT = { green: 30, amber: 15 };
check(E.marginBand(35, customT) === 'good', 'marginBand: custom thresholds — above green is good');
check(E.marginBand(20, customT) === 'watch', 'marginBand: custom thresholds — between amber and green is watch');
check(E.marginBand(10, customT) === 'poor', 'marginBand: custom thresholds — below amber is poor');

// ── parseCsv multi-row merge ─────────────────────────────────────────────────
const multiCsv = [
  'name,pack,category,tariff,monthlyPacks,supplier,price,current',
  'Metformin 500mg,28,generic,1.50,10,Alliance,1.20,yes',
  'Metformin 500mg,28,generic,,5,Phoenix,1.10,',
].join('\n');
const multiParsed = E.parseCsv(multiCsv);
check(multiParsed.length === 1, 'parseCsv multi-row: two rows with same name+pack yield ONE product');
check(multiParsed[0].suppliers.length === 2, 'parseCsv multi-row: both suppliers present');
check(multiParsed[0].tariff === 1.50, 'parseCsv multi-row: tariff from first row present');
check(multiParsed[0].currentSupplier === 'Alliance', 'parseCsv multi-row: current flag marks currentSupplier');

// backfill: second row has tariff, first has none
const backfillCsv = [
  'name,pack,category,tariff,monthlyPacks,supplier,price,current',
  'Omeprazole 20mg,28,generic,,10,AAH,0.80,',
  'Omeprazole 20mg,28,generic,2.00,,DE,0.75,yes',
].join('\n');
const backfilled = E.parseCsv(backfillCsv);
check(backfilled[0].tariff === 2.00, 'parseCsv multi-row: tariff backfilled from second row');

// ── toCsv empty suppliers ────────────────────────────────────────────────────
const noSupplierProduct = { id: 'ns1', name: 'TestDrug', pack: '56', category: 'generic', tariff: 2.0, monthlyPacks: 5, suppliers: [], currentSupplier: null };
const noSupplierCsv = E.toCsv([noSupplierProduct]);
const noSupplierRows = noSupplierCsv.trim().split('\n');
check(noSupplierRows.length === 2, 'toCsv empty suppliers: emits header + one data row');
const noSupplierBack = E.parseCsv(noSupplierCsv);
check(noSupplierBack.length === 1, 'toCsv empty suppliers: round-trips to one product');
check(noSupplierBack[0].suppliers.length === 0, 'toCsv empty suppliers: product has zero suppliers after round-trip');

// ── upsertSnapshot cap ───────────────────────────────────────────────────────
let sh = [];
sh = E.upsertSnapshot(sh, { v: 1 }, '2025-01', 3);
sh = E.upsertSnapshot(sh, { v: 2 }, '2025-02', 3);
sh = E.upsertSnapshot(sh, { v: 3 }, '2025-03', 3);
sh = E.upsertSnapshot(sh, { v: 4 }, '2025-04', 3);
check(sh.length === 3, 'upsertSnapshot cap: inserting 4 with cap=3 yields 3 entries');
check(sh[0].ym === '2025-02', 'upsertSnapshot cap: oldest entry dropped');
check(sh[2].ym === '2025-04', 'upsertSnapshot cap: order is ascending by ym');

// ── prescriberFormulary: missing therapeuticClass -> Uncategorised ────────────
const uncatEntries = [
  { id: 'u1', therapeuticClass: '', preferred: { name: 'Drug A', dose: '1 tab' }, alternatives: [], note: '' },
  { id: 'u2', preferred: { name: 'Drug B', dose: '2 tabs' }, alternatives: [], note: '' },
];
const uncatResult = E.prescriberFormulary(uncatEntries);
check(uncatResult.length === 1 && uncatResult[0].therapeuticClass === 'Uncategorised', 'prescriberFormulary: blank/missing therapeuticClass groups under Uncategorised');
check(uncatResult[0].items.length === 2, 'prescriberFormulary: both items under Uncategorised');

// ── toCsv negative tariff guard ──────────────────────────────────────────────
const negTariffProduct = {
  id: 'neg1', name: 'NegDrug', pack: '30', category: 'generic',
  tariff: -5, monthlyPacks: 10,
  suppliers: [{ name: 'SupA', price: -1.5 }], currentSupplier: 'SupA',
};
const negCsv = E.toCsv([negTariffProduct]);
// The raw CSV must NOT contain a bare cell beginning with '-' for tariff or price
const negDataLine = negCsv.split('\n')[1];
const negCells = negDataLine.split(',');
check(!negCells[3].startsWith('-'), 'toCsv negative tariff: raw tariff cell does not start with bare -');
check(!negCells[6].startsWith('-'), 'toCsv negative price: raw price cell does not start with bare -');
check(negCells[3].startsWith("'"), 'toCsv negative tariff: tariff cell guarded with leading apostrophe');
// Round-trip must be lossless
const negBack = E.parseCsv(negCsv);
check(negBack.length === 1, 'toCsv negative tariff round-trip: one product');
check(negBack[0].tariff === -5, 'toCsv negative tariff round-trip: tariff is -5');
check(negBack[0].suppliers[0].price === -1.5, 'toCsv negative tariff round-trip: price is -1.5');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
