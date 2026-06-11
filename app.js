/* Dispensing Check — UI controller (vanilla JS, localStorage). */
(function () {
  'use strict';
  const E = window.DispensingEngine;

  const KEYS = {
    products: 'dc.products',
    config: 'dc.config',
    formulary: 'dc.formulary',
    history: 'dc.history',
    role: 'dc.role',
    theme: 'dc.theme',
    practice: 'dc.practiceName',
    pin: 'dc.partnerPin',
  };

  const state = {
    products: load(KEYS.products, []),
    config: mergeConfig(load(KEYS.config, null)),
    formulary: load(KEYS.formulary, []),
    history: load(KEYS.history, []),
    role: localStorage.getItem(KEYS.role) === 'prescriber' ? 'prescriber' : 'partner',
    practiceName: localStorage.getItem(KEYS.practice) || '',
    pin: localStorage.getItem(KEYS.pin) || '',
    view: 'ledger',
  };

  function load(k, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(k));
      return v == null ? fallback : v;
    } catch (_) {
      return fallback;
    }
  }
  function save(k, v) {
    localStorage.setItem(k, JSON.stringify(v));
  }
  function mergeConfig(raw) {
    const d = E.DEFAULT_CONFIG;
    const base = {
      mode: d.mode,
      ddRate: d.ddRate,
      groupRates: Object.assign({}, d.groupRates),
      thresholds: Object.assign({}, d.thresholds),
    };
    if (raw && typeof raw === 'object') {
      if (raw.mode === 'pharmacyGroups' || raw.mode === 'dispensingDoctor') base.mode = raw.mode;
      if (isFinite(Number(raw.ddRate))) base.ddRate = E.clampPct(raw.ddRate);
      if (raw.groupRates) for (const k of Object.keys(base.groupRates)) if (isFinite(Number(raw.groupRates[k]))) base.groupRates[k] = E.clampPct(raw.groupRates[k]);
      if (raw.thresholds) {
        if (isFinite(Number(raw.thresholds.green))) base.thresholds.green = E.clampPct(raw.thresholds.green);
        if (isFinite(Number(raw.thresholds.amber))) base.thresholds.amber = E.clampPct(raw.thresholds.amber);
      }
    }
    return base;
  }

  // ── formatting ──
  function gbp(n) {
    const v = Number(n) || 0;
    const r = Math.round(v * 100) / 100;
    return (r < 0 ? '−£' : '£') + Math.abs(r).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function gbp0(n) {
    const v = Number(n) || 0;
    const r = Math.round(v);
    return (r < 0 ? '−£' : '£') + Math.abs(r).toLocaleString('en-GB');
  }
  function pct(n) {
    if (n == null || !isFinite(Number(n))) return '—';
    return (Number(n) >= 0 ? '' : '−') + Math.abs(Number(n)).toFixed(1) + '%';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const $ = (sel, el) => (el || document).querySelector(sel);
  const content = $('#content');
  const nav = $('#nav');

  // ── snapshots ──
  function recordSnapshot() {
    const t = E.practiceTotals(state.products, state.config);
    const snap = {
      monthlyProfitCurrent: Math.round(t.monthlyProfitCurrent * 100) / 100,
      switchSavingMonthly: Math.round(t.switchSavingMonthly * 100) / 100,
      productCount: t.productCount,
    };
    const next = E.upsertSnapshot(state.history, snap, E.ymKeyOf());
    if (JSON.stringify(next) !== JSON.stringify(state.history)) {
      state.history = next;
      save(KEYS.history, state.history);
    }
  }

  // ── theme & role ──
  function applyTheme() {
    const theme = localStorage.getItem(KEYS.theme) || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  }
  $('#themeBtn').addEventListener('click', () => {
    const cur = localStorage.getItem(KEYS.theme) || 'dark';
    localStorage.setItem(KEYS.theme, cur === 'dark' ? 'light' : 'dark');
    applyTheme();
  });

  function setRole(role) {
    if (role === 'partner' && state.role !== 'partner' && state.pin) {
      const entered = prompt('Enter partner PIN to view prices and margins:');
      if (entered == null) return;
      if (entered !== state.pin) {
        alert('Incorrect PIN.');
        return;
      }
    }
    state.role = role;
    localStorage.setItem(KEYS.role, role);
    if (role === 'prescriber') state.view = 'prescriber';
    else if (state.view === 'prescriber') state.view = 'ledger';
    render();
  }
  $('#roleSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-role]');
    if (b) setRole(b.dataset.role);
  });

  // ── nav ──
  const PARTNER_NAV = [
    { id: 'ledger', label: 'Margin ledger' },
    { id: 'formulary', label: 'Formulary' },
    { id: 'prescriber', label: 'Prescriber view' },
    { id: 'data', label: 'Import / export' },
    { id: 'settings', label: 'Settings' },
  ];

  function renderNav() {
    $('#practiceName').textContent = state.practiceName || 'UK dispensing margin tool';
    document.querySelectorAll('#roleSeg button').forEach((b) => b.classList.toggle('active', b.dataset.role === state.role));
    if (state.role === 'prescriber') {
      nav.innerHTML = '';
      nav.style.display = 'none';
      return;
    }
    nav.style.display = '';
    nav.innerHTML = PARTNER_NAV.map((n) => `<button data-view="${n.id}" class="${state.view === n.id ? 'active' : ''}">${esc(n.label)}</button>`).join('');
    nav.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        state.view = b.dataset.view;
        render();
      })
    );
  }

  function render() {
    applyTheme();
    renderNav();
    if (state.role === 'prescriber') return renderPrescriber();
    if (state.view === 'formulary') return renderFormulary();
    if (state.view === 'prescriber') return renderPrescriber();
    if (state.view === 'data') return renderData();
    if (state.view === 'settings') return renderSettings();
    return renderLedger();
  }

  // ── sparkline ──
  function sparkline(history) {
    const pts = (history || []).map((s) => Number(s.monthlyProfitCurrent)).filter((n) => isFinite(n));
    if (pts.length < 2) return '';
    const w = 96, h = 24, min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1, step = w / (pts.length - 1);
    const co = pts.map((v, i) => [i * step, h - 2 - ((v - min) / span) * (h - 4)]);
    const d = co.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    const up = pts[pts.length - 1] >= pts[0];
    const stroke = up ? 'var(--green)' : 'var(--red)';
    const last = co[co.length - 1];
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2" fill="${stroke}"/></svg>`;
  }

  // ── LEDGER (partner) ──
  function renderLedger() {
    recordSnapshot();
    const t = E.practiceTotals(state.products, state.config);
    const rate = state.config.mode === 'dispensingDoctor' ? `Dispensing doctor · ${state.config.ddRate}% flat clawback` : 'Pharmacy group rates';
    const metrics = state.products.map((p) => ({ p, m: E.productMetrics(p, state.config) }));
    const bd = E.categoryBreakdown(state.products, state.config);

    content.innerHTML = `
      <h1>Margin ledger</h1>
      <p class="sub">${esc(rate)} · ${t.pricedCount}/${t.productCount} products priced</p>
      <div class="btn-row">
        <button class="btn btn-primary" data-a="add">+ Product</button>
        ${t.switchableCount ? `<button class="btn" data-a="switchall">Switch all → save ${gbp0(t.switchSavingMonthly)}/mo</button>` : ''}
        <button class="btn" data-a="print">Board report</button>
        ${state.products.length ? '' : '<button class="btn" data-a="sample">Load worked example</button>'}
      </div>
      ${cards(t)}
      ${state.products.length === 0 ? emptyLedger() : `<div class="panel"><div style="overflow-x:auto">${ledgerTable(metrics)}</div></div>`}
      ${breakdownPanel(bd)}
      ${opportunities(t)}`;

    bindAll('[data-a="add"]', () => editProduct(null));
    bindAll('[data-a="switchall"]', () => switchAll());
    bindAll('[data-a="print"]', () => printReport());
    bindAll('[data-a="sample"]', () => {
      state.products = sampleProducts();
      state.formulary = sampleFormulary(state.products);
      save(KEYS.products, state.products);
      save(KEYS.formulary, state.formulary);
      render();
    });
    content.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editProduct(b.dataset.edit)));
    content.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', () => {
        const p = state.products.find((x) => x.id === b.dataset.del);
        if (p && confirm(`Delete "${p.name || 'this product'}"?`)) {
          state.products = state.products.filter((x) => x.id !== b.dataset.del);
          save(KEYS.products, state.products);
          render();
        }
      })
    );
  }
  function bindAll(sel, fn) {
    content.querySelectorAll(sel).forEach((el) => el.addEventListener('click', fn));
  }
  const bindMaybe = bindAll;

  function cards(t) {
    return `<div class="cards">
      <div class="card"><div class="label">Monthly margin (current)</div><div class="top"><div class="val ${t.monthlyProfitCurrent >= 0 ? 'pos' : 'neg'}">${gbp0(t.monthlyProfitCurrent)}</div>${sparkline(state.history)}</div><div class="foot">${gbp0(t.annualProfitCurrent)}/yr</div></div>
      <div class="card ${t.switchSavingMonthly > 0 ? 'accent' : ''}"><div class="label">Saving if you switch supplier</div><div class="val ${t.switchSavingMonthly > 0 ? 'acc' : ''}">${gbp0(t.switchSavingMonthly)}</div><div class="foot">${gbp0(t.switchSavingAnnual)}/yr · ${t.switchableCount} line(s)</div></div>
      <div class="card ${t.lossCount > 0 ? 'warn' : ''}"><div class="label">Loss-making lines</div><div class="val ${t.lossCount ? 'neg' : ''}">${t.lossCount}</div><div class="foot">clawed-back tariff &lt; cost</div></div>
      <div class="card"><div class="label">Best-case monthly margin</div><div class="val">${gbp0(t.monthlyProfitBest)}</div><div class="foot">${gbp0(t.annualProfitBest)}/yr at best supplier</div></div>
    </div>`;
  }

  function emptyLedger() {
    return `<div class="panel"><div class="empty">
      <p><strong>No products yet.</strong> Add your Drug Tariff price and wholesaler quotes per line — Dispensing Check works out the margin after clawback, flags loss-makers, and totals the cash freed by buying from the cheapest supplier.</p>
      <div class="btn-row" style="justify-content:center"><button class="btn btn-primary" data-a="add">+ Add product</button><button class="btn" data-a="sample">Load worked example</button></div>
      <p class="note">All prices are entered by your practice and stay in this browser. No live Drug Tariff or wholesaler feeds are bundled.</p>
    </div></div>`;
  }

  function ledgerTable(metrics) {
    const rows = metrics
      .map(({ p, m }) => {
        const flags = [];
        if (m.lossMaker) flags.push('<span class="flag loss">LOSS</span>');
        if (m.switchable) flags.push('<span class="flag switch">SWITCH</span>');
        const chips = (p.suppliers || [])
          .map((s) => {
            const sp = E.priceValue(s.price);
            const best = m.best && s.name === m.best.name && sp !== null && sp === m.best.price;
            const cur = m.current && s.name === m.current.name;
            return `<span class="chip ${best ? 'best' : ''}">${esc(s.name)} ${sp === null ? '—' : gbp(sp)}${cur ? ' ●' : ''}</span>`;
          })
          .join('');
        const mc = m.marginPerPackCurrent == null ? '' : m.marginPerPackCurrent < 0 ? 'neg' : 'pos';
        return `<tr class="${m.lossMaker ? 'row-loss' : ''}">
          <td><div class="name">${esc(p.name) || '<em>unnamed</em>'}</div>
            <div class="meta">${esc(p.pack ? 'pack ' + p.pack : '')} · ${esc(catLabel(p.category))} · clawback ${(m.rate * 100).toFixed(2)}%${m.costPerUnit != null ? ' · ' + gbp(m.costPerUnit) + '/unit' : ''}</div>
            <div class="chips">${chips || '<span class="meta">no supplier price</span>'}</div></td>
          <td class="num">${m.tariff ? gbp(m.tariff) : '—'}</td>
          <td class="num">${m.tariff ? gbp(m.netReimb) : '—'}</td>
          <td class="num">${m.currentCost == null ? '—' : gbp(m.currentCost)}</td>
          <td class="num ${mc}">${m.marginPerPackCurrent == null ? '—' : gbp(m.marginPerPackCurrent)}<div class="meta">${m.band ? `<span class="band band-${m.band}">${pct(m.marginPct)}</span>` : pct(m.marginPct)}</div></td>
          <td class="num">${m.monthlyPacks || 0}</td>
          <td class="num ${m.monthlyProfitCurrent < 0 ? 'neg' : ''}">${gbp(m.monthlyProfitCurrent)}<div class="meta">${flags.join(' ')}</div></td>
          <td class="num"><button class="iconbtn" data-edit="${esc(p.id)}" title="Edit">✎</button><button class="iconbtn" data-del="${esc(p.id)}" title="Delete">✕</button></td>
        </tr>`;
      })
      .join('');
    return `<table><thead><tr><th>Product</th><th>Tariff</th><th>Net reimb.</th><th>Buy</th><th>Margin/pack</th><th>Packs/mo</th><th>Profit/mo</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function breakdownPanel(bd) {
    if (!bd || bd.length < 2) return '';
    const body = bd
      .map((r) => `<tr><td>${esc(r.label)}</td><td class="num">${r.productCount}</td><td class="num ${r.monthlyProfitCurrent < 0 ? 'neg' : 'pos'}">${gbp(r.monthlyProfitCurrent)}</td><td class="num ${r.switchSavingMonthly > 0 ? 'acc' : ''}">${gbp(r.switchSavingMonthly)}</td><td class="num ${r.lossCount ? 'neg' : ''}">${r.lossCount}</td></tr>`)
      .join('');
    return `<div class="panel"><h3>Margin by category</h3><div class="pad" style="padding-top:6px"><table><thead><tr><th>Category</th><th class="num">Lines</th><th class="num">Profit/mo</th><th class="num">Switch save/mo</th><th class="num">Loss</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
  }

  function opportunities(t) {
    if (!t.switchOpportunities.length && !t.lossMakers.length) return '';
    let h = '';
    if (t.switchOpportunities.length) {
      h += `<div class="panel"><h3>Top supplier switches</h3><div class="pad"><ul style="margin:0;padding-left:16px">${t.switchOpportunities
        .slice(0, 5)
        .map((m) => `<li class="note"><strong style="color:var(--text-1)">${gbp(m.switchSavingMonthly)}/mo</strong> on ${esc(m.name)} — ${esc(m.current ? m.current.name : '?')} (${gbp(m.currentCost)}) → ${esc(m.best ? m.best.name : '?')} (${gbp(m.bestCost)})</li>`)
        .join('')}</ul></div></div>`;
    }
    if (t.lossMakers.length) {
      h += `<div class="panel"><h3>Loss-making lines to review</h3><div class="pad"><ul style="margin:0 0 8px;padding-left:16px">${t.lossMakers
        .slice(0, 5)
        .map((m) => `<li class="note"><strong style="color:var(--red)">${gbp(m.monthlyProfitCurrent)}/mo</strong> on ${esc(m.name)} — net reimbursement ${gbp(m.netReimb)} vs buy ${gbp(m.currentCost)}</li>`)
        .join('')}</ul><p class="note">Where a line is unavoidably bought above tariff, check a reimbursement route — price concession (NCSO), out-of-pocket (XP) claim, or broken-bulk endorsement — or consider prescribing rather than dispensing it.</p></div></div>`;
    }
    return h;
  }

  function catLabel(id) {
    return (E.CATEGORIES.find((c) => c.id === id) || E.CATEGORIES[0]).label;
  }

  function switchAll() {
    const t = E.practiceTotals(state.products, state.config);
    if (!t.switchableCount) return;
    if (!confirm(`Set ${t.switchableCount} line(s) to their cheapest supplier on file? This realises about ${gbp0(t.switchSavingMonthly)}/month (${gbp0(t.switchSavingAnnual)}/year). Reversible per line.`)) return;
    state.products = state.products.map((p) => {
      const m = E.productMetrics(p, state.config);
      return m.switchable && m.best ? Object.assign({}, p, { currentSupplier: m.best.name }) : p;
    });
    save(KEYS.products, state.products);
    render();
  }

  // ── product editor ──
  function editProduct(id) {
    const existing = id ? state.products.find((p) => p.id === id) : null;
    const p = existing
      ? JSON.parse(JSON.stringify(existing))
      : { id: E.makeId(), name: '', pack: '', category: 'generic', tariff: 0, monthlyPacks: 0, suppliers: [{ name: '', price: '' }], currentSupplier: null };
    if (!p.suppliers || !p.suppliers.length) p.suppliers = [{ name: '', price: '' }];

    openModal(
      `${existing ? 'Edit product' : 'Add product'}`,
      `<label class="field"><span>Drug / appliance name</span><input id="f_name" value="${esc(p.name)}" placeholder="e.g. Atorvastatin 20mg tablets" /></label>
       <div class="field-row">
         <label class="field"><span>Pack size</span><input id="f_pack" value="${esc(p.pack)}" placeholder="e.g. 28" /></label>
         <label class="field"><span>Category</span><select id="f_cat">${E.CATEGORIES.map((c) => `<option value="${c.id}" ${p.category === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}</select></label>
       </div>
       <div class="field-row">
         <label class="field"><span>Drug Tariff £/pack</span><input id="f_tariff" type="number" step="0.01" min="0" value="${Number(p.tariff) || 0}" /></label>
         <label class="field"><span>Packs dispensed / month</span><input id="f_packs" type="number" step="1" min="0" value="${Number(p.monthlyPacks) || 0}" /></label>
       </div>
       <div class="field"><span>Supplier quotes (£/pack) — ● marks the supplier you currently use</span><div id="f_sups"></div><button type="button" class="btn" id="f_addsup" style="margin-top:6px">+ Add supplier</button></div>`,
      () => {
        p.name = $('#f_name').value.trim();
        p.pack = $('#f_pack').value.trim();
        p.category = $('#f_cat').value;
        p.tariff = Number($('#f_tariff').value) || 0;
        p.monthlyPacks = Math.max(0, Number($('#f_packs').value) || 0);
        p.suppliers = p.suppliers.map((s) => ({ name: String(s.name || '').trim(), price: s.price === '' ? '' : Number(s.price) })).filter((s) => s.name !== '');
        if (p.currentSupplier && !p.suppliers.some((s) => s.name === p.currentSupplier)) p.currentSupplier = null;
        if (!p.name) {
          alert('Please enter a product name.');
          return false;
        }
        const i = state.products.findIndex((x) => x.id === p.id);
        if (i >= 0) state.products[i] = p;
        else state.products.push(p);
        save(KEYS.products, state.products);
        render();
        return true;
      }
    );

    const list = $('#f_sups');
    function draw() {
      list.innerHTML = p.suppliers
        .map(
          (s, i) => `<div class="sup-edit"><input type="radio" name="cur" ${s.name && s.name === p.currentSupplier ? 'checked' : ''} data-cur="${i}" title="Currently used" /><input class="sname" data-i="${i}" value="${esc(s.name)}" placeholder="Supplier" /><input class="sprice" type="number" step="0.01" min="0" data-i="${i}" value="${s.price === '' ? '' : Number(s.price)}" placeholder="£/pack" /><button type="button" class="iconbtn" data-rm="${i}">✕</button></div>`
        )
        .join('');
      list.querySelectorAll('.sname').forEach((el) => el.addEventListener('input', (e) => (p.suppliers[+e.target.dataset.i].name = e.target.value)));
      list.querySelectorAll('.sprice').forEach((el) => el.addEventListener('input', (e) => (p.suppliers[+e.target.dataset.i].price = e.target.value === '' ? '' : Number(e.target.value))));
      list.querySelectorAll('[data-cur]').forEach((el) => el.addEventListener('change', (e) => (p.currentSupplier = p.suppliers[+e.target.dataset.cur].name || null)));
      list.querySelectorAll('[data-rm]').forEach((el) =>
        el.addEventListener('click', (e) => {
          p.suppliers.splice(+e.currentTarget.dataset.rm, 1);
          if (!p.suppliers.length) p.suppliers.push({ name: '', price: '' });
          draw();
        })
      );
    }
    draw();
    $('#f_addsup').addEventListener('click', () => {
      p.suppliers.push({ name: '', price: '' });
      draw();
    });
  }

  // ── FORMULARY editor (partner) ──
  function renderFormulary() {
    const groups = E.groupFormularyByClass(state.formulary);
    content.innerHTML = `
      <h1>Formulary</h1>
      <p class="sub">Agreed preferred line + clinically-equivalent alternative per therapeutic choice. This is what prescribers see — without any prices.</p>
      <div class="btn-row"><button class="btn btn-primary" data-a="addf">+ Formulary entry</button><button class="btn" data-a="gorx">Preview prescriber view</button></div>
      ${
        state.formulary.length === 0
          ? `<div class="panel"><div class="empty"><p>No formulary entries yet. Add the preferred product (with dose) and its clinically-equivalent alternative for each therapeutic choice.</p><button class="btn btn-primary" data-a="addf">+ Add entry</button></div></div>`
          : groups
              .map(
                (g) => `<div class="panel"><h3>${esc(g.therapeuticClass)}</h3><div class="pad" style="padding-top:8px">${g.items
                  .map(
                    (e) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--stroke)">
                      <div><span class="rx-tag pref">PREFERRED</span> <strong>${esc(e.preferred && e.preferred.name)}</strong> <span class="meta">${esc((e.preferred && e.preferred.dose) || '')}</span>
                        ${(e.alternatives || []).map((a) => `<div style="margin-top:4px"><span class="rx-tag alt">ALT</span> ${esc(a.name)} <span class="meta">${esc(a.dose || '')}</span></div>`).join('')}
                        ${e.note ? `<div class="meta" style="margin-top:4px">${esc(e.note)}</div>` : ''}</div>
                      <div style="white-space:nowrap"><button class="iconbtn" data-ef="${esc(e.id)}">✎</button><button class="iconbtn" data-df="${esc(e.id)}">✕</button></div>
                    </div>`
                  )
                  .join('')}</div></div>`
              )
              .join('')
      }`;
    bindMaybe('[data-a="addf"]', () => editFormulary(null));
    bindMaybe('[data-a="gorx"]', () => {
      state.view = 'prescriber';
      render();
    });
    content.querySelectorAll('[data-ef]').forEach((b) => b.addEventListener('click', () => editFormulary(b.dataset.ef)));
    content.querySelectorAll('[data-df]').forEach((b) =>
      b.addEventListener('click', () => {
        const e = state.formulary.find((x) => x.id === b.dataset.df);
        if (e && confirm(`Delete formulary entry "${(e.preferred && e.preferred.name) || ''}"?`)) {
          state.formulary = state.formulary.filter((x) => x.id !== b.dataset.df);
          save(KEYS.formulary, state.formulary);
          render();
        }
      })
    );
  }

  function editFormulary(id) {
    const existing = id ? state.formulary.find((e) => e.id === id) : null;
    const e = existing
      ? JSON.parse(JSON.stringify(existing))
      : { id: E.makeId(), therapeuticClass: '', preferred: { name: '', dose: '', productId: '' }, alternatives: [{ name: '', dose: '' }], note: '' };
    if (!e.alternatives || !e.alternatives.length) e.alternatives = [{ name: '', dose: '' }];
    const prodOpts = ['<option value="">— none —</option>'].concat(state.products.map((p) => `<option value="${esc(p.id)}" ${e.preferred.productId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`)).join('');

    openModal(
      existing ? 'Edit formulary entry' : 'Add formulary entry',
      `<label class="field"><span>Therapeutic class</span><input id="g_cls" value="${esc(e.therapeuticClass)}" placeholder="e.g. Type 2 diabetes · SGLT2 inhibitor" /></label>
       <div class="field-row"><label class="field"><span>Preferred drug</span><input id="g_pname" value="${esc(e.preferred.name)}" placeholder="e.g. Dapagliflozin 10mg" /></label>
       <label class="field"><span>Dose / instruction</span><input id="g_pdose" value="${esc(e.preferred.dose)}" placeholder="e.g. 28 tablets, once daily" /></label></div>
       <label class="field"><span>Link to a ledger product (optional, partners only)</span><select id="g_pid">${prodOpts}</select></label>
       <div class="field"><span>Clinically-equivalent alternatives</span><div id="g_alts"></div><button type="button" class="btn" id="g_addalt" style="margin-top:6px">+ Add alternative</button></div>
       <label class="field"><span>Note (optional)</span><input id="g_note" value="${esc(e.note)}" placeholder="e.g. first line; review if eGFR < 30" /></label>`,
      () => {
        e.therapeuticClass = $('#g_cls').value.trim();
        e.preferred = { name: $('#g_pname').value.trim(), dose: $('#g_pdose').value.trim(), productId: $('#g_pid').value || '' };
        e.note = $('#g_note').value.trim();
        e.alternatives = e.alternatives.map((a) => ({ name: String(a.name || '').trim(), dose: String(a.dose || '').trim() })).filter((a) => a.name !== '');
        if (!e.preferred.name) {
          alert('Please enter the preferred drug.');
          return false;
        }
        if (!e.therapeuticClass) e.therapeuticClass = 'Uncategorised';
        const i = state.formulary.findIndex((x) => x.id === e.id);
        if (i >= 0) state.formulary[i] = e;
        else state.formulary.push(e);
        save(KEYS.formulary, state.formulary);
        render();
        return true;
      }
    );

    const list = $('#g_alts');
    function draw() {
      list.innerHTML = e.alternatives
        .map((a, i) => `<div class="sup-edit"><input class="sname" data-i="${i}" value="${esc(a.name)}" placeholder="Alternative drug" /><input class="sname" data-d="${i}" value="${esc(a.dose)}" placeholder="dose / note" /><button type="button" class="iconbtn" data-rm="${i}">✕</button></div>`)
        .join('');
      list.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('input', (ev) => (e.alternatives[+ev.target.dataset.i].name = ev.target.value)));
      list.querySelectorAll('[data-d]').forEach((el) => el.addEventListener('input', (ev) => (e.alternatives[+ev.target.dataset.d].dose = ev.target.value)));
      list.querySelectorAll('[data-rm]').forEach((el) =>
        el.addEventListener('click', (ev) => {
          e.alternatives.splice(+ev.currentTarget.dataset.rm, 1);
          if (!e.alternatives.length) e.alternatives.push({ name: '', dose: '' });
          draw();
        })
      );
    }
    draw();
    $('#g_addalt').addEventListener('click', () => {
      e.alternatives.push({ name: '', dose: '' });
      draw();
    });
  }

  // ── PRESCRIBER view (price-blind) ──
  function renderPrescriber() {
    // Uses the engine's prescriber-safe projection: commercial fields are
    // stripped, so no cost/margin/supplier data can reach this DOM.
    const groups = E.prescriberFormulary(state.formulary);
    const who = state.practiceName ? esc(state.practiceName) : 'Practice formulary';
    content.innerHTML = `
      <div class="rx-portal">
        <div class="rx-portal-head"><div><h1 style="margin-bottom:2px">Prescriber view</h1><p class="sub" style="margin:0">${who} · preferred lines at the point of prescribing</p></div><span class="badge">Formulary only</span></div>
        ${
          groups.length === 0
            ? `<div class="panel"><div class="empty"><p>No formulary entries yet.${state.role === 'partner' ? ' Add them in the Formulary tab.' : ' Ask a partner to set up the practice formulary.'}</p></div></div>`
            : groups
                .map(
                  (g) => `<div class="rx-class">${esc(g.therapeuticClass)}</div>${g.items
                    .map(
                      (e) => `<div class="rx-line"><span class="rx-tag pref">PREFERRED</span><div><div class="drug">${esc(e.preferred.name)}</div><div class="dose">${esc(e.preferred.dose)}</div></div></div>${(e.alternatives || [])
                        .map((a) => `<div class="rx-line"><span class="rx-tag alt">ALT</span><div><div class="drug">${esc(a.name)}</div><div class="dose">${esc(a.dose) || 'clinically equivalent option'}</div></div></div>`)
                        .join('')}${e.note ? `<div class="note" style="margin:-2px 0 8px 4px">${esc(e.note)}</div>` : ''}`
                    )
                    .join('')}`
                )
                .join('') + `<div class="rx-lock">🔒 Prices, costs and margins are visible to partners and the practice manager only.</div>`
        }
      </div>`;
  }

  // ── JSON import sanitisers ──
  function sanitiseProducts(raw) {
    if (!Array.isArray(raw)) return [];
    const catIds = E.CATEGORIES.map((c) => c.id);
    return raw.filter((x) => x && typeof x === 'object').map((x) => {
      const suppliers = Array.isArray(x.suppliers)
        ? x.suppliers.filter((s) => s && typeof s === 'object' && String(s.name || '').trim()).map((s) => ({
            name: String(s.name).trim(),
            price: isFinite(Number(s.price)) ? Number(s.price) : '',
          }))
        : [];
      return {
        id: typeof x.id === 'string' && x.id ? x.id : E.makeId(),
        name: typeof x.name === 'string' ? x.name : '',
        pack: typeof x.pack === 'string' ? x.pack : '',
        category: catIds.includes(x.category) ? x.category : 'generic',
        tariff: isFinite(Number(x.tariff)) ? Number(x.tariff) : 0,
        monthlyPacks: isFinite(Number(x.monthlyPacks)) ? Number(x.monthlyPacks) : 0,
        suppliers,
        currentSupplier: typeof x.currentSupplier === 'string' ? x.currentSupplier : null,
      };
    });
  }
  function sanitiseFormulary(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter((x) => x && typeof x === 'object').map((x) => {
      const pref = (x.preferred && typeof x.preferred === 'object') ? x.preferred : {};
      const alts = Array.isArray(x.alternatives)
        ? x.alternatives.filter((a) => a && typeof a === 'object').map((a) => ({ name: String(a.name || ''), dose: String(a.dose || '') }))
        : [];
      return {
        id: typeof x.id === 'string' && x.id ? x.id : E.makeId(),
        therapeuticClass: typeof x.therapeuticClass === 'string' ? x.therapeuticClass : '',
        note: typeof x.note === 'string' ? x.note : '',
        preferred: { name: String(pref.name || ''), dose: String(pref.dose || ''), productId: String(pref.productId || '') },
        alternatives: alts,
      };
    });
  }
  function sanitiseHistory(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter((x) => x && typeof x === 'object' && typeof x.ym === 'string');
  }

  // ── DATA (import / export) ──
  function renderData() {
    content.innerHTML = `
      <h1>Import / export</h1>
      <p class="sub">CSV for price lists · JSON for a full backup (products, formulary, settings, history)</p>
      <div class="panel"><h3>Price list (CSV)</h3><div class="pad">
        <p class="note">Columns: <code>${esc(E.CSV_HEADER)}</code>. Rows sharing name+pack group into one product. Empty price = unpriced.</p>
        <div class="btn-row"><button class="btn" data-a="impcsv">Import CSV</button><button class="btn" data-a="expcsv">Export CSV</button></div>
      </div></div>
      <div class="panel"><h3>Full backup (JSON)</h3><div class="pad"><div class="btn-row"><button class="btn" data-a="impjson">Import JSON</button><button class="btn" data-a="expjson">Export JSON</button></div></div></div>
      <input type="file" id="fcsv" accept=".csv,text/csv" style="display:none" />
      <input type="file" id="fjson" accept=".json,application/json" style="display:none" />`;
    const fcsv = $('#fcsv'), fjson = $('#fjson');
    bindMaybe('[data-a="impcsv"]', () => fcsv.click());
    bindMaybe('[data-a="expcsv"]', () => download(E.toCsv(state.products), `dispensing-margin-${today()}.csv`, 'text/csv'));
    bindMaybe('[data-a="impjson"]', () => fjson.click());
    bindMaybe('[data-a="expjson"]', () =>
      download(JSON.stringify({ products: state.products, formulary: state.formulary, config: state.config, history: state.history }, null, 2), `dispensing-check-backup-${today()}.json`, 'application/json')
    );
    fcsv.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const parsed = E.parseCsv(await f.text());
        if (!parsed.length) { alert('No rows found. Expected columns: ' + E.CSV_HEADER); e.target.value = ''; return; }
        if (state.products.length > 0 && !confirm(`Importing will replace your current data (${state.products.length} products). Continue?`)) { e.target.value = ''; return; }
        state.products = parsed;
        save(KEYS.products, state.products);
        state.view = 'ledger';
        render();
      } catch (err) {
        alert('Could not read that file: ' + err.message);
      }
      e.target.value = '';
    });
    fjson.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const d = JSON.parse(await f.text());
        const incomingProducts = sanitiseProducts(d.products);
        const incomingFormulary = sanitiseFormulary(d.formulary);
        const wouldReplace = state.products.length > 0 || state.formulary.length > 0;
        if (wouldReplace) {
          const n = state.products.length;
          if (!confirm(`Importing will replace your current data (${n} products). Continue?`)) { e.target.value = ''; return; }
        }
        state.products = incomingProducts;
        state.formulary = incomingFormulary;
        if (d.config) state.config = mergeConfig(d.config);
        if (Array.isArray(d.history)) state.history = sanitiseHistory(d.history);
        save(KEYS.products, state.products);
        save(KEYS.formulary, state.formulary);
        save(KEYS.config, state.config);
        save(KEYS.history, state.history);
        state.view = 'ledger';
        render();
      } catch (err) {
        alert('Invalid backup file: ' + err.message);
      }
      e.target.value = '';
    });
  }

  // ── SETTINGS ──
  function renderSettings() {
    const c = state.config;
    content.innerHTML = `
      <h1>Settings</h1>
      <p class="sub">Clawback model, margin thresholds, practice identity and the prescriber-view PIN</p>
      <div class="panel"><div class="pad">
        <label class="field"><span>Practice name (shown in headers / report)</span><input id="s_name" value="${esc(state.practiceName)}" placeholder="e.g. Greendale Surgery" /></label>
        <label class="field"><span>Clawback model</span><select id="s_mode"><option value="dispensingDoctor" ${c.mode === 'dispensingDoctor' ? 'selected' : ''}>Dispensing doctor — flat rate</option><option value="pharmacyGroups" ${c.mode === 'pharmacyGroups' ? 'selected' : ''}>Pharmacy group rates</option></select></label>
        <div id="s_dd" class="${c.mode === 'dispensingDoctor' ? '' : 'hidden'}" style="${c.mode === 'dispensingDoctor' ? '' : 'display:none'}"><label class="field"><span>Flat clawback %</span><input id="s_dd_rate" type="number" step="0.01" min="0" max="100" value="${c.ddRate}" /></label><p class="note">SFE reference for dispensing doctors is 11.18%. Confirm your figure.</p></div>
        <div id="s_grp" style="${c.mode === 'pharmacyGroups' ? '' : 'display:none'}"><div class="field-row">${E.CATEGORIES.map((cat) => `<label class="field"><span>${cat.label} %</span><input class="s_grate" data-cat="${cat.id}" type="number" step="0.01" min="0" max="100" value="${c.groupRates[cat.id]}" /></label>`).join('')}</div><p class="note">Drug Tariff Part V group deductions: generics 20.00%, branded 5.00%, appliances 9.85%.</p></div>
        <div class="field-row"><label class="field"><span>Healthy margin % (green)</span><input id="s_green" type="number" min="0" max="100" value="${c.thresholds.green}" /></label><label class="field"><span>Watch margin % (amber)</span><input id="s_amber" type="number" min="0" max="100" value="${c.thresholds.amber}" /></label></div>
        <label class="field"><span>Prescriber-view PIN (optional — gates entry to the partner view)</span><input id="s_pin" value="${esc(state.pin)}" placeholder="leave blank for no PIN" /></label>
        <div class="btn-row"><button class="btn btn-primary" data-a="save">Save</button><button class="btn" data-a="reset">Reset rates</button></div>
        <p class="note">The PIN is a soft gate for shared workstations, not strong security — it keeps prices out of the prescriber view by default.</p>
      </div></div>`;
    const mode = $('#s_mode');
    mode.addEventListener('change', () => {
      $('#s_dd').style.display = mode.value === 'dispensingDoctor' ? '' : 'none';
      $('#s_grp').style.display = mode.value === 'pharmacyGroups' ? '' : 'none';
    });
    bindMaybe('[data-a="save"]', () => {
      const cfg = { mode: mode.value, ddRate: E.clampPct($('#s_dd_rate').value), groupRates: {}, thresholds: { green: E.clampPct($('#s_green').value), amber: E.clampPct($('#s_amber').value) } };
      content.querySelectorAll('.s_grate').forEach((el) => (cfg.groupRates[el.dataset.cat] = E.clampPct(el.value)));
      state.config = mergeConfig(cfg);
      state.practiceName = $('#s_name').value.trim();
      state.pin = $('#s_pin').value.trim();
      save(KEYS.config, state.config);
      localStorage.setItem(KEYS.practice, state.practiceName);
      localStorage.setItem(KEYS.pin, state.pin);
      render();
    });
    bindMaybe('[data-a="reset"]', () => {
      state.config = mergeConfig(null);
      save(KEYS.config, state.config);
      render();
    });
  }

  // ── board report (print) ──
  function printReport() {
    const t = E.practiceTotals(state.products, state.config);
    const bd = E.categoryBreakdown(state.products, state.config);
    const date = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
    const opp = t.switchOpportunities.slice(0, 15).map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.current ? m.current.name : '?')}</td><td>${esc(m.best ? m.best.name : '?')}</td><td class="r">${gbp(m.switchSavingMonthly)}</td><td class="r">${gbp(m.switchSavingAnnual)}</td></tr>`).join('');
    const loss = t.lossMakers.slice(0, 15).map((m) => `<tr><td>${esc(m.name)}</td><td class="r">${gbp(m.netReimb)}</td><td class="r">${gbp(m.currentCost)}</td><td class="r">${gbp(m.monthlyProfitCurrent)}</td></tr>`).join('');
    const cat = bd.map((r) => `<tr><td>${esc(r.label)}</td><td class="r">${r.productCount}</td><td class="r">${gbp(r.monthlyProfitCurrent)}</td><td class="r">${gbp(r.switchSavingMonthly)}</td><td class="r">${r.lossCount}</td></tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Dispensing Margin report — ${esc(date)}</title><style>
      body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:32px;font-size:13px}h1{font-size:20px;margin:0 0 2px}.s{color:#475569;font-size:12px;margin:0 0 18px}
      .cards{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:20px}.c{border:1px solid #cbd5e1;border-radius:10px;padding:12px 14px;min-width:150px}.c .l{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#475569}.c .v{font-size:22px;font-weight:700;margin-top:4px}.pos{color:#16a34a}.neg{color:#dc2626}
      h2{font-size:14px;margin:18px 0 8px;border-bottom:1px solid #cbd5e1;padding-bottom:4px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0}.r{text-align:right}.f{margin-top:24px;color:#64748b;font-size:10px}</style></head><body>
      <h1>Dispensing Margin report</h1><p class="s">${esc(state.practiceName || 'Practice')} · ${esc(date)} · ${t.pricedCount}/${t.productCount} products priced</p>
      <div class="cards"><div class="c"><div class="l">Monthly margin</div><div class="v ${t.monthlyProfitCurrent >= 0 ? 'pos' : 'neg'}">${gbp0(t.monthlyProfitCurrent)}</div></div><div class="c"><div class="l">Annualised</div><div class="v">${gbp0(t.annualProfitCurrent)}</div></div><div class="c"><div class="l">Switch saving/mo</div><div class="v">${gbp0(t.switchSavingMonthly)}</div></div><div class="c"><div class="l">Switch saving/yr</div><div class="v">${gbp0(t.switchSavingAnnual)}</div></div><div class="c"><div class="l">Loss lines</div><div class="v ${t.lossCount ? 'neg' : ''}">${t.lossCount}</div></div></div>
      ${cat ? `<h2>Margin by category</h2><table><thead><tr><th>Category</th><th class="r">Lines</th><th class="r">Profit/mo</th><th class="r">Switch save/mo</th><th class="r">Loss</th></tr></thead><tbody>${cat}</tbody></table>` : ''}
      ${opp ? `<h2>Top supplier switches</h2><table><thead><tr><th>Product</th><th>From</th><th>To</th><th class="r">Save/mo</th><th class="r">Save/yr</th></tr></thead><tbody>${opp}</tbody></table>` : ''}
      ${loss ? `<h2>Loss-making lines</h2><table><thead><tr><th>Product</th><th class="r">Net reimb.</th><th class="r">Buy</th><th class="r">Profit/mo</th></tr></thead><tbody>${loss}</tbody></table>` : ''}
      <p class="f">Generated by Dispensing Check. Figures derive from prices entered by the practice; no live Drug Tariff or wholesaler data is bundled. Verify reimbursement routes against the current Drug Tariff before acting.</p>
      <script>window.onload=function(){setTimeout(function(){window.print();},200);};<\/script></body></html>`;
    const w = window.open('', '_blank');
    if (!w) {
      alert('Please allow pop-ups to open the printable report.');
      return;
    }
    w.document.write(html);
    w.document.close();
  }

  // ── modal helper ──
  function openModal(title, bodyHtml, onSave) {
    const host = document.createElement('div');
    host.className = 'modal-host';
    host.innerHTML = `<div class="modal"><h3>${esc(title)}</h3><div class="mbody">${bodyHtml}</div><div class="modal-actions"><button class="btn" data-x="cancel">Cancel</button><button class="btn btn-primary" data-x="save">Save</button></div></div>`;
    $('#modalRoot').appendChild(host);
    const close = () => { host.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    host.addEventListener('click', (e) => {
      if (e.target === host) close();
    });
    host.querySelector('[data-x="cancel"]').addEventListener('click', close);
    host.querySelector('[data-x="save"]').addEventListener('click', () => {
      if (onSave() !== false) close();
    });
    const first = host.querySelector('.mbody input, .mbody select, .mbody textarea');
    if (first) first.focus();
    return host;
  }

  function download(text, filename, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  // ── sample data ──
  function sampleProducts() {
    return [
      { id: E.makeId(), name: 'Atorvastatin 20mg tablets', pack: '28', category: 'generic', tariff: 1.43, monthlyPacks: 180, suppliers: [{ name: 'Wholesaler A', price: 0.78 }, { name: 'Wholesaler B', price: 0.62 }], currentSupplier: 'Wholesaler A' },
      { id: E.makeId(), name: 'Dapagliflozin 10mg tablets', pack: '28', category: 'branded', tariff: 36.59, monthlyPacks: 70, suppliers: [{ name: 'Wholesaler A', price: 33.4 }, { name: 'Wholesaler B', price: 31.9 }], currentSupplier: 'Wholesaler A' },
      { id: E.makeId(), name: 'Sildenafil 50mg tablets', pack: '8', category: 'generic', tariff: 1.21, monthlyPacks: 40, suppliers: [{ name: 'Wholesaler A', price: 1.35 }, { name: 'Wholesaler B', price: 1.18 }], currentSupplier: 'Wholesaler A' },
      { id: E.makeId(), name: 'Fostair 100/6 pMDI inhaler', pack: '120', category: 'branded', tariff: 29.32, monthlyPacks: 55, suppliers: [{ name: 'Wholesaler A', price: 27.5 }], currentSupplier: 'Wholesaler A' },
    ];
  }
  function sampleFormulary(products) {
    const byName = (n) => (products.find((p) => p.name.indexOf(n) === 0) || {}).id || '';
    return [
      { id: E.makeId(), therapeuticClass: 'Type 2 diabetes · SGLT2 inhibitor', preferred: { name: 'Dapagliflozin 10mg', dose: '28 tablets, once daily', productId: byName('Dapagliflozin') }, alternatives: [{ name: 'Empagliflozin 10mg', dose: 'clinically equivalent option' }], note: 'First line per local formulary.' },
      { id: E.makeId(), therapeuticClass: 'Respiratory · ICS/LABA inhaler', preferred: { name: 'Fostair 100/6 pMDI', dose: '2 puffs twice daily', productId: byName('Fostair') }, alternatives: [{ name: 'Luforbec 100/6 pMDI', dose: 'clinically equivalent option' }], note: '' },
      { id: E.makeId(), therapeuticClass: 'Lipid management · statin', preferred: { name: 'Atorvastatin 20mg', dose: '28 tablets, once daily', productId: byName('Atorvastatin') }, alternatives: [{ name: 'Rosuvastatin 10mg', dose: 'where atorvastatin not tolerated' }], note: '' },
    ];
  }

  render();
})();
