/* Dispensing Check — pure calculation engine.
 *
 * No DOM, no storage, no framework. Loads as a plain <script> (exposes
 * window.DispensingEngine) and as a CommonJS module (for the Node tests).
 *
 * Domain: UK dispensing GP practices buy medicines from wholesalers but are
 * reimbursed at Drug Tariff prices minus the NHS discount-deduction "clawback".
 * Profit on a line = tariff * (1 - clawback) - purchase cost. All prices are
 * entered by the practice; no licensed price feeds are bundled.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DispensingEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_CONFIG = {
    mode: 'dispensingDoctor', // 'dispensingDoctor' | 'pharmacyGroups'
    ddRate: 11.18, // flat clawback % for dispensing-doctor mode (SFE reference)
    groupRates: { generic: 20.0, branded: 5.0, appliance: 9.85, dnd: 0.0 },
    thresholds: { green: 25, amber: 10 }, // RAG bands on net-margin %
  };

  const CATEGORIES = [
    { id: 'generic', label: 'Generic' },
    { id: 'branded', label: 'Branded' },
    { id: 'appliance', label: 'Appliance' },
    { id: 'dnd', label: 'Discount not deducted' },
  ];

  function clampPct(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 100) return 100;
    return v;
  }

  function num(n) {
    const v = Number(n);
    return Number.isFinite(v) ? v : 0;
  }

  // Blank / missing / non-numeric price => null (NOT 0), so an unpriced supplier
  // is never mistaken for a free one and never wins "cheapest".
  function priceValue(p) {
    if (p === '' || p == null) return null;
    const v = Number(p);
    return Number.isFinite(v) ? v : null;
  }

  function deductionRateFor(category, config) {
    const cfg = config || DEFAULT_CONFIG;
    if (cfg.mode === 'dispensingDoctor') return clampPct(cfg.ddRate) / 100;
    const rates = cfg.groupRates || DEFAULT_CONFIG.groupRates;
    const r = rates[category];
    return clampPct(r == null ? 0 : r) / 100;
  }

  function parsePackQty(pack) {
    const m = String(pack == null ? '' : pack).match(/\d+(?:\.\d+)?/);
    if (!m) return null;
    const v = Number(m[0]);
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  function marginBand(pct, thresholds) {
    if (pct == null || !Number.isFinite(Number(pct))) return null;
    const t = thresholds || DEFAULT_CONFIG.thresholds;
    const green = Number.isFinite(Number(t.green)) ? Number(t.green) : 25;
    const amber = Number.isFinite(Number(t.amber)) ? Number(t.amber) : 10;
    const p = Number(pct);
    if (p >= green) return 'good';
    if (p >= amber) return 'watch';
    return 'poor';
  }

  function productMetrics(product, config) {
    const cfg = config || DEFAULT_CONFIG;
    const suppliers = Array.isArray(product && product.suppliers) ? product.suppliers : [];
    const priced = suppliers
      .map((s) => ({ name: String((s && s.name) || '').trim(), price: priceValue(s && s.price) }))
      .filter((s) => s.name !== '' && s.price !== null);

    const tariffBase = num(product && product.tariff);
    const concessionPriceVal = priceValue(product && product.concessionPrice);
    const onConcession = concessionPriceVal !== null && Number.isFinite(concessionPriceVal) && concessionPriceVal > 0;
    const tariff = onConcession ? concessionPriceVal : tariffBase;
    const monthlyPacks = Math.max(0, num(product && product.monthlyPacks));
    const rate = deductionRateFor(product && product.category, cfg);
    const netReimb = tariff * (1 - rate);

    let best = null;
    let worst = null;
    for (const s of priced) {
      if (best === null || s.price < best.price) best = s;
      if (worst === null || s.price > worst.price) worst = s;
    }

    let current = null;
    if (product && product.currentSupplier) {
      current = priced.find((s) => s.name === product.currentSupplier) || null;
    }
    if (!current) current = best;

    const bestCost = best ? best.price : null;
    const currentCost = current ? current.price : null;
    const marginPerPackBest = bestCost == null ? null : netReimb - bestCost;
    const marginPerPackCurrent = currentCost == null ? null : netReimb - currentCost;
    const marginPct =
      marginPerPackCurrent == null || netReimb <= 0 ? null : (marginPerPackCurrent / netReimb) * 100;

    const monthlyProfitCurrent = marginPerPackCurrent == null ? 0 : marginPerPackCurrent * monthlyPacks;
    const monthlyProfitBest = marginPerPackBest == null ? 0 : marginPerPackBest * monthlyPacks;
    const switchSavingMonthly =
      currentCost == null || bestCost == null ? 0 : Math.max(0, (currentCost - bestCost) * monthlyPacks);

    const packQty = parsePackQty(product && product.pack);
    const costPerUnit = packQty && currentCost != null ? currentCost / packQty : null;
    const bestCostPerUnit = packQty && bestCost != null ? bestCost / packQty : null;

    return {
      id: (product && product.id) || null,
      name: String((product && product.name) || '').trim(),
      pack: String((product && product.pack) || '').trim(),
      category: (product && product.category) || 'generic',
      tariff,
      tariffBase,
      onConcession,
      monthlyPacks,
      rate,
      netReimb,
      best,
      worst,
      current,
      bestCost,
      currentCost,
      hasCost: currentCost != null,
      packQty,
      costPerUnit,
      bestCostPerUnit,
      marginPerPackBest,
      marginPerPackCurrent,
      marginPct,
      band: marginBand(marginPct, cfg.thresholds),
      monthlyProfitCurrent,
      monthlyProfitBest,
      annualProfitCurrent: monthlyProfitCurrent * 12,
      annualProfitBest: monthlyProfitBest * 12,
      switchSavingMonthly,
      switchSavingAnnual: switchSavingMonthly * 12,
      lossMaker: marginPerPackCurrent != null && marginPerPackCurrent < 0,
      switchable: switchSavingMonthly > 0,
    };
  }

  function practiceTotals(products, config) {
    const list = Array.isArray(products) ? products : [];
    const t = {
      productCount: list.length,
      pricedCount: 0,
      lossCount: 0,
      switchableCount: 0,
      monthlyReimb: 0,
      monthlySpendCurrent: 0,
      monthlyProfitCurrent: 0,
      monthlyProfitBest: 0,
      switchSavingMonthly: 0,
      lossMakers: [],
      switchOpportunities: [],
    };
    for (const p of list) {
      const m = productMetrics(p, config);
      if (m.hasCost) t.pricedCount += 1;
      if (m.lossMaker) {
        t.lossCount += 1;
        t.lossMakers.push(m);
      }
      if (m.switchable) {
        t.switchableCount += 1;
        t.switchOpportunities.push(m);
      }
      t.monthlyReimb += m.netReimb * m.monthlyPacks;
      if (m.currentCost != null) t.monthlySpendCurrent += m.currentCost * m.monthlyPacks;
      t.monthlyProfitCurrent += m.monthlyProfitCurrent;
      t.monthlyProfitBest += m.monthlyProfitBest;
      t.switchSavingMonthly += m.switchSavingMonthly;
    }
    t.annualProfitCurrent = t.monthlyProfitCurrent * 12;
    t.annualProfitBest = t.monthlyProfitBest * 12;
    t.switchSavingAnnual = t.switchSavingMonthly * 12;
    t.lossMakers.sort((a, b) => a.monthlyProfitCurrent - b.monthlyProfitCurrent);
    t.switchOpportunities.sort((a, b) => b.switchSavingMonthly - a.switchSavingMonthly);
    return t;
  }

  function categoryBreakdown(products, config) {
    const list = Array.isArray(products) ? products : [];
    const by = new Map();
    for (const p of list) {
      const m = productMetrics(p, config);
      const id = CATEGORIES.some((c) => c.id === m.category) ? m.category : 'generic';
      let row = by.get(id);
      if (!row) {
        row = {
          category: id,
          label: (CATEGORIES.find((c) => c.id === id) || CATEGORIES[0]).label,
          productCount: 0,
          monthlyProfitCurrent: 0,
          switchSavingMonthly: 0,
          lossCount: 0,
        };
        by.set(id, row);
      }
      row.productCount += 1;
      row.monthlyProfitCurrent += m.monthlyProfitCurrent;
      row.switchSavingMonthly += m.switchSavingMonthly;
      if (m.lossMaker) row.lossCount += 1;
    }
    return [...by.values()].sort((a, b) => b.monthlyProfitCurrent - a.monthlyProfitCurrent);
  }

  // ── Formulary (price-blind prescriber view) ─────────────────────────────────
  //
  // A formulary entry agrees, per therapeutic choice, the PREFERRED product (with
  // dose) and clinically-equivalent ALTERNATIVES. The prescriber view renders
  // these grouped by therapeutic class with NO cost/margin. Optionally a preferred
  // line links to a ledger product (productId) so partners can see its margin —
  // that link is never followed in the prescriber view.

  function groupFormularyByClass(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const by = new Map();
    for (const e of list) {
      if (!e) continue;
      const cls = String(e.therapeuticClass || 'Uncategorised').trim() || 'Uncategorised';
      if (!by.has(cls)) by.set(cls, []);
      by.get(cls).push(e);
    }
    return [...by.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([therapeuticClass, items]) => ({ therapeuticClass, items }));
  }

  // Strip every commercial field from a formulary entry for the prescriber view.
  // Defence-in-depth: even if a caller mishandles the object, the prescriber
  // payload provably carries no cost/margin/price/supplier data.
  function prescriberSafeEntry(e) {
    if (!e || typeof e !== 'object') return null;
    const safeAlts = Array.isArray(e.alternatives)
      ? e.alternatives.map((a) => ({ name: String((a && a.name) || ''), dose: String((a && a.dose) || '') }))
      : [];
    return {
      id: e.id || null,
      therapeuticClass: String(e.therapeuticClass || ''),
      preferred: {
        name: String((e.preferred && e.preferred.name) || ''),
        dose: String((e.preferred && e.preferred.dose) || ''),
      },
      alternatives: safeAlts,
      note: String(e.note || ''),
    };
  }

  function prescriberFormulary(entries) {
    return groupFormularyByClass((Array.isArray(entries) ? entries : []).map(prescriberSafeEntry).filter(Boolean));
  }

  // ── Snapshots (margin trend) ────────────────────────────────────────────────
  function upsertSnapshot(history, snapshot, ymKey, cap) {
    const lim = Math.max(1, cap || 24);
    const list = Array.isArray(history) ? history.filter((s) => s && s.ym !== ymKey) : [];
    list.push(Object.assign({}, snapshot, { ym: ymKey }));
    list.sort((a, b) => String(a.ym).localeCompare(String(b.ym)));
    return list.slice(-lim);
  }

  function ymKeyOf(date) {
    const d = date || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  // ── CSV import / export ─────────────────────────────────────────────────────
  const CSV_HEADER = 'name,pack,category,tariff,monthlyPacks,supplier,price,current';
  const CSV_FORMULA_LEAD = /^[=+\-@\t\r]/;

  function splitCsvRows(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') {
            field += '"';
            i++;
          } else inQuotes = false;
        } else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && s[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else field += c;
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function parseMoney(v) {
    if (v == null) return 0;
    const n = Number(String(v).replace(/[£\s,]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function fmtNum(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '';
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  }

  function normaliseCategory(v) {
    const s = String(v || '').trim().toLowerCase();
    if (s.startsWith('brand')) return 'branded';
    if (s.startsWith('appl')) return 'appliance';
    if (s === 'dnd' || s.includes('not deduct')) return 'dnd';
    return 'generic';
  }

  function truthyFlag(v) {
    const s = String(v || '').trim().toLowerCase();
    return s === '1' || s === 'yes' || s === 'true' || s === 'y' || s === 'x';
  }

  function unguardCell(s) {
    return /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s;
  }

  function makeId() {
    return 'rx_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function parseCsv(text) {
    const rows = splitCsvRows(text);
    if (rows.length === 0) return [];
    let start = 0;
    if (rows[0][0] && rows[0][0].trim().toLowerCase() === 'name') start = 1;
    const byKey = new Map();
    for (let i = start; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.every((c) => String(c).trim() === '')) continue;
      const name = unguardCell((r[0] || '').trim());
      if (!name) continue;
      const pack = unguardCell((r[1] || '').trim());
      const category = normaliseCategory(r[2]);
      const tariff = parseMoney(unguardCell((r[3] || '').trim()));
      const monthlyPacks = Math.max(0, Math.round(num(parseMoney(unguardCell((r[4] || '').trim())))));
      const supplierName = unguardCell((r[5] || '').trim());
      const priceCell = unguardCell((r[6] || '').trim());
      const price = priceCell === '' ? '' : parseMoney(priceCell);
      const isCurrent = truthyFlag(r[7]);
      const key = name.toLowerCase() + ' ' + pack.toLowerCase();
      let prod = byKey.get(key);
      if (!prod) {
        prod = { id: makeId(), name, pack, category, tariff, monthlyPacks, suppliers: [], currentSupplier: null };
        byKey.set(key, prod);
      } else {
        if (!prod.tariff && tariff) prod.tariff = tariff;
        if (!prod.monthlyPacks && monthlyPacks) prod.monthlyPacks = monthlyPacks;
      }
      if (supplierName) {
        prod.suppliers.push({ name: supplierName, price });
        if (isCurrent) prod.currentSupplier = supplierName;
      }
    }
    return [...byKey.values()];
  }

  function csvCell(v) {
    let s = String(v == null ? '' : v);
    if (CSV_FORMULA_LEAD.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(products) {
    const list = Array.isArray(products) ? products : [];
    const lines = [CSV_HEADER];
    for (const p of list) {
      const suppliers = Array.isArray(p.suppliers) && p.suppliers.length ? p.suppliers : [{ name: '', price: '' }];
      for (const s of suppliers) {
        const current = s.name && s.name === p.currentSupplier ? 'yes' : '';
        lines.push(
          [
            csvCell(p.name),
            csvCell(p.pack),
            csvCell(p.category || 'generic'),
            csvCell(fmtNum(p.tariff)),
            csvCell(fmtNum(p.monthlyPacks)),
            csvCell(s.name || ''),
            s.price === '' ? '' : csvCell(fmtNum(s.price)),
            current,
          ].join(',')
        );
      }
    }
    return lines.join('\n');
  }

  // ── Merge helpers (JSON backup import) ─────────────────────────────────────

  // Canonical key for a product: lowercase name + ' ' + lowercase pack.
  // Mirrors the grouping key used in parseCsv.
  function productKeyOf(p) {
    return String((p && p.name) || '').toLowerCase() + ' ' + String((p && p.pack) || '').toLowerCase();
  }

  // Merge two product arrays. Matching priority: id > productKeyOf.
  // Incoming fields replace existing fields on a match, but the existing id is kept.
  // Unmatched incoming are appended as-is (or given a new id if missing).
  // Existing with no incoming match are kept untouched. Inputs are never mutated.
  function mergeProducts(existing, incoming) {
    const existList = Array.isArray(existing) ? existing : [];
    const inList = Array.isArray(incoming) ? incoming : [];

    // Build lookup maps over existing entries
    const byId = new Map();
    const byKey = new Map();
    for (const e of existList) {
      if (e && e.id != null) byId.set(String(e.id), e);
      const k = productKeyOf(e);
      if (!byKey.has(k)) byKey.set(k, e);
    }

    // Track which existing entries were matched (by identity)
    const matched = new Set(); // stores existing objects that got a match
    const updates = new Map(); // existing-object -> merged replacement

    for (const inc of inList) {
      if (!inc) continue;
      let existObj = null;
      if (inc.id != null) existObj = byId.get(String(inc.id)) || null;
      if (!existObj) existObj = byKey.get(productKeyOf(inc)) || null;

      if (existObj) {
        matched.add(existObj);
        // Incoming fields replace, but keep existing id
        updates.set(existObj, Object.assign({}, inc, { id: existObj.id }));
      }
    }

    const result = [];

    // Existing entries: replaced if matched, kept if not
    for (const e of existList) {
      if (updates.has(e)) {
        result.push(updates.get(e));
      } else {
        result.push(Object.assign({}, e));
      }
    }

    // Append unmatched incoming
    for (const inc of inList) {
      if (!inc) continue;
      let existObj = null;
      if (inc.id != null) existObj = byId.get(String(inc.id)) || null;
      if (!existObj) existObj = byKey.get(productKeyOf(inc)) || null;
      if (!existObj) {
        // Unmatched: append as-is, assign id if missing
        result.push(Object.assign({}, inc, { id: inc.id != null ? inc.id : makeId() }));
      }
    }

    return result;
  }

  // Canonical key for a formulary entry: lowercase therapeuticClass + '|' + lowercase preferred.name
  function formularyKeyOf(e) {
    return String((e && e.therapeuticClass) || '').toLowerCase() + '|' +
      String((e && e.preferred && e.preferred.name) || '').toLowerCase();
  }

  // Merge two formulary entry arrays. Matching priority: id > formularyKeyOf.
  // Same semantics as mergeProducts.
  function mergeFormulary(existing, incoming) {
    const existList = Array.isArray(existing) ? existing : [];
    const inList = Array.isArray(incoming) ? incoming : [];

    const byId = new Map();
    const byKey = new Map();
    for (const e of existList) {
      if (e && e.id != null) byId.set(String(e.id), e);
      const k = formularyKeyOf(e);
      if (!byKey.has(k)) byKey.set(k, e);
    }

    const updates = new Map();

    for (const inc of inList) {
      if (!inc) continue;
      let existObj = null;
      if (inc.id != null) existObj = byId.get(String(inc.id)) || null;
      if (!existObj) existObj = byKey.get(formularyKeyOf(inc)) || null;

      if (existObj) {
        updates.set(existObj, Object.assign({}, inc, { id: existObj.id }));
      }
    }

    const result = [];

    for (const e of existList) {
      if (updates.has(e)) {
        result.push(updates.get(e));
      } else {
        result.push(Object.assign({}, e));
      }
    }

    for (const inc of inList) {
      if (!inc) continue;
      let existObj = null;
      if (inc.id != null) existObj = byId.get(String(inc.id)) || null;
      if (!existObj) existObj = byKey.get(formularyKeyOf(inc)) || null;
      if (!existObj) {
        result.push(Object.assign({}, inc, { id: inc.id != null ? inc.id : makeId() }));
      }
    }

    return result;
  }

  // Merge two snapshot history arrays. Union by ym; incoming wins on collision.
  // Result is sorted ascending by ym and capped to the last `cap` entries (default 24).
  // Inputs are never mutated.
  function mergeHistory(existing, incoming, cap) {
    const existList = Array.isArray(existing) ? existing : [];
    const inList = Array.isArray(incoming) ? incoming : [];
    const lim = Math.max(1, cap || 24);

    // Build a map from ym -> snapshot; existing first, then incoming overwrites
    const byYm = new Map();
    for (const s of existList) {
      if (s && s.ym != null) byYm.set(String(s.ym), Object.assign({}, s));
    }
    for (const s of inList) {
      if (s && s.ym != null) byYm.set(String(s.ym), Object.assign({}, s));
    }

    const result = [...byYm.values()];
    result.sort((a, b) => String(a.ym).localeCompare(String(b.ym)));
    return result.slice(-lim);
  }

  return {
    DEFAULT_CONFIG,
    CATEGORIES,
    CSV_HEADER,
    clampPct,
    priceValue,
    parsePackQty,
    marginBand,
    deductionRateFor,
    productMetrics,
    practiceTotals,
    categoryBreakdown,
    groupFormularyByClass,
    prescriberSafeEntry,
    prescriberFormulary,
    upsertSnapshot,
    ymKeyOf,
    splitCsvRows,
    parseMoney,
    parseCsv,
    toCsv,
    makeId,
    productKeyOf,
    mergeProducts,
    mergeFormulary,
    mergeHistory,
  };
});
