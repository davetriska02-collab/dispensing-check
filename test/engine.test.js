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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
