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
    textSize: 'dc.textSize',
    density: 'dc.density',
    accent: 'dc.accent',
    tariffMonth: 'dc.tariffMonth',
    concessions: 'dc.concessions',
    onboarded: 'dc.onboarded',
    lastBackupAt: 'dc.lastBackupAt',
    lastExport: 'dc.lastExport',
    backupNudgeAt: 'dc.backupNudgeAt',
  };

  const I = window.DispensingImporters;

  // ── IndexedDB tariff store ──
  // db 'dispensingCheck' v2, stores: 'tariff' (keyPath 'key'), 'meta', 'handles'
  let _idb = null;
  function openIdb() {
    if (_idb) return Promise.resolve(_idb);
    return new Promise((resolve) => {
      if (!window.indexedDB) { resolve(null); return; }
      const req = window.indexedDB.open('dispensingCheck', 2);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('tariff')) {
          db.createObjectStore('tariff', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles', { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => { _idb = e.target.result; resolve(_idb); };
      req.onerror = () => { resolve(null); };
    });
  }

  // ── IDB helpers for file handles ──
  function idbPutHandle(id, handle) {
    return openIdb().then((db) => {
      if (!db) return;
      return new Promise((resolve) => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put({ id, handle });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    });
  }

  function idbGetHandle(id) {
    return openIdb().then((db) => {
      if (!db) return null;
      return new Promise((resolve) => {
        const tx = db.transaction('handles', 'readonly');
        const req = tx.objectStore('handles').get(id);
        req.onsuccess = () => resolve(req.result ? req.result.handle : null);
        req.onerror = () => resolve(null);
      });
    });
  }

  function idbDeleteHandle(id) {
    return openIdb().then((db) => {
      if (!db) return;
      return new Promise((resolve) => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    });
  }

  function idbPutTariff(rows, monthLabel) {
    return openIdb().then((db) => {
      if (!db) { console.info('IndexedDB not available — tariff reference set not persisted.'); return; }
      return new Promise((resolve, reject) => {
        const tx = db.transaction(['tariff', 'meta'], 'readwrite');
        const store = tx.objectStore('tariff');
        const meta = tx.objectStore('meta');
        // Clear existing tariff rows
        store.clear();
        for (const row of rows) {
          const key = I.normaliseName((row.name || '') + ' ' + (row.pack || ''));
          store.put({ key, name: row.name, pack: row.pack, price: row.price });
        }
        meta.put({ id: 'tariff', month: monthLabel, importedAt: new Date().toISOString(), count: rows.length });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    });
  }

  function idbTariffMeta() {
    return openIdb().then((db) => {
      if (!db) return null;
      return new Promise((resolve) => {
        const tx = db.transaction('meta', 'readonly');
        const req = tx.objectStore('meta').get('tariff');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    });
  }

  function idbAllTariff() {
    return openIdb().then((db) => {
      if (!db) return [];
      return new Promise((resolve) => {
        const tx = db.transaction('tariff', 'readonly');
        const req = tx.objectStore('tariff').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    });
  }

  // ── format YYYY-MM as "May 2026" ──
  function fmtYearMonth(ym) {
    if (!ym) return '';
    const parts = ym.split('-');
    const yr = parts[0] || '';
    const mo = parseInt(parts[1], 10) || 0;
    const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const mName = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return (mName[mo] || months[mo] || '') + ' ' + yr;
  }

  // ── current month as YYYY-MM ──
  function currentYearMonth() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  const state = {
    products: load(KEYS.products, []),
    config: mergeConfig(load(KEYS.config, null)),
    formulary: load(KEYS.formulary, []),
    history: load(KEYS.history, []),
    role: localStorage.getItem(KEYS.role) === 'prescriber' ? 'prescriber' : 'partner',
    practiceName: localStorage.getItem(KEYS.practice) || '',
    pin: localStorage.getItem(KEYS.pin) || '',
    view: 'ledger',
    ledgerUI: { q: '', cat: 'all', flag: 'all', sort: null, dir: 1 },
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
    scheduleBackup();
  }

  // ── Auto-backup (File System Access API) ──
  const FSAPI_SUPPORTED = typeof window.showSaveFilePicker === 'function';
  const _backup = {
    handle: null,         // FileSystemFileHandle | null
    status: 'idle',       // 'idle' | 'ok' | 'paused' | 'unsupported'
    timer: null,
  };

  function buildBackup() {
    return JSON.stringify({
      products: state.products,
      formulary: state.formulary,
      config: state.config,
      history: state.history,
    }, null, 2);
  }

  function fmtTime(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '';
    }
  }

  async function writeBackup(fromGesture) {
    if (!_backup.handle) return;
    try {
      const perm = await _backup.handle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        if (fromGesture) {
          const req = await _backup.handle.requestPermission({ mode: 'readwrite' });
          if (req !== 'granted') { _backup.status = 'paused'; refreshBackupStatus(); return; }
        } else {
          _backup.status = 'paused';
          refreshBackupStatus();
          return;
        }
      }
      const writable = await _backup.handle.createWritable();
      await writable.write(buildBackup());
      await writable.close();
      const now = new Date().toISOString();
      localStorage.setItem(KEYS.lastBackupAt, now);
      localStorage.setItem(KEYS.lastExport, now);
      _backup.status = 'ok';
      refreshBackupStatus();
    } catch (_) {
      _backup.status = 'paused';
      refreshBackupStatus();
    }
  }

  function scheduleBackup() {
    if (!FSAPI_SUPPORTED || !_backup.handle) return;
    if (_backup.timer) clearTimeout(_backup.timer);
    _backup.timer = setTimeout(() => {
      _backup.timer = null;
      writeBackup(false);
    }, 2000);
  }

  function refreshBackupStatus() {
    // Update any live backup status element in the settings panel
    const el = document.getElementById('backupStatus');
    if (el) el.innerHTML = buildBackupStatusHtml();
  }

  function buildBackupStatusHtml() {
    if (!FSAPI_SUPPORTED) {
      return `<p class="note">Auto-backup requires Chrome or Edge (File System Access API). Use <strong>Export JSON</strong> below for backups.</p>`;
    }
    if (!_backup.handle) {
      return `<p class="note">No backup file configured.</p>
        <div class="btn-row" style="margin-top:8px"><button class="btn btn-primary" id="backupSetupBtn">Set up auto-backup file</button></div>`;
    }
    const name = esc(_backup.handle.name || 'backup file');
    const lastAt = localStorage.getItem(KEYS.lastBackupAt);
    const lastStr = lastAt ? ' · last written ' + esc(fmtTime(lastAt)) : '';
    if (_backup.status === 'paused') {
      return `<p class="note" style="color:var(--amber)">${name}${lastStr}</p>
        <div class="btn-row" style="margin-top:8px">
          <button class="btn" id="backupReauthBtn">Auto-backup paused — click to re-authorise</button>
          <button class="btn" id="backupStopBtn">Stop auto-backup</button>
        </div>`;
    }
    return `<p class="note">${name}${lastStr}</p>
      <div class="btn-row" style="margin-top:8px"><button class="btn" id="backupStopBtn">Stop auto-backup</button></div>`;
  }

  function bindBackupButtons() {
    const setupBtn = document.getElementById('backupSetupBtn');
    if (setupBtn) {
      setupBtn.addEventListener('click', async () => {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: 'dispensing-check-backup.json',
            types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
          });
          _backup.handle = handle;
          await idbPutHandle('backup', handle);
          _backup.status = 'ok';
          await writeBackup(true);
          refreshBackupStatus();
          bindBackupButtons();
        } catch (_) {
          // User cancelled or error
        }
      });
    }
    const reauthBtn = document.getElementById('backupReauthBtn');
    if (reauthBtn) {
      reauthBtn.addEventListener('click', async () => {
        await writeBackup(true);
        refreshBackupStatus();
        bindBackupButtons();
      });
    }
    const stopBtn = document.getElementById('backupStopBtn');
    if (stopBtn) {
      stopBtn.addEventListener('click', async () => {
        _backup.handle = null;
        _backup.status = 'idle';
        await idbDeleteHandle('backup');
        refreshBackupStatus();
        bindBackupButtons();
      });
    }
  }

  // Load handle on boot (called after state is initialised, before first render)
  function loadBackupHandle() {
    if (!FSAPI_SUPPORTED) return;
    idbGetHandle('backup').then(async (handle) => {
      if (!handle) return;
      _backup.handle = handle;
      try {
        const perm = await handle.queryPermission({ mode: 'readwrite' });
        _backup.status = perm === 'granted' ? 'ok' : 'paused';
      } catch (_) {
        _backup.status = 'paused';
      }
    });
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

  // ── theme & appearance ──
  function applyTheme() {
    const theme = localStorage.getItem(KEYS.theme) || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  }
  function applyAppearance() {
    const ts = localStorage.getItem(KEYS.textSize) || 'md';
    const dn = localStorage.getItem(KEYS.density) || 'comfortable';
    const ac = localStorage.getItem(KEYS.accent) || 'indigo';
    document.documentElement.setAttribute('data-textsize', ts);
    document.documentElement.setAttribute('data-density', dn);
    document.documentElement.setAttribute('data-accent', ac);
  }
  $('#themeBtn').addEventListener('click', () => {
    const cur = localStorage.getItem(KEYS.theme) || 'dark';
    localStorage.setItem(KEYS.theme, cur === 'dark' ? 'light' : 'dark');
    applyTheme();
  });
  const TEXT_SIZES = ['sm', 'md', 'lg', 'xl'];
  $('#textBtn').addEventListener('click', () => {
    const cur = localStorage.getItem(KEYS.textSize) || 'md';
    const next = TEXT_SIZES[(TEXT_SIZES.indexOf(cur) + 1) % TEXT_SIZES.length];
    localStorage.setItem(KEYS.textSize, next);
    applyAppearance();
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
    { id: 'insights', label: 'Insights' },
    { id: 'formulary', label: 'Formulary' },
    { id: 'prescriber', label: 'Prescriber view' },
    { id: 'data', label: 'Import / export' },
    { id: 'settings', label: 'Settings' },
    { id: 'ig', label: 'Data & IG' },
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
    applyAppearance();
    renderNav();
    if (state.role === 'prescriber') return renderPrescriber();
    if (state.view === 'formulary') return renderFormulary();
    if (state.view === 'prescriber') return renderPrescriber();
    if (state.view === 'insights') return renderInsights();
    if (state.view === 'data') return renderData();
    if (state.view === 'settings') return renderSettings();
    if (state.view === 'ig') return renderIg();
    return renderLedger();
  }

  // ── sample loader (shared by ledger + insights) ──
  function loadSample() {
    state.products = sampleProducts();
    state.formulary = sampleFormulary(state.products);
    save(KEYS.products, state.products);
    save(KEYS.formulary, state.formulary);
    render();
  }

  // ── chart helpers (pure SVG string builders) ──

  // Safe finite guard — returns 0 for NaN/Infinity
  function safeN(n) {
    const v = Number(n);
    return Number.isFinite(v) ? v : 0;
  }

  // Clamp a value to [lo, hi]
  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  // Linear scale: map value in [dMin,dMax] to [rMin,rMax]
  function scale(v, dMin, dMax, rMin, rMax) {
    const span = dMax - dMin;
    if (span === 0) return (rMin + rMax) / 2;
    return rMin + ((v - dMin) / span) * (rMax - rMin);
  }

  // Round to "nice" increments for axis labels
  function niceStep(span, steps) {
    const raw = span / steps;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
    return nice * mag;
  }

  // Generate 3-4 "nice" gridline values spanning [lo, hi]
  function niceGridlines(lo, hi, count) {
    count = count || 4;
    const span = hi - lo;
    if (span <= 0) return [lo];
    const step = niceStep(span, count);
    const start = Math.ceil(lo / step) * step;
    const lines = [];
    for (let v = start; v <= hi + step * 0.001; v += step) {
      lines.push(Math.round(v / step) * step); // avoid float drift
    }
    return lines;
  }

  // Truncate a string to maxLen chars with ellipsis
  function truncate(s, maxLen) {
    const str = String(s || '');
    return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
  }

  // ── chart a: margin trend (area + line) ──
  function chartMarginTrend(history) {
    const pts = (history || [])
      .filter((s) => s && typeof s.ym === 'string')
      .map((s) => ({ ym: s.ym, v: safeN(s.monthlyProfitCurrent) }))
      .sort((a, b) => a.ym.localeCompare(b.ym));

    if (pts.length < 2) {
      return `<div class="empty" style="padding:28px 0"><p>Trend appears after two monthly snapshots — open the ledger each month.</p></div>`;
    }

    const W = 620, H = 180;
    const PAD = { t: 14, r: 18, b: 40, l: 62 };
    const cW = W - PAD.l - PAD.r;
    const cH = H - PAD.t - PAD.b;

    const vals = pts.map((p) => p.v);
    const rawMin = Math.min(...vals);
    const rawMax = Math.max(...vals);
    const span = rawMax - rawMin || 1;
    const dMin = rawMin - span * 0.08;
    const dMax = rawMax + span * 0.08;

    const hasNeg = dMin < 0;
    const gridLines = niceGridlines(dMin, dMax, 4);

    const n = pts.length;
    const step = cW / Math.max(n - 1, 1);

    function cx(i) { return PAD.l + i * step; }
    function cy(v) { return PAD.t + cH - scale(v, dMin, dMax, 0, cH); }

    // Points
    const coords = pts.map((p, i) => [cx(i), cy(p.v)]);

    // Area path
    const areaD = coords.map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`)).join(' ') +
      ` L${coords[n - 1][0]},${cy(0)} L${coords[0][0]},${cy(0)} Z`;

    // Line path
    const lineD = coords.map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`)).join(' ');

    // Gridlines + y-axis labels
    let gridSvg = '';
    for (const gv of gridLines) {
      const gy = cy(gv);
      if (gy < PAD.t - 2 || gy > PAD.t + cH + 2) continue;
      const isZero = gv === 0;
      gridSvg += `<line x1="${PAD.l}" y1="${gy.toFixed(1)}" x2="${PAD.l + cW}" y2="${gy.toFixed(1)}" ${isZero ? 'class="chart-zero" stroke-width="1.4"' : 'class="chart-grid" stroke-width="0.8"'}/>`;
      gridSvg += `<text x="${(PAD.l - 5).toFixed(1)}" y="${(gy + 3).toFixed(1)}" text-anchor="end" class="chart-axis">${esc(gbp0(gv))}</text>`;
    }

    // X-axis labels (thin out if > 12 points)
    let xSvg = '';
    const labelEvery = n <= 12 ? 1 : Math.ceil(n / 12);
    for (let i = 0; i < n; i++) {
      if (i % labelEvery !== 0 && i !== n - 1) continue;
      const lx = coords[i][0];
      const ly = PAD.t + cH + 14;
      // Format "2024-03" -> "Mar 24"
      const raw = pts[i].ym;
      const parts = raw.split('-');
      const month = parts[1] ? parseInt(parts[1], 10) : 0;
      const yr = parts[0] ? parts[0].slice(2) : '';
      const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const label = (months[month] || raw) + ' ' + yr;
      xSvg += `<text x="${lx.toFixed(1)}" y="${ly}" text-anchor="middle" class="chart-axis">${esc(label)}</text>`;
    }

    // Dots on each data point
    const dotsSvg = coords.map(([x, y], i) => {
      const v = pts[i].v;
      const fill = v >= 0 ? 'var(--green)' : 'var(--red)';
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${fill}" stroke="var(--panel)" stroke-width="1.5"/>`;
    }).join('');

    // Zero line if data spans negative
    const zeroLineSvg = hasNeg && dMin < 0 && dMax > 0
      ? `<line x1="${PAD.l}" y1="${cy(0).toFixed(1)}" x2="${PAD.l + cW}" y2="${cy(0).toFixed(1)}" class="chart-zero" stroke-width="1.5"/>`
      : '';

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible">
      <defs>
        <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      ${gridSvg}
      ${zeroLineSvg}
      <path d="${areaD}" fill="url(#trendGrad)"/>
      <path d="${lineD}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${dotsSvg}
      ${xSvg}
    </svg>`;
  }

  // ── chart b: margin by category (horizontal bars) ──
  function chartCategoryBars(bd) {
    if (!bd || bd.length === 0) return '';

    const W = 420, ROW = 38, PAD = { t: 8, l: 130, r: 70, b: 8 };
    const H = PAD.t + bd.length * ROW + PAD.b;
    const barW = W - PAD.l - PAD.r;

    const maxAbs = Math.max(...bd.map((r) => Math.abs(safeN(r.monthlyProfitCurrent))), 1);

    let rows = '';
    for (let i = 0; i < bd.length; i++) {
      const r = bd[i];
      const v = safeN(r.monthlyProfitCurrent);
      const y = PAD.t + i * ROW;
      const mid = H / 2;
      const isPos = v >= 0;
      const barLen = clamp((Math.abs(v) / maxAbs) * barW * 0.88, 2, barW * 0.88);
      const barX = PAD.l;
      const barY = y + 8;
      const barH = 18;
      const fill = isPos ? 'var(--green)' : 'var(--red)';
      const valX = barX + barLen + 5;
      const labelText = esc(truncate(r.label, 18));
      rows += `
        <text x="${(PAD.l - 8).toFixed(1)}" y="${(barY + 13).toFixed(1)}" text-anchor="end" class="chart-bar-label">${labelText}</text>
        <rect x="${barX}" y="${barY}" width="${barLen.toFixed(1)}" height="${barH}" rx="4" fill="${fill}" opacity="0.85"/>
        <text x="${valX.toFixed(1)}" y="${(barY + 13).toFixed(1)}" text-anchor="start" class="chart-val-label">${esc(gbp0(v))}</text>`;
    }

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" style="display:block">${rows}</svg>`;
  }

  // ── chart c & d: generic horizontal bar chart ──
  // items: [{ label, subLabel, value, fill }]
  function chartHBars(items, valFormatter) {
    if (!items || items.length === 0) return '';
    const fmt = valFormatter || gbp0;
    const subLabelPresent = items.some((it) => it.subLabel);
    const ROW = subLabelPresent ? 44 : 34;
    const W = 420;
    const PAD = { t: 8, l: 150, r: 80, b: 8 };
    const H = PAD.t + items.length * ROW + PAD.b;
    const barW = W - PAD.l - PAD.r;

    const maxAbs = Math.max(...items.map((it) => Math.abs(safeN(it.value))), 1);

    let rows = '';
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const v = safeN(it.value);
      const y = PAD.t + i * ROW;
      const barLen = clamp((Math.abs(v) / maxAbs) * barW * 0.88, 2, barW * 0.88);
      const barX = PAD.l;
      const barY = y + (subLabelPresent ? 10 : 8);
      const barH = 16;
      const fill = it.fill || (v >= 0 ? 'var(--green)' : 'var(--red)');
      const valX = barX + barLen + 5;
      const labelY = barY + 12;

      rows += `<text x="${(PAD.l - 8).toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="end" class="chart-bar-label" title="${esc(it.label)}">${esc(truncate(it.label, 28))}</text>`;
      if (it.subLabel) {
        rows += `<text x="${(PAD.l - 8).toFixed(1)}" y="${(labelY + 13).toFixed(1)}" text-anchor="end" class="chart-bar-sub">${esc(truncate(it.subLabel, 32))}</text>`;
      }
      rows += `<rect x="${barX}" y="${barY}" width="${barLen.toFixed(1)}" height="${barH}" rx="4" fill="${fill}" opacity="0.85"/>`;
      rows += `<text x="${valX.toFixed(1)}" y="${(barY + 12).toFixed(1)}" text-anchor="start" class="chart-val-label">${esc(fmt(v))}</text>`;
    }

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" style="display:block">${rows}</svg>`;
  }

  // ── chart e: spend donut ──
  function chartSpendDonut(segments) {
    // segments: [{ label, value, color }]
    if (!segments || segments.length === 0) return '';

    const total = segments.reduce((s, seg) => s + safeN(seg.value), 0);
    if (total <= 0) return '';

    const R = 70, r = 42, CX = 110, CY = 90, W = 220, H = 180;

    // Build arcs
    let startAngle = -Math.PI / 2;
    let arcs = '';
    for (const seg of segments) {
      const v = safeN(seg.value);
      if (v <= 0) continue;
      const frac = v / total;
      const sweep = frac * 2 * Math.PI;
      const endAngle = startAngle + sweep;

      const x1 = CX + R * Math.cos(startAngle);
      const y1 = CY + R * Math.sin(startAngle);
      const x2 = CX + R * Math.cos(endAngle);
      const y2 = CY + R * Math.sin(endAngle);
      const ix1 = CX + r * Math.cos(startAngle);
      const iy1 = CY + r * Math.sin(startAngle);
      const ix2 = CX + r * Math.cos(endAngle);
      const iy2 = CY + r * Math.sin(endAngle);

      const largeArc = sweep > Math.PI ? 1 : 0;

      // Full circle if only one segment
      if (segments.filter((s) => safeN(s.value) > 0).length === 1) {
        arcs += `<path d="M${CX},${CY - R} A${R},${R} 0 1 1 ${(CX - 0.001).toFixed(3)},${CY - R} Z" fill="${seg.color}" opacity="0.9"/>`;
        arcs += `<path d="M${CX},${CY - r} A${r},${r} 0 1 0 ${(CX - 0.001).toFixed(3)},${CY - r} Z" fill="var(--panel)" opacity="1"/>`;
        startAngle = endAngle;
        continue;
      }

      arcs += `<path d="M${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${largeArc} 1 ${x2.toFixed(2)},${y2.toFixed(2)} L${ix2.toFixed(2)},${iy2.toFixed(2)} A${r},${r} 0 ${largeArc} 0 ${ix1.toFixed(2)},${iy1.toFixed(2)} Z" fill="${seg.color}" opacity="0.9"/>`;
      startAngle = endAngle;
    }

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" style="display:block">${arcs}</svg>`;
  }

  // ── INSIGHTS view ──
  function renderInsights() {
    const noData = state.products.length === 0 && state.history.length < 2;
    if (noData) {
      content.innerHTML = `
        <h1>Insights</h1>
        <p class="sub">Margin trend, category breakdown, top earners, switch opportunities and spend mix</p>
        <div class="panel"><div class="empty">
          <p><strong>No data yet.</strong> Add products in the Margin ledger, or load the worked example to see charts.</p>
          <div class="btn-row" style="justify-content:center">
            <button class="btn btn-primary" data-a="sample">Load worked example</button>
          </div>
        </div></div>`;
      bindAll('[data-a="sample"]', loadSample);
      return;
    }

    const t = E.practiceTotals(state.products, state.config);
    const bd = E.categoryBreakdown(state.products, state.config);

    // All product metrics (for top earners / drains)
    const allMetrics = state.products.map((p) => E.productMetrics(p, state.config));

    // Top 8 by absolute monthly profit
    const topEarners = allMetrics
      .slice()
      .sort((a, b) => Math.abs(safeN(b.monthlyProfitCurrent)) - Math.abs(safeN(a.monthlyProfitCurrent)))
      .slice(0, 8)
      .sort((a, b) => safeN(b.monthlyProfitCurrent) - safeN(a.monthlyProfitCurrent));

    // Switch opportunities (top 8)
    const topSwitch = (t.switchOpportunities || []).slice(0, 8);

    // Spend donut segments — sum currentCost * monthlyPacks per category
    const CHART_COLOURS = ['var(--chart1)', 'var(--chart2)', 'var(--chart3)', 'var(--chart4)'];
    const spendByCategory = new Map();
    for (const m of allMetrics) {
      if (m.currentCost == null) continue;
      const v = safeN(m.currentCost) * safeN(m.monthlyPacks);
      if (v <= 0) continue;
      spendByCategory.set(m.category, (spendByCategory.get(m.category) || 0) + v);
    }
    const spendTotal = [...spendByCategory.values()].reduce((s, v) => s + v, 0);
    const spendSegments = [...spendByCategory.entries()]
      .filter(([, v]) => v > 0)
      .map(([cat, v], i) => ({
        label: catLabel(cat),
        value: v,
        color: CHART_COLOURS[i % CHART_COLOURS.length],
      }));

    // ── Panel: margin trend ──
    const trendSvg = chartMarginTrend(state.history);

    // ── Panel: margin by category ──
    const catBarsHtml = bd.length > 0 ? chartCategoryBars(bd) : '<div class="empty" style="padding:18px 0"><p>No products yet.</p></div>';

    // ── Panel: top earners & drains ──
    const earnerItems = topEarners.map((m) => ({
      label: m.name,
      value: m.monthlyProfitCurrent,
      fill: safeN(m.monthlyProfitCurrent) >= 0 ? 'var(--green)' : 'var(--red)',
    }));
    const earnersHtml = earnerItems.length > 0
      ? chartHBars(earnerItems, gbp0)
      : '<div class="empty" style="padding:18px 0"><p>No priced products.</p></div>';

    // ── Panel: switch opportunities ──
    const switchItems = topSwitch.map((m) => ({
      label: m.name,
      subLabel: truncate(m.current ? m.current.name : '?', 18) + ' → ' + truncate(m.best ? m.best.name : '?', 18),
      value: m.switchSavingMonthly,
      fill: 'var(--accent)',
    }));
    const switchHtml = switchItems.length > 0
      ? chartHBars(switchItems, (v) => gbp0(v) + '/mo')
      : '<div class="empty" style="padding:18px 0"><p>No switch opportunities — all lines are on their cheapest supplier.</p></div>';

    // ── Panel: spend donut ──
    const donutHtml = buildDonutPanel(spendSegments, spendTotal);

    content.innerHTML = `
      <h1>Insights</h1>
      <p class="sub">Margin trend · category breakdown · top earners · switch opportunities · spend mix</p>

      <div class="panel" style="margin-bottom:16px">
        <h3>Margin trend</h3>
        <div class="pad" style="padding-top:10px">
          ${trendSvg}
        </div>
      </div>

      <div class="insights-grid">
        <div class="panel">
          <h3>Margin by category</h3>
          <div class="pad" style="padding-top:10px">${catBarsHtml}</div>
        </div>

        <div class="panel">
          <h3>Top earners &amp; drains</h3>
          <div class="pad" style="padding-top:10px">${earnersHtml}</div>
        </div>

        <div class="panel">
          <h3>Switch opportunity</h3>
          <div class="pad" style="padding-top:10px">${switchHtml}</div>
        </div>

        <div class="panel">
          <h3>Monthly spend mix</h3>
          ${donutHtml}
        </div>
      </div>`;
  }

  function buildDonutPanel(segments, total) {
    if (segments.length === 0 || total <= 0) {
      return '<div class="empty" style="padding:18px 0"><p>No priced products — enter supplier prices to see spend mix.</p></div>';
    }

    const donutSvg = chartSpendDonut(segments);

    // Centre label overlay — use an absolutely-positioned element over SVG
    // We embed it as SVG text instead for self-containment
    const CX = 110, CY = 90, W = 220, H = 180;
    const centreLabel = `
      <svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" style="display:block;position:absolute;top:0;left:0;pointer-events:none">
        <text x="${CX}" y="${CY - 6}" text-anchor="middle" style="font-family:var(--sans);font-size:15px;font-weight:700;fill:var(--text-1)">${esc(gbp0(total))}</text>
        <text x="${CX}" y="${CY + 10}" text-anchor="middle" class="chart-axis">spend/mo</text>
      </svg>`;

    // We'll rebuild as a single SVG with both arcs and centre text
    // Re-render the donut with centre text included
    const fullDonutSvg = chartSpendDonutWithLabel(segments, total);

    // Legend
    const legendHtml = segments.map((seg) => {
      const pctVal = total > 0 ? Math.round((seg.value / total) * 100) : 0;
      return `<div class="donut-legend-item"><div class="donut-swatch" style="background:${seg.color}"></div><span>${esc(seg.label)} ${esc(gbp0(seg.value))} (${pctVal}%)</span></div>`;
    }).join('');

    return `<div class="pad" style="padding-top:10px;padding-bottom:0">
      ${fullDonutSvg}
    </div>
    <div class="donut-legend">${legendHtml}</div>`;
  }

  function chartSpendDonutWithLabel(segments, total) {
    if (!segments || segments.length === 0) return '';

    const R = 70, r = 42, CX = 110, CY = 90, W = 220, H = 180;

    const nonZero = segments.filter((s) => safeN(s.value) > 0);
    if (nonZero.length === 0) return '';

    let startAngle = -Math.PI / 2;
    let arcs = '';

    if (nonZero.length === 1) {
      // Full ring for single category
      const seg = nonZero[0];
      arcs += `<path d="M${CX},${CY - R} A${R},${R} 0 1 1 ${(CX - 0.001).toFixed(3)},${(CY - R).toFixed(3)} Z" fill="${seg.color}" opacity="0.9"/>`;
      arcs += `<circle cx="${CX}" cy="${CY}" r="${r}" fill="var(--panel)"/>`;
    } else {
      for (const seg of nonZero) {
        const v = safeN(seg.value);
        const frac = v / safeN(total);
        const sweep = frac * 2 * Math.PI;
        const endAngle = startAngle + sweep;

        const x1 = CX + R * Math.cos(startAngle);
        const y1 = CY + R * Math.sin(startAngle);
        const x2 = CX + R * Math.cos(endAngle);
        const y2 = CY + R * Math.sin(endAngle);
        const ix1 = CX + r * Math.cos(startAngle);
        const iy1 = CY + r * Math.sin(startAngle);
        const ix2 = CX + r * Math.cos(endAngle);
        const iy2 = CY + r * Math.sin(endAngle);
        const largeArc = sweep > Math.PI ? 1 : 0;

        arcs += `<path d="M${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${largeArc} 1 ${x2.toFixed(2)},${y2.toFixed(2)} L${ix2.toFixed(2)},${iy2.toFixed(2)} A${r},${r} 0 ${largeArc} 0 ${ix1.toFixed(2)},${iy1.toFixed(2)} Z" fill="${seg.color}" opacity="0.9"/>`;
        // Gap between segments
        startAngle = endAngle + 0.025;
      }
    }

    const totalStr = esc(gbp0(total));
    const centre = `
      <text x="${CX}" y="${CY - 5}" text-anchor="middle" style="font-family:var(--sans);font-size:14px;font-weight:700;fill:var(--text-1)">${totalStr}</text>
      <text x="${CX}" y="${CY + 11}" text-anchor="middle" class="chart-axis">spend/mo</text>`;

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" style="display:block">${arcs}${centre}</svg>`;
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

  // ── LEDGER helpers ──
  function sortTh(label, key) {
    const ui = state.ledgerUI;
    const active = ui.sort === key;
    const arrow = active ? (ui.dir === 1 ? ' ▲' : ' ▼') : '';
    const ariaSort = active ? (ui.dir === 1 ? 'ascending' : 'descending') : 'none';
    return `<th class="sortable-th${active ? ' sort-active' : ''}" data-sort="${key}" tabindex="0" role="button" aria-sort="${ariaSort}">${label}${arrow}</th>`;
  }

  // Shared sort-click/keydown handler — binds to all .sortable-th in container.
  function bindSortHeaders(container) {
    container.querySelectorAll('.sortable-th').forEach((th) => {
      const handler = () => {
        const key = th.dataset.sort;
        const ui = state.ledgerUI;
        if (ui.sort === key) {
          if (ui.dir === 1) ui.dir = -1;
          else { ui.sort = null; ui.dir = 1; }
        } else {
          ui.sort = key; ui.dir = 1;
        }
        rebuildLedgerTable();
      };
      th.addEventListener('click', handler);
      th.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
      });
    });
  }

  function applyLedgerFilter(metrics) {
    const ui = state.ledgerUI;
    let out = metrics;
    if (ui.q) {
      const q = ui.q.toLowerCase();
      out = out.filter(({ p }) =>
        p.name.toLowerCase().includes(q) ||
        (p.suppliers || []).some((s) => s.name.toLowerCase().includes(q))
      );
    }
    if (ui.cat !== 'all') out = out.filter(({ p }) => p.category === ui.cat);
    if (ui.flag === 'loss') out = out.filter(({ m }) => m.lossMaker);
    if (ui.flag === 'switch') out = out.filter(({ m }) => m.switchable);
    if (ui.flag === 'unpriced') out = out.filter(({ m }) => m.currentCost == null);
    return out;
  }

  function applyLedgerSort(metrics) {
    const ui = state.ledgerUI;
    if (!ui.sort) return metrics;
    const nullLast = (a, b, getter) => {
      const av = getter(a), bv = getter(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * ui.dir;
    };
    const strSort = (a, b, getter) => {
      const av = getter(a) || '', bv = getter(b) || '';
      return av.localeCompare(bv) * ui.dir;
    };
    const sorted = metrics.slice();
    if (ui.sort === 'name') sorted.sort((a, b) => strSort(a, b, (x) => x.p.name));
    else if (ui.sort === 'tariff') sorted.sort((a, b) => nullLast(a, b, (x) => x.m.tariff));
    else if (ui.sort === 'netReimb') sorted.sort((a, b) => nullLast(a, b, (x) => x.m.netReimb));
    else if (ui.sort === 'buy') sorted.sort((a, b) => nullLast(a, b, (x) => x.m.currentCost));
    else if (ui.sort === 'margin') sorted.sort((a, b) => nullLast(a, b, (x) => x.m.marginPerPackCurrent));
    else if (ui.sort === 'packs') sorted.sort((a, b) => nullLast(a, b, (x) => x.m.monthlyPacks));
    else if (ui.sort === 'profit') sorted.sort((a, b) => nullLast(a, b, (x) => x.m.monthlyProfitCurrent));
    return sorted;
  }

  function ledgerToolbar(filtered, total) {
    const ui = state.ledgerUI;
    const isFiltered = ui.q !== '' || ui.cat !== 'all' || ui.flag !== 'all';
    const countNote = isFiltered ? `<span class="toolbar-count">${filtered} of ${total} lines</span>` : '';
    const clearBtn = isFiltered ? `<button class="btn" id="tb_clear" style="font-size:0.71rem">Clear</button>` : '';
    return `<div class="ledger-toolbar">
      <input id="tb_q" class="tb-search" placeholder="Search product or supplier…" value="${esc(ui.q)}" />
      <select id="tb_cat">
        <option value="all">All categories</option>
        ${E.CATEGORIES.map((c) => `<option value="${c.id}" ${ui.cat === c.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
      </select>
      <select id="tb_flag">
        <option value="all">All status</option>
        <option value="loss" ${ui.flag === 'loss' ? 'selected' : ''}>Loss-making</option>
        <option value="switch" ${ui.flag === 'switch' ? 'selected' : ''}>Switchable</option>
        <option value="unpriced" ${ui.flag === 'unpriced' ? 'selected' : ''}>Unpriced</option>
      </select>
      ${clearBtn}
      ${countNote}
      ${isFiltered ? `<span class="toolbar-note">totals above include all lines</span>` : ''}
    </div>`;
  }

  function rebuildLedgerTable() {
    const allMetrics = state.products.map((p) => ({ p, m: E.productMetrics(p, state.config) }));
    const filtered = applyLedgerFilter(allMetrics);
    const sorted = applyLedgerSort(filtered);

    // Update toolbar count/note
    const toolbarEl = content.querySelector('.ledger-toolbar');
    if (toolbarEl) {
      const ui = state.ledgerUI;
      const isFiltered = ui.q !== '' || ui.cat !== 'all' || ui.flag !== 'all';
      let countEl = toolbarEl.querySelector('.toolbar-count');
      if (isFiltered) {
        if (!countEl) {
          countEl = document.createElement('span');
          countEl.className = 'toolbar-count';
          toolbarEl.appendChild(countEl);
        }
        countEl.textContent = `${filtered.length} of ${allMetrics.length} lines`;
      } else if (countEl) {
        countEl.remove();
      }
      let noteEl = toolbarEl.querySelector('.toolbar-note');
      if (isFiltered) {
        if (!noteEl) {
          noteEl = document.createElement('span');
          noteEl.className = 'toolbar-note';
          toolbarEl.appendChild(noteEl);
          noteEl.textContent = 'totals above include all lines';
        }
      } else if (noteEl) {
        noteEl.remove();
      }
      let clearEl = toolbarEl.querySelector('#tb_clear');
      if (isFiltered && !clearEl) {
        clearEl = document.createElement('button');
        clearEl.className = 'btn';
        clearEl.id = 'tb_clear';
        clearEl.style.fontSize = '0.71rem';
        clearEl.textContent = 'Clear';
        toolbarEl.insertBefore(clearEl, toolbarEl.querySelector('.toolbar-count') || toolbarEl.firstChild);
        clearEl.addEventListener('click', () => {
          state.ledgerUI.q = ''; state.ledgerUI.cat = 'all'; state.ledgerUI.flag = 'all';
          const qEl = content.querySelector('#tb_q');
          if (qEl) qEl.value = '';
          const catEl = content.querySelector('#tb_cat');
          if (catEl) catEl.value = 'all';
          const flagEl = content.querySelector('#tb_flag');
          if (flagEl) flagEl.value = 'all';
          rebuildLedgerTable();
        });
      } else if (!isFiltered && clearEl) {
        clearEl.remove();
      }
    }

    // Rebuild table
    const tableWrap = content.querySelector('.ledger-table-wrap');
    if (tableWrap) {
      tableWrap.innerHTML = `<div style="overflow-x:auto">${ledgerTable(sorted)}</div>`;
      bindSortHeaders(tableWrap);
      tableWrap.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editProduct(b.dataset.edit)));
      tableWrap.querySelectorAll('[data-del]').forEach((b) =>
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
  }

  // ── Nudge banner ──
  function buildNudgeBanner() {
    if (state.products.length === 0) return '';
    const lastExport = localStorage.getItem(KEYS.lastExport);
    const nudgeAt = localStorage.getItem(KEYS.backupNudgeAt);
    const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // Suppress if dismissed within 14 days
    if (nudgeAt && now - new Date(nudgeAt).getTime() < FOURTEEN_DAYS) return '';
    // Suppress if exported within 14 days
    if (lastExport && now - new Date(lastExport).getTime() < FOURTEEN_DAYS) return '';

    return `<div class="nudge-banner">
      <span>No recent backup — export your data or set up auto-backup in Settings.</span>
      <div class="nudge-actions">
        <button class="btn btn-primary" style="font-size:0.71rem;padding:5px 10px" data-a="nudge-export">Export now</button>
        <button class="iconbtn" style="font-size:1rem;padding:2px 7px" data-a="nudge-dismiss" title="Dismiss for 14 days">&times;</button>
      </div>
    </div>`;
  }

  // ── First-run wizard ──
  function openWizard() {
    let currentStep = 1;
    let loadedSample = false;
    let wizardHost = null;

    function markOnboarded() {
      localStorage.setItem(KEYS.onboarded, '1');
    }

    function closeWizard() {
      markOnboarded();
      if (wizardHost) {
        wizardHost.remove();
        wizardHost = null;
      }
      document.removeEventListener('keydown', onWizardKey);
    }

    function onWizardKey(e) {
      if (e.key === 'Escape') {
        closeWizard();
      }
    }
    document.addEventListener('keydown', onWizardKey);

    function renderStep(step) {
      if (!wizardHost) return;
      const modal = wizardHost.querySelector('.modal');
      if (!modal) return;

      let titleText = '';
      let bodyHtml = '';
      let footerHtml = '';

      if (step === 1) {
        titleText = 'Welcome to Dispensing Check';
        bodyHtml = `
          <p class="note" style="font-size:0.93rem;color:var(--text-1);line-height:1.6">
            Dispensing Check helps UK dispensing practices analyse their Drug Tariff margins, spot loss-making lines, and find savings by switching to the cheapest supplier on file.
            Your formulary and price data stay here — every calculation runs locally in this browser, nothing is sent anywhere.
          </p>
          <p class="note" style="margin-top:10px">All data stays in this browser only. No patient data is stored. Nothing is transmitted.</p>`;
        footerHtml = `
          <button class="btn btn-primary" id="wiz-next">Next &rarr;</button>
          <button class="btn" id="wiz-skip" style="margin-left:auto">Skip setup</button>`;
      } else if (step === 2) {
        titleText = 'How do you want to start?';
        bodyHtml = `
          <div class="wizard-options">
            <button class="wizard-option" id="wiz-sample">
              <span class="wizard-option-title">Load the worked example</span>
              <span class="wizard-option-desc">See four sample products with margins, switch opportunities and a formulary — ready to explore.</span>
            </button>
            <button class="wizard-option" id="wiz-tariff">
              <span class="wizard-option-title">Import your Drug Tariff</span>
              <span class="wizard-option-desc">Download the NHSBSA Part VIII price list and import it now to pre-populate tariff prices.</span>
            </button>
            <button class="wizard-option" id="wiz-addproduct">
              <span class="wizard-option-title">Add my first product</span>
              <span class="wizard-option-desc">Jump straight in and enter a product name, tariff price and wholesaler quote.</span>
            </button>
          </div>`;
        footerHtml = `
          <button class="btn" id="wiz-back">&larr; Back</button>
          <button class="btn" id="wiz-skip" style="margin-left:auto">Skip setup</button>`;
      } else if (step === 3) {
        titleText = 'Where to look first';
        bodyHtml = `
          <p class="note" style="font-size:0.93rem;color:var(--text-1);margin-bottom:14px">The worked example is loaded. Here is where to start:</p>
          <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:10px">
            <li class="note" style="display:flex;gap:10px;align-items:flex-start"><span style="font-size:1.1rem">📊</span><span><strong style="color:var(--text-1)">The summary cards</strong> at the top of the Margin ledger show your monthly profit, switch savings and loss-making lines at a glance.</span></li>
            <li class="note" style="display:flex;gap:10px;align-items:flex-start"><span style="font-size:1.1rem">📈</span><span><strong style="color:var(--text-1)">The Insights tab</strong> shows margin trend charts, top earners, switch opportunities and spend mix — all built from your data.</span></li>
            <li class="note" style="display:flex;gap:10px;align-items:flex-start"><span style="font-size:1.1rem">🔀</span><span><strong style="color:var(--text-1)">The "Switch all" button</strong> in the ledger toolbar applies the cheapest supplier to every switchable line in one click.</span></li>
          </ul>`;
        footerHtml = `
          <button class="btn btn-primary" id="wiz-finish">Finish</button>`;
      }

      modal.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <h3 style="margin:0;font-size:1.01rem;font-family:var(--sans);letter-spacing:0;text-transform:none;padding:0;color:var(--text-1)">${esc(titleText)}</h3>
          <span class="note" style="font-size:0.69rem;margin-left:14px;white-space:nowrap">Step ${step}${step < 3 ? ' of ' + (loadedSample ? '3' : '2') : ' of 3'}</span>
        </div>
        <div class="mbody">${bodyHtml}</div>
        <div class="modal-actions" style="justify-content:flex-start;gap:8px">
          ${footerHtml}
        </div>`;

      // Bind buttons
      const nextBtn = modal.querySelector('#wiz-next');
      if (nextBtn) nextBtn.addEventListener('click', () => { currentStep = 2; renderStep(2); });

      const backBtn = modal.querySelector('#wiz-back');
      if (backBtn) backBtn.addEventListener('click', () => { currentStep = 1; renderStep(1); });

      const skipBtn = modal.querySelector('#wiz-skip');
      if (skipBtn) skipBtn.addEventListener('click', closeWizard);

      const finishBtn = modal.querySelector('#wiz-finish');
      if (finishBtn) finishBtn.addEventListener('click', closeWizard);

      const sampleBtn = modal.querySelector('#wiz-sample');
      if (sampleBtn) {
        sampleBtn.addEventListener('click', () => {
          loadedSample = true;
          loadSample();
          currentStep = 3;
          renderStep(3);
        });
      }

      const tariffBtn = modal.querySelector('#wiz-tariff');
      if (tariffBtn) {
        tariffBtn.addEventListener('click', () => {
          markOnboarded();
          closeWizard();
          state.view = 'data';
          render();
        });
      }

      const addProductBtn = modal.querySelector('#wiz-addproduct');
      if (addProductBtn) {
        addProductBtn.addEventListener('click', () => {
          markOnboarded();
          closeWizard();
          editProduct(null);
        });
      }

      // Focus first focusable
      const firstFocusable = modal.querySelector('button, input, select, textarea');
      if (firstFocusable) firstFocusable.focus();
    }

    // Build host
    wizardHost = document.createElement('div');
    wizardHost.className = 'modal-host';
    wizardHost.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Setup wizard" style="max-width:560px"></div>`;
    $('#modalRoot').appendChild(wizardHost);

    // Click outside closes
    wizardHost.addEventListener('click', (e) => {
      if (e.target === wizardHost) closeWizard();
    });

    renderStep(1);
  }

  // ── LEDGER (partner) ──
  function renderLedger() {
    recordSnapshot();

    // First-run wizard trigger
    if (
      state.products.length === 0 &&
      state.formulary.length === 0 &&
      !localStorage.getItem(KEYS.onboarded)
    ) {
      openWizard();
    }

    const t = E.practiceTotals(state.products, state.config);
    const rate = state.config.mode === 'dispensingDoctor' ? `Dispensing doctor · ${state.config.ddRate}% flat clawback` : 'Pharmacy group rates';
    const allMetrics = state.products.map((p) => ({ p, m: E.productMetrics(p, state.config) }));
    const filtered = applyLedgerFilter(allMetrics);
    const sorted = applyLedgerSort(filtered);
    const bd = E.categoryBreakdown(state.products, state.config);

    const tariffMonth = localStorage.getItem(KEYS.tariffMonth);
    const concessionsRaw = localStorage.getItem(KEYS.concessions);
    let subExtra = '';
    if (tariffMonth) subExtra += ' · Tariff: ' + esc(fmtYearMonth(tariffMonth));
    if (concessionsRaw) {
      try {
        const cd = JSON.parse(concessionsRaw);
        if (cd && cd.month) subExtra += ' · NCSO: ' + esc(fmtYearMonth(cd.month)) + ' (' + esc(String(cd.count || 0)) + ' lines)';
      } catch (_) {}
    }

    // Backup nudge banner
    const nudgeBanner = buildNudgeBanner();

    content.innerHTML = `
      ${nudgeBanner}
      <h1>Margin ledger</h1>
      <p class="sub">${esc(rate)} · ${t.pricedCount}/${t.productCount} products priced${subExtra}</p>
      <div class="btn-row">
        <button class="btn btn-primary" data-a="add">+ Product</button>
        ${t.switchableCount ? `<button class="btn" data-a="switchall">Switch all &rarr; save ${gbp0(t.switchSavingMonthly)}/mo</button><button class="btn" data-a="switchlistprint">Switch list</button><button class="btn" data-a="switchlistcsv">Switch CSV</button>` : ''}
        <button class="btn" data-a="print">Board report</button>
        ${state.products.length ? '' : '<button class="btn" data-a="sample">Load worked example</button>'}
      </div>
      ${cards(t)}
      ${state.products.length === 0 ? emptyLedger() : `
        ${ledgerToolbar(filtered.length, allMetrics.length)}
        <div class="panel ledger-table-wrap"><div style="overflow-x:auto">${ledgerTable(sorted)}</div></div>
      `}
      ${breakdownPanel(bd)}
      ${opportunities(t)}`;

    bindAll('[data-a="add"]', () => editProduct(null));
    bindAll('[data-a="switchall"]', () => switchAll());
    bindAll('[data-a="switchlistprint"]', () => { const t2 = E.practiceTotals(state.products, state.config); printSwitchList(t2); });
    bindAll('[data-a="switchlistcsv"]', () => { const t2 = E.practiceTotals(state.products, state.config); switchListCsv(t2); });
    bindAll('[data-a="print"]', () => printReport());
    bindAll('[data-a="sample"]', loadSample);

    if (state.products.length > 0) {
      const qEl = content.querySelector('#tb_q');
      qEl.addEventListener('input', (e) => {
        state.ledgerUI.q = e.target.value;
        rebuildLedgerTable();
      });
      content.querySelector('#tb_cat').addEventListener('change', (e) => {
        state.ledgerUI.cat = e.target.value;
        rebuildLedgerTable();
      });
      content.querySelector('#tb_flag').addEventListener('change', (e) => {
        state.ledgerUI.flag = e.target.value;
        rebuildLedgerTable();
      });
      const clearEl = content.querySelector('#tb_clear');
      if (clearEl) {
        clearEl.addEventListener('click', () => {
          state.ledgerUI.q = ''; state.ledgerUI.cat = 'all'; state.ledgerUI.flag = 'all';
          content.querySelector('#tb_q').value = '';
          content.querySelector('#tb_cat').value = 'all';
          content.querySelector('#tb_flag').value = 'all';
          rebuildLedgerTable();
        });
      }
      bindSortHeaders(content);
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

    // Nudge banner actions
    const nudgeExport = content.querySelector('[data-a="nudge-export"]');
    if (nudgeExport) nudgeExport.addEventListener('click', () => {
      const payload = buildBackup();
      download(payload, `dispensing-check-backup-${today()}.json`, 'application/json');
      localStorage.setItem(KEYS.lastExport, new Date().toISOString());
      render();
    });
    const nudgeDismiss = content.querySelector('[data-a="nudge-dismiss"]');
    if (nudgeDismiss) nudgeDismiss.addEventListener('click', () => {
      localStorage.setItem(KEYS.backupNudgeAt, new Date().toISOString());
      render();
    });
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
        if (m.onConcession) flags.push('<span class="flag ncso">NCSO</span>');
        const chips = (p.suppliers || [])
          .map((s) => {
            const sp = E.priceValue(s.price);
            const best = m.best && s.name === m.best.name && sp !== null && sp === m.best.price;
            const cur = m.current && s.name === m.current.name;
            return `<span class="chip ${best ? 'best' : ''}">${esc(s.name)} ${sp === null ? '—' : gbp(sp)}${cur ? ' ●' : ''}</span>`;
          })
          .join('');
        const mc = m.marginPerPackCurrent == null ? '' : m.marginPerPackCurrent < 0 ? 'neg' : 'pos';
        let metaPriceLine = '';
        if (m.onConcession && m.tariff != null && m.tariffBase != null) {
          metaPriceLine = ' · concession ' + gbp(m.tariff) + ' (tariff ' + gbp(m.tariffBase) + ')';
        }
        return `<tr class="${m.lossMaker ? 'row-loss' : ''}">
          <td><div class="name">${esc(p.name) || '<em>unnamed</em>'}</div>
            <div class="meta">${esc(p.pack ? 'pack ' + p.pack : '')} · ${esc(catLabel(p.category))} · clawback ${(m.rate * 100).toFixed(2)}%${m.costPerUnit != null ? ' · ' + gbp(m.costPerUnit) + '/unit' : ''}${metaPriceLine}</div>
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
    return `<table><thead><tr>${sortTh('Product','name')}${sortTh('Tariff','tariff')}${sortTh('Net reimb.','netReimb')}${sortTh('Buy','buy')}${sortTh('Margin/pack','margin')}${sortTh('Packs/mo','packs')}${sortTh('Profit/mo','profit')}<th></th></tr></thead><tbody>${rows}</tbody></table>`;
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
      const out = {
        id: typeof x.id === 'string' && x.id ? x.id : E.makeId(),
        name: typeof x.name === 'string' ? x.name : '',
        pack: typeof x.pack === 'string' ? x.pack : '',
        category: catIds.includes(x.category) ? x.category : 'generic',
        tariff: isFinite(Number(x.tariff)) ? Number(x.tariff) : 0,
        monthlyPacks: isFinite(Number(x.monthlyPacks)) ? Number(x.monthlyPacks) : 0,
        suppliers,
        currentSupplier: typeof x.currentSupplier === 'string' ? x.currentSupplier : null,
      };
      if (isFinite(Number(x.concessionPrice)) && Number(x.concessionPrice) > 0) out.concessionPrice = Number(x.concessionPrice);
      return out;
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
    const tariffMonthVal = localStorage.getItem(KEYS.tariffMonth) || '';
    const tariffMetaNote = tariffMonthVal
      ? `<p class="note" style="margin-top:6px">Current tariff: <strong>${esc(fmtYearMonth(tariffMonthVal))}</strong>. Import a new file to update.</p>`
      : '';
    const matchTariffBtn = tariffMonthVal
      ? `<button class="btn" data-a="matchtariff">Match tariff to products</button>`
      : '';

    const concessionsRaw = localStorage.getItem(KEYS.concessions);
    let ncsoNote = '';
    if (concessionsRaw) {
      try {
        const cd = JSON.parse(concessionsRaw);
        if (cd && cd.month) ncsoNote = `<p class="note" style="margin-top:6px">Current concessions: <strong>${esc(fmtYearMonth(cd.month))}</strong> (${esc(String(cd.count || 0))} lines applied). Import a new month to replace.</p>`;
      } catch (_) {}
    }

    content.innerHTML = `
      <h1>Import / export</h1>
      <p class="sub">CSV for price lists · JSON for a full backup (products, formulary, settings, history)</p>

      <div class="panel" id="tariffPanel"><h3>Drug Tariff (NHSBSA)</h3><div class="pad">
        <p class="note">Download the Part VIII price list from the NHSBSA website, then import the file here (CSV or XLSX). Data stays on this device only.</p>
        ${tariffMetaNote}
        <div class="btn-row" style="margin-top:10px">
          <button class="btn btn-primary" data-a="imptariff">Import tariff file</button>
          ${matchTariffBtn}
        </div>
        <input type="file" id="ftariff" accept=".csv,.xlsx" style="display:none" />
      </div></div>

      <div class="panel" id="ncsoPanel"><h3>Price concessions (NCSO)</h3><div class="pad">
        <p class="note">Paste the current month's concession list (from the DHSC/CPE publication) or import it as CSV. Concession prices override the tariff for margin calculations and are cleared when you import a new month.</p>
        ${ncsoNote}
        <label class="field" style="margin-top:8px"><span>Paste concession list</span><textarea id="ncsoText" rows="5" placeholder="Paste lines here, or use Import file below…"></textarea></label>
        <div class="field-row">
          <label class="field"><span>Month</span><input type="month" id="ncsoMonth" value="${esc(currentYearMonth())}" /></label>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" data-a="applyNcso">Apply concessions</button>
          <button class="btn" data-a="impncso">Import file (CSV)</button>
          <button class="btn" data-a="clearNcso">Clear concessions</button>
        </div>
        <input type="file" id="fncso" accept=".csv,text/csv" style="display:none" />
        <p class="note" id="ncsoResult" style="margin-top:6px"></p>
      </div></div>

      <div class="panel"><h3>Price list (CSV)</h3><div class="pad">
        <p class="note">Columns: <code>${esc(E.CSV_HEADER)}</code>. Rows sharing name+pack group into one product. Empty price = unpriced.</p>
        <div class="btn-row"><button class="btn" data-a="impcsv">Import CSV</button><button class="btn" data-a="expcsv">Export CSV</button></div>
        <p class="note" id="mergeResult" style="margin-top:6px"></p>
      </div></div>
      <div class="panel"><h3>Full backup (JSON)</h3><div class="pad"><div class="btn-row"><button class="btn" data-a="impjson">Import JSON</button><button class="btn" data-a="expjson">Export JSON</button></div></div></div>
      <div class="panel"><div class="pad">
        <p class="note">No patient data is stored or transmitted by this tool. All data lives in this browser only.</p>
        <div class="btn-row" style="margin-top:8px"><button class="btn" data-a="goig">Data &amp; IG statement</button></div>
      </div></div>
      <input type="file" id="fcsv" accept=".csv,text/csv" style="display:none" />
      <input type="file" id="fjson" accept=".json,application/json" style="display:none" />`;

    const fcsv = $('#fcsv'), fjson = $('#fjson');
    const ftariff = $('#ftariff'), fncso = $('#fncso');

    // ── Drug Tariff import ──
    bindMaybe('[data-a="imptariff"]', () => ftariff.click());
    bindMaybe('[data-a="matchtariff"]', () => {
      idbAllTariff().then((tariffRows) => {
        if (!tariffRows.length) { alert('No tariff data stored. Import a tariff file first.'); return; }
        if (!state.products.length) { alert('No products to match against. Add products first.'); return; }
        const proposals = I.matchRows(state.products, tariffRows);
        openMatchReviewModal(proposals, tariffRows, localStorage.getItem(KEYS.tariffMonth) || '');
      });
    });

    ftariff.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      e.target.value = '';
      try {
        let grid;
        if (f.name.toLowerCase().endsWith('.xlsx')) {
          const buf = await f.arrayBuffer();
          grid = await I.parseXlsx(buf);
        } else {
          const text = await f.text();
          grid = I.gridFromCsv(text);
        }
        if (!grid || !grid.length) { alert('No data found in that file.'); return; }
        openTariffMappingModal(grid, f.name);
      } catch (err) {
        alert('Could not read that file: ' + esc(err.message));
      }
    });

    // ── NCSO import ──
    bindMaybe('[data-a="impncso"]', () => fncso.click());
    bindMaybe('[data-a="applyNcso"]', () => {
      const text = ($('#ncsoText') || {}).value || '';
      const month = ($('#ncsoMonth') || {}).value || currentYearMonth();
      applyNcsoText(text, month);
    });
    bindMaybe('[data-a="clearNcso"]', () => {
      if (!confirm('Clear all concession prices from products?')) return;
      state.products = state.products.map((p) => {
        const copy = Object.assign({}, p);
        delete copy.concessionPrice;
        return copy;
      });
      save(KEYS.products, state.products);
      localStorage.removeItem(KEYS.concessions);
      render();
    });

    fncso.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      e.target.value = '';
      try {
        const text = await f.text();
        const ta = $('#ncsoText');
        if (ta) ta.value = text;
        const month = ($('#ncsoMonth') || {}).value || currentYearMonth();
        applyNcsoText(text, month);
      } catch (err) {
        alert('Could not read that file: ' + esc(err.message));
      }
    });

    // ── Price list CSV ──
    bindMaybe('[data-a="impcsv"]', () => fcsv.click());
    bindMaybe('[data-a="expcsv"]', () => download(E.toCsv(state.products), `dispensing-margin-${today()}.csv`, 'text/csv'));
    bindMaybe('[data-a="impjson"]', () => fjson.click());
    bindMaybe('[data-a="goig"]', () => { state.view = 'ig'; render(); });
    bindMaybe('[data-a="expjson"]', () => {
      download(buildBackup(), `dispensing-check-backup-${today()}.json`, 'application/json');
      localStorage.setItem(KEYS.lastExport, new Date().toISOString());
    });
    fcsv.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const parsed = E.parseCsv(await f.text());
        if (!parsed.length) { alert('No rows found. Expected columns: ' + E.CSV_HEADER); e.target.value = ''; return; }
        if (state.products.length > 0) {
          openMergeModal('csv', parsed, null);
          e.target.value = '';
          return;
        }
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
        const incomingHistory = Array.isArray(d.history) ? sanitiseHistory(d.history) : null;
        const wouldReplace = state.products.length > 0 || state.formulary.length > 0;
        if (wouldReplace) {
          openMergeModal('json', incomingProducts, incomingFormulary, incomingHistory, d.config);
          e.target.value = '';
          return;
        }
        state.products = incomingProducts;
        state.formulary = incomingFormulary;
        if (d.config) state.config = mergeConfig(d.config);
        if (incomingHistory) state.history = incomingHistory;
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

  // ── Merge-on-import modal ──
  // type: 'csv' | 'json'
  // For CSV: incomingProducts only; for JSON: incomingProducts + incomingFormulary + incomingHistory + rawConfig
  function openMergeModal(type, incomingProducts, incomingFormulary, incomingHistory, rawConfig) {
    const existingProdCount = state.products.length;
    const existingFormCount = state.formulary ? state.formulary.length : 0;

    const desc = type === 'csv'
      ? `<p class="note">The file contains ${esc(String(incomingProducts.length))} product rows. You already have ${esc(String(existingProdCount))} products on file.</p>`
      : `<p class="note">The backup contains ${esc(String(incomingProducts.length))} products and ${esc(String((incomingFormulary || []).length))} formulary entries. You already have ${esc(String(existingProdCount))} products and ${esc(String(existingFormCount))} formulary entries.</p>`;

    const mergeLabel = type === 'csv' ? 'Merge products (recommended)' : 'Merge (recommended)';
    const mergeDesc = type === 'csv'
      ? 'Add new products and update existing ones by name+pack. Leaves your other data untouched.'
      : 'Add new products, formulary entries and history snapshots. Does not overwrite your settings or practice name.';

    const bodyHtml = `
      ${desc}
      <div class="wizard-options" style="margin-top:14px">
        <button class="wizard-option" data-merge="merge">
          <span class="wizard-option-title">${esc(mergeLabel)}</span>
          <span class="wizard-option-desc">${esc(mergeDesc)}</span>
        </button>
        <button class="wizard-option" data-merge="replace">
          <span class="wizard-option-title">Replace everything</span>
          <span class="wizard-option-desc">Overwrite all current data with the imported file. ${type === 'json' ? 'Settings and practice name will also be replaced.' : 'All existing products will be removed.'}</span>
        </button>
        <button class="wizard-option wizard-option-cancel" data-merge="cancel">
          <span class="wizard-option-title">Cancel</span>
          <span class="wizard-option-desc">Keep your current data unchanged.</span>
        </button>
      </div>`;

    const host = openModal(type === 'csv' ? 'Import CSV — merge or replace?' : 'Import backup — merge or replace?', bodyHtml, () => false);

    // Hide the default Save/Cancel buttons — we use the option buttons instead
    const actionsEl = host.querySelector('.modal-actions');
    if (actionsEl) actionsEl.style.display = 'none';

    host.querySelectorAll('[data-merge]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const choice = btn.dataset.merge;
        if (choice === 'cancel') {
          host.remove();
          return;
        }

        const prevProdCount = state.products.length;
        const prevFormCount = (state.formulary || []).length;
        const prevProdIds = new Set(state.products.map((p) => E.productKeyOf(p)));
        const prevFormIds = new Set((state.formulary || []).map((f) => f.id));

        if (choice === 'merge') {
          if (type === 'csv') {
            state.products = E.mergeProducts(state.products, incomingProducts);
          } else {
            state.products = E.mergeProducts(state.products, incomingProducts);
            state.formulary = E.mergeFormulary(state.formulary || [], incomingFormulary || []);
            if (incomingHistory) {
              state.history = E.mergeHistory(state.history, incomingHistory, 36);
            }
            // Do NOT touch config/practiceName/pin on merge
          }
        } else {
          // replace
          state.products = incomingProducts;
          if (type === 'json') {
            state.formulary = incomingFormulary || [];
            if (rawConfig) state.config = mergeConfig(rawConfig);
            if (incomingHistory) state.history = incomingHistory;
          }
        }

        save(KEYS.products, state.products);
        save(KEYS.formulary, state.formulary);
        if (type === 'json') {
          save(KEYS.config, state.config);
          save(KEYS.history, state.history);
        }
        state.view = 'data';
        host.remove();
        render();

        // Show result message
        if (choice === 'merge') {
          const newProdCount = state.products.length;
          const newFormCount = (state.formulary || []).length;
          const newProds = type === 'csv'
            ? state.products.filter((p) => !prevProdIds.has(E.productKeyOf(p))).length
            : state.products.filter((p) => !prevProdIds.has(E.productKeyOf(p))).length;
          const newForms = (state.formulary || []).filter((f) => !prevFormIds.has(f.id)).length;
          const msg = type === 'csv'
            ? `Merged: ${newProdCount} products (${newProds} new).`
            : `Merged: ${newProdCount} products (${newProds} new), formulary ${newFormCount} (${newForms} new).`;
          // Show inline on data view if result element exists, else alert
          const resultEl = document.getElementById('mergeResult');
          if (resultEl) resultEl.textContent = msg;
          else alert(msg);
        }
      });
    });
  }

  // ── Drug Tariff: column mapping modal ──
  function openTariffMappingModal(grid, fileName) {
    const headerRow = grid[0] || [];
    const detected = I.detectColumns(headerRow, 'tariff');
    const colOpts = (sel) => headerRow.map((h, i) =>
      `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(h || '(col ' + (i + 1) + ')')}</option>`
    ).join('');
    const noneOpt = '<option value="">-- none --</option>';

    function buildPreview(mapping) {
      const rows = I.extractRows(grid, mapping).slice(0, 5);
      if (!rows.length) return '<p class="note">No rows extracted with current settings.</p>';
      return `<table class="modal-import-table"><thead><tr><th>Name</th><th>Pack</th><th class="num">Price</th></tr></thead><tbody>${
        rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.pack)}</td><td class="num">${esc('£' + (r.price || 0).toFixed(2))}</td></tr>`).join('')
      }</tbody></table>`;
    }

    const bodyId = 'tariffMapBody';
    const bodyHtml = `
      <p class="note" style="margin-bottom:10px">File: <strong>${esc(fileName)}</strong> — ${esc(String(grid.length - 1))} data rows detected.</p>
      <div class="field-row">
        <label class="field"><span>Name column</span><select id="tm_name">${noneOpt}${colOpts(detected.name)}</select></label>
        <label class="field"><span>Pack column</span><select id="tm_pack">${noneOpt}${colOpts(detected.pack)}</select></label>
        <label class="field"><span>Price column</span><select id="tm_price">${noneOpt}${colOpts(detected.price)}</select></label>
      </div>
      <div class="field-row">
        <label class="field" style="flex-direction:row;align-items:center;gap:8px;margin-bottom:0">
          <input type="checkbox" id="tm_pence" ${detected.pence ? 'checked' : ''} style="width:auto;padding:0" />
          <span>Prices are in pence</span>
        </label>
        <label class="field"><span>Month</span><input type="month" id="tm_month" value="${esc(currentYearMonth())}" /></label>
      </div>
      <div id="tm_preview" style="margin-top:10px;max-height:160px;overflow-y:auto">${buildPreview({ name: detected.name, pack: detected.pack, price: detected.price, pence: detected.pence, headerRows: 1 })}</div>`;

    const host = openModal('Column mapping — Drug Tariff', bodyHtml, () => {
      const mapping = {
        name: $('#tm_name').value !== '' ? Number($('#tm_name').value) : null,
        pack: $('#tm_pack').value !== '' ? Number($('#tm_pack').value) : null,
        price: $('#tm_price').value !== '' ? Number($('#tm_price').value) : null,
        pence: $('#tm_pence').checked,
        headerRows: 1,
      };
      const monthLabel = $('#tm_month').value || currentYearMonth();
      const rows = I.extractRows(grid, mapping);
      if (!rows.length) { alert('No rows could be extracted with those column settings.'); return false; }

      if (!state.products.length) {
        // No products — store only, skip match review
        idbPutTariff(rows, monthLabel).then(() => {
          localStorage.setItem(KEYS.tariffMonth, monthLabel);
          render();
          alert(`${rows.length} tariff lines stored for ${esc(fmtYearMonth(monthLabel))}. Add products and use "Match tariff to products" to apply prices.`);
        });
        return true;
      }

      openMatchReviewModal(I.matchRows(state.products, rows), rows, monthLabel);
      return true;
    });

    // Save button label
    const saveBtn = host.querySelector('[data-x="save"]');
    if (saveBtn) saveBtn.textContent = 'Continue';

    // Live preview on change
    function refreshPreview() {
      const mapping = {
        name: $('#tm_name').value !== '' ? Number($('#tm_name').value) : null,
        pack: $('#tm_pack').value !== '' ? Number($('#tm_pack').value) : null,
        price: $('#tm_price').value !== '' ? Number($('#tm_price').value) : null,
        pence: ($('#tm_pence') || {}).checked,
        headerRows: 1,
      };
      const prev = $('#tm_preview');
      if (prev) prev.innerHTML = buildPreview(mapping);
    }
    ['tm_name', 'tm_pack', 'tm_price', 'tm_pence'].forEach((id) => {
      const el = $('#' + id);
      if (el) el.addEventListener('change', refreshPreview);
    });
  }

  // ── Drug Tariff: match review modal ──
  function openMatchReviewModal(proposals, allRows, monthLabel) {
    if (!proposals.length) {
      alert('No matches found between stored tariff lines and your products. Check that product names are similar to the tariff file.');
      // Still store the tariff data
      idbPutTariff(allRows, monthLabel).then(() => {
        localStorage.setItem(KEYS.tariffMonth, monthLabel);
        render();
      });
      return;
    }

    const confLabel = { exact: 'Exact', strong: 'Strong', weak: 'Weak' };

    const rowsHtml = proposals.map((pr, idx) => {
      const prod = state.products.find((p) => p.id === pr.productId);
      const oldPrice = prod ? prod.tariff : null;
      const newPrice = pr.row.price;
      const checked = pr.confidence !== 'weak' ? 'checked' : '';
      return `<tr>
        <td><input type="checkbox" class="mr-chk" data-idx="${idx}" ${checked} style="width:auto;padding:0" /></td>
        <td><div class="name" style="font-size:0.81rem">${esc(prod ? prod.name : pr.productId)}</div><div class="meta">${esc(prod ? (prod.pack || '') : '')}</div></td>
        <td class="meta">${esc(pr.row.name)}<br>${esc(pr.row.pack || '')}</td>
        <td class="num">${oldPrice != null ? esc(gbp(oldPrice)) : '—'} &rarr; ${esc(gbp(newPrice))}</td>
        <td><span class="conf-${esc(pr.confidence)}">${esc(confLabel[pr.confidence] || pr.confidence)}</span></td>
      </tr>`;
    }).join('');

    const bodyHtml = `
      <p class="note" style="margin-bottom:8px">${esc(String(proposals.length))} match${proposals.length !== 1 ? 'es' : ''} found. Exact and strong matches are pre-selected. Review and tick the lines to apply.</p>
      <div style="max-height:50vh;overflow-y:auto;margin-bottom:10px">
        <table class="modal-import-table"><thead><tr><th></th><th>Product</th><th>Tariff line</th><th class="num">Old &rarr; New</th><th>Match</th></tr></thead>
        <tbody>${rowsHtml}</tbody></table>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <label style="font-size:0.79rem;display:flex;align-items:center;gap:5px"><input type="checkbox" id="mr_selectall" checked style="width:auto;padding:0" /> Select all</label>
      </div>`;

    const host = openModal('Match review — Drug Tariff', bodyHtml, () => {
      const checked = Array.from(host.querySelectorAll('.mr-chk:checked')).map((el) => Number(el.dataset.idx));
      let updated = 0;
      for (const idx of checked) {
        const pr = proposals[idx];
        const i = state.products.findIndex((p) => p.id === pr.productId);
        if (i >= 0) {
          state.products[i] = Object.assign({}, state.products[i], { tariff: pr.row.price });
          updated++;
        }
      }
      save(KEYS.products, state.products);
      idbPutTariff(allRows, monthLabel).then(() => {
        localStorage.setItem(KEYS.tariffMonth, monthLabel);
        render();
        alert(`Updated ${updated} product${updated !== 1 ? 's' : ''} from the ${fmtYearMonth(monthLabel)} tariff. ${allRows.length} tariff lines stored for future matching.`);
      });
      return true;
    });

    const saveBtn = host.querySelector('[data-x="save"]');
    if (saveBtn) saveBtn.textContent = 'Apply selected';

    // Select-all toggle
    const saEl = host.querySelector('#mr_selectall');
    if (saEl) {
      saEl.addEventListener('change', () => {
        host.querySelectorAll('.mr-chk').forEach((cb) => { cb.checked = saEl.checked; });
      });
    }
  }

  // ── NCSO: apply concessions ──
  function applyNcsoText(text, month) {
    if (!text.trim()) { alert('Please paste or import the concession list first.'); return; }
    const { rows, skipped } = I.parseConcessions(text);
    if (!rows.length) { alert('No concession lines could be parsed. Check the format.'); return; }

    const proposals = I.matchRows(state.products, rows);
    const exact = proposals.filter((p) => p.confidence === 'exact' || p.confidence === 'strong');
    const weak = proposals.filter((p) => p.confidence === 'weak');

    function doApply(toApply) {
      let applied = 0;
      for (const pr of toApply) {
        const i = state.products.findIndex((p) => p.id === pr.productId);
        if (i >= 0) {
          state.products[i] = Object.assign({}, state.products[i], { concessionPrice: pr.row.price });
          applied++;
        }
      }
      // Clear concessionPrice from products not in toApply
      const appliedIds = new Set(toApply.map((p) => p.productId));
      state.products = state.products.map((p) => {
        if (!appliedIds.has(p.id) && p.concessionPrice !== undefined) {
          const copy = Object.assign({}, p);
          delete copy.concessionPrice;
          return copy;
        }
        return p;
      });
      save(KEYS.products, state.products);
      save(KEYS.concessions, { month, appliedAt: new Date().toISOString(), count: applied });
      const unmatched = rows.length - proposals.length;
      const skippedCount = skipped.length + unmatched;
      render();
      const resultEl = document.getElementById('ncsoResult');
      if (resultEl) resultEl.textContent = `Applied ${applied} concession${applied !== 1 ? 's' : ''} (${skippedCount} lines skipped/unmatched).`;
      else alert(`Applied ${applied} concession${applied !== 1 ? 's' : ''} (${skippedCount} lines skipped/unmatched).`);
    }

    if (!weak.length) {
      doApply(exact);
      return;
    }

    // Weak matches need confirm modal
    const confLabel = { exact: 'Exact', strong: 'Strong', weak: 'Weak' };
    const weakRowsHtml = weak.map((pr, idx) => {
      const prod = state.products.find((p) => p.id === pr.productId);
      return `<tr>
        <td><input type="checkbox" class="nw-chk" data-idx="${idx}" style="width:auto;padding:0" /></td>
        <td><div class="name" style="font-size:0.81rem">${esc(prod ? prod.name : pr.productId)}</div><div class="meta">${esc(prod ? (prod.pack || '') : '')}</div></td>
        <td class="meta">${esc(pr.row.name)}<br>${esc(pr.row.pack || '')}</td>
        <td class="num">${esc(gbp(pr.row.price))}</td>
        <td><span class="conf-${esc(pr.confidence)}">${esc(confLabel[pr.confidence] || pr.confidence)}</span></td>
      </tr>`;
    }).join('');

    const host = openModal('Weak concession matches', `
      <p class="note" style="margin-bottom:8px">The following ${esc(String(weak.length))} line${weak.length !== 1 ? 's' : ''} matched weakly. Tick those you want to apply (unticked by default).</p>
      <div style="max-height:40vh;overflow-y:auto;margin-bottom:10px">
        <table class="modal-import-table"><thead><tr><th></th><th>Product</th><th>Concession line</th><th class="num">Price</th><th>Match</th></tr></thead>
        <tbody>${weakRowsHtml}</tbody></table>
      </div>`, () => {
      const checkedIdxs = Array.from(host.querySelectorAll('.nw-chk:checked')).map((el) => Number(el.dataset.idx));
      const selectedWeak = checkedIdxs.map((i) => weak[i]);
      doApply(exact.concat(selectedWeak));
      return true;
    });
    const saveBtn = host.querySelector('[data-x="save"]');
    if (saveBtn) saveBtn.textContent = `Apply ${esc(String(exact.length))} auto + selected weak`;
  }

  // ── SETTINGS ──
  function renderSettings() {
    const c = state.config;
    content.innerHTML = `
      <h1>Settings</h1>
      <p class="sub">Clawback model, margin thresholds, practice identity and the prescriber-view PIN</p>
      <div class="panel"><h3>Appearance</h3><div class="pad">
        <div class="field-row">
          <label class="field"><span>Text size</span>
            <select id="s_textsize">
              <option value="sm">Small</option>
              <option value="md">Medium</option>
              <option value="lg">Large</option>
              <option value="xl">Extra large</option>
            </select>
          </label>
          <label class="field"><span>Density</span>
            <select id="s_density">
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
          <label class="field"><span>Theme</span>
            <select id="s_theme">
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
        </div>
        <div class="field">
          <span>Accent colour</span>
          <div class="accent-swatches" id="s_accent">
            <button class="accent-swatch" data-accent="indigo" title="Indigo (default)" style="background:#5b8cff"></button>
            <button class="accent-swatch" data-accent="teal" title="Teal" style="background:#2dd4bf"></button>
            <button class="accent-swatch" data-accent="violet" title="Violet" style="background:#8b5cf6"></button>
            <button class="accent-swatch" data-accent="amber" title="Amber" style="background:#f59e0b"></button>
          </div>
        </div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn" data-a="runwizard">Run setup guide</button>
        </div>
      </div></div>
      <div class="panel"><h3>Backup</h3><div class="pad">
        <div id="backupStatus">${buildBackupStatusHtml()}</div>
      </div></div>
      <div class="panel"><div class="pad">
        <label class="field"><span>Practice name (shown in headers / report)</span><input id="s_name" value="${esc(state.practiceName)}" placeholder="e.g. Greendale Surgery" /></label>
        <label class="field"><span>Clawback model</span><select id="s_mode"><option value="dispensingDoctor" ${c.mode === 'dispensingDoctor' ? 'selected' : ''}>Dispensing doctor — flat rate</option><option value="pharmacyGroups" ${c.mode === 'pharmacyGroups' ? 'selected' : ''}>Pharmacy group rates</option></select></label>
        <div id="s_dd" class="${c.mode === 'dispensingDoctor' ? '' : 'hidden'}" style="${c.mode === 'dispensingDoctor' ? '' : 'display:none'}"><label class="field"><span>Flat clawback %</span><input id="s_dd_rate" type="number" step="0.01" min="0" max="100" value="${c.ddRate}" /></label><p class="note">SFE reference for dispensing doctors is 11.18%. Confirm your figure.</p></div>
        <div id="s_grp" style="${c.mode === 'pharmacyGroups' ? '' : 'display:none'}"><div class="field-row">${E.CATEGORIES.map((cat) => `<label class="field"><span>${cat.label} %</span><input class="s_grate" data-cat="${cat.id}" type="number" step="0.01" min="0" max="100" value="${c.groupRates[cat.id]}" /></label>`).join('')}</div><p class="note">Drug Tariff Part V group deductions: generics 20.00%, branded 5.00%, appliances 9.85%.</p></div>
        <div class="field-row"><label class="field"><span>Healthy margin % (green)</span><input id="s_green" type="number" min="0" max="100" value="${c.thresholds.green}" /></label><label class="field"><span>Watch margin % (amber)</span><input id="s_amber" type="number" min="0" max="100" value="${c.thresholds.amber}" /></label></div>
        <label class="field"><span>Prescriber-view PIN (optional — gates entry to the partner view)</span><input id="s_pin" value="${esc(state.pin)}" placeholder="leave blank for no PIN" /></label>
        <div class="btn-row"><button class="btn btn-primary" data-a="save">Save</button><button class="btn" data-a="reset">Reset rates</button></div>
        <p class="note">The PIN is a soft gate for shared workstations, not strong security — it keeps prices out of the prescriber view by default.</p>
      </div></div>
      <div class="panel" style="border-color:color-mix(in srgb, var(--red) 40%, transparent)">
        <h3 style="color:var(--red)">Danger zone</h3>
        <div class="pad">
          <p class="note">Permanently removes all products, formulary entries, history and settings stored in this browser.</p>
          <button class="btn btn-danger" data-a="clearall">Clear all data…</button>
        </div>
      </div>`;

    const tsEl = $('#s_textsize');
    tsEl.value = localStorage.getItem(KEYS.textSize) || 'md';
    tsEl.addEventListener('change', () => { localStorage.setItem(KEYS.textSize, tsEl.value); applyAppearance(); });

    const dnEl = $('#s_density');
    dnEl.value = localStorage.getItem(KEYS.density) || 'comfortable';
    dnEl.addEventListener('change', () => { localStorage.setItem(KEYS.density, dnEl.value); applyAppearance(); });

    const thEl = $('#s_theme');
    thEl.value = localStorage.getItem(KEYS.theme) || 'dark';
    thEl.addEventListener('change', () => { localStorage.setItem(KEYS.theme, thEl.value); applyTheme(); });

    const curAccent = localStorage.getItem(KEYS.accent) || 'indigo';
    content.querySelectorAll('.accent-swatch').forEach((b) => {
      b.classList.toggle('accent-swatch-active', b.dataset.accent === curAccent);
      b.addEventListener('click', () => {
        localStorage.setItem(KEYS.accent, b.dataset.accent);
        applyAppearance();
        content.querySelectorAll('.accent-swatch').forEach((x) => x.classList.toggle('accent-swatch-active', x.dataset.accent === b.dataset.accent));
      });
    });

    bindBackupButtons();

    bindMaybe('[data-a="runwizard"]', () => {
      localStorage.removeItem(KEYS.onboarded);
      state.view = 'ledger';
      render();
    });

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
    bindMaybe('[data-a="clearall"]', () => {
      if (!confirm('This permanently deletes all products, formulary entries, history and settings stored in this browser, including the imported tariff dataset and the auto-backup link. Export a JSON backup first. Continue?')) return;
      Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
      if (_backup.timer) clearTimeout(_backup.timer);
      _backup.timer = null;
      _backup.handle = null;
      _backup.status = 'idle';
      if (_idb) {
        _idb.close();
        _idb = null;
      }
      if (window.indexedDB) {
        try { window.indexedDB.deleteDatabase('dispensingCheck'); } catch (_) {}
      }
      state.products = [];
      state.formulary = [];
      state.history = [];
      state.config = mergeConfig(null);
      state.practiceName = '';
      state.pin = '';
      state.ledgerUI = { q: '', cat: 'all', flag: 'all', sort: null, dir: 1 };
      state.view = 'ledger';
      render();
    });
  }

  // ── switch list helpers ──
  function csvCell(v) {
    const s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) return '"\''+s.replace(/"/g,'""')+'"';
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"'+s.replace(/"/g,'""')+'"';
    return s;
  }

  function switchListCsv(t) {
    const rows = (t.switchOpportunities || []).map((m) => [
      csvCell(m.name),
      csvCell(m.pack || ''),
      csvCell(m.current ? m.current.name : ''),
      csvCell(m.currentCost != null ? m.currentCost.toFixed(2) : ''),
      csvCell(m.best ? m.best.name : ''),
      csvCell(m.bestCost != null ? m.bestCost.toFixed(2) : ''),
      csvCell(m.monthlyPacks != null ? m.monthlyPacks : ''),
      csvCell(m.switchSavingMonthly != null ? m.switchSavingMonthly.toFixed(2) : ''),
      csvCell(m.switchSavingAnnual != null ? m.switchSavingAnnual.toFixed(2) : ''),
    ].join(','));
    const header = 'product,pack,from supplier,from price,to supplier,to price,packs/mo,saving/mo,saving/yr';
    download([header].concat(rows).join('\r\n'), `switch-list-${today()}.csv`, 'text/csv');
  }

  function printSwitchList(t) {
    const date = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
    const opps = t.switchOpportunities || [];
    if (!opps.length) { alert('No switch opportunities to print.'); return; }

    // Group by target wholesaler name
    const grouped = new Map();
    for (const m of opps) {
      const key = m.best ? m.best.name : 'Unknown';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(m);
    }

    let tablesSvg = '';
    let grandMonthly = 0, grandAnnual = 0;
    for (const [supplier, lines] of grouped) {
      const subtotalMonthly = lines.reduce((s, m) => s + (m.switchSavingMonthly || 0), 0);
      const subtotalAnnual = lines.reduce((s, m) => s + (m.switchSavingAnnual || 0), 0);
      grandMonthly += subtotalMonthly;
      grandAnnual += subtotalAnnual;
      const bodyRows = lines.map((m) => `<tr>
        <td>${esc(m.name)}</td>
        <td>${esc(m.pack || '')}</td>
        <td>${esc(m.current ? m.current.name : '?')}</td>
        <td class="r">${m.currentCost != null ? gbp(m.currentCost) : '?'}</td>
        <td class="r">${m.bestCost != null ? gbp(m.bestCost) : '?'}</td>
        <td class="r">${m.monthlyPacks != null ? m.monthlyPacks : '?'}</td>
        <td class="r">${gbp(m.switchSavingMonthly)}</td>
      </tr>`).join('');
      tablesSvg += `
        <h2>Switch to: ${esc(supplier)}</h2>
        <table>
          <thead><tr><th>Product</th><th>Pack</th><th>Current supplier</th><th class="r">From</th><th class="r">To</th><th class="r">Packs/mo</th><th class="r">Saving/mo</th></tr></thead>
          <tbody>${bodyRows}</tbody>
          <tfoot><tr class="subtotal"><td colspan="6">Subtotal — ${esc(supplier)}</td><td class="r">${gbp(subtotalMonthly)}</td></tr></tfoot>
        </table>`;
    }

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Switch list -- ${esc(date)}</title><style>
      body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:32px;font-size:13px}
      h1{font-size:20px;margin:0 0 2px}.s{color:#475569;font-size:12px;margin:0 0 18px}
      .grand{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:20px;padding:12px 14px;border:1px solid #cbd5e1;border-radius:10px}
      .grand .l{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#475569}.grand .v{font-size:20px;font-weight:700;margin-top:4px;color:#16a34a}
      h2{font-size:14px;margin:18px 0 8px;border-bottom:1px solid #cbd5e1;padding-bottom:4px}
      table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px}
      th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0}
      .r{text-align:right}
      tfoot .subtotal td{font-weight:700;border-top:1px solid #94a3b8;border-bottom:none}
      .f{margin-top:24px;color:#64748b;font-size:10px}
    </style></head><body>
      <h1>Switch list</h1>
      <p class="s">${esc(state.practiceName || 'Practice')} &middot; ${esc(date)} &middot; ${opps.length} line(s)</p>
      <div class="grand">
        <div><div class="l">Total saving / month</div><div class="v">${gbp0(grandMonthly)}</div></div>
        <div><div class="l">Total saving / year</div><div class="v">${gbp0(grandAnnual)}</div></div>
      </div>
      ${tablesSvg}
      <p class="f">Generated by Dispensing Check. Switch to the cheapest supplier on file for each line. Prices entered by the practice; verify with wholesalers before ordering.</p>
      <script>window.onload=function(){setTimeout(function(){window.print();},200);};<\/script></body></html>`;
    const w = window.open('', '_blank');
    if (!w) { alert('Please allow pop-ups to open the printable switch list.'); return; }
    w.document.write(html);
    w.document.close();
  }

  // ── IG one-pager ──
  function renderIg() {
    content.innerHTML = `
      <h1>Information governance statement</h1>
      <p class="sub">What this tool stores, where it lives, and what that means for your practice</p>

      <div class="panel"><div class="pad">
        <h3 style="font-size:0.86rem;text-transform:none;letter-spacing:0;color:var(--text-1);padding:0 0 8px">What this tool stores</h3>
        <p class="note">Dispensing Check stores the following in your browser's <code>localStorage</code>:</p>
        <ul class="note" style="margin:6px 0;padding-left:18px">
          <li>Product names, pack sizes, Drug Tariff prices and supplier quotes you enter</li>
          <li>Monthly pack volumes</li>
          <li>Formulary entries (preferred drugs and clinically-equivalent alternatives)</li>
          <li>App settings: clawback model, margin thresholds, practice name, partner PIN</li>
          <li>Monthly margin snapshots (totals only, for the trend chart)</li>
        </ul>
        <p class="note">This is <strong>commercial data only</strong> — prices, margins and purchasing information.</p>
      </div></div>

      <div class="panel"><div class="pad">
        <h3 style="font-size:0.86rem;text-transform:none;letter-spacing:0;color:var(--text-1);padding:0 0 8px">What it never stores</h3>
        <p class="note">Dispensing Check has <strong>no patient data</strong> of any kind. It does not store, process or display:</p>
        <ul class="note" style="margin:6px 0;padding-left:18px">
          <li>Patient names, NHS numbers or dates of birth</li>
          <li>Clinical records, diagnoses or prescription history</li>
          <li>Prescriber identifiers</li>
          <li>Any data from your clinical system</li>
        </ul>
      </div></div>

      <div class="panel"><div class="pad">
        <h3 style="font-size:0.86rem;text-transform:none;letter-spacing:0;color:var(--text-1);padding:0 0 8px">Where data lives</h3>
        <p class="note">All data is stored in <code>localStorage</code> in <strong>this browser on this device</strong>. Nothing is transmitted anywhere:</p>
        <ul class="note" style="margin:6px 0;padding-left:18px">
          <li>No cloud storage, no server, no database outside this browser</li>
          <li>No analytics, no tracking, no third-party scripts</li>
          <li>The app makes <strong>zero network requests</strong> after the page has loaded</li>
        </ul>
        <p class="note">Data does not leave the device unless you deliberately export it (JSON backup or CSV).</p>
      </div></div>

      <div class="panel"><div class="pad">
        <h3 style="font-size:0.86rem;text-transform:none;letter-spacing:0;color:var(--text-1);padding:0 0 8px">What this means for governance</h3>
        <p class="note">Because no patient data is held or transmitted, this tool does not create a patient data flow and is not subject to DSPT assessment on that basis. However:</p>
        <ul class="note" style="margin:6px 0;padding-left:18px">
          <li>Practices should still follow local information governance policy for commercial data</li>
          <li>The commercial data stored here (prices, margins) may be practice-sensitive; treat it accordingly</li>
          <li>This statement reflects the architecture as written; it is not a formal IG compliance certificate</li>
        </ul>
      </div></div>

      <div class="panel"><div class="pad">
        <h3 style="font-size:0.86rem;text-transform:none;letter-spacing:0;color:var(--text-1);padding:0 0 8px">Backups</h3>
        <p class="note">Browser <code>localStorage</code> is not backed up automatically. Use <strong>Import / export &rarr; Export JSON</strong> to save a full backup. We recommend exporting monthly and storing the file on your practice shared drive. If the browser profile is cleared, data in <code>localStorage</code> is lost.</p>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn" data-a="godata">Go to Import / export</button>
        </div>
      </div></div>

      <div class="panel"><div class="pad">
        <h3 style="font-size:0.86rem;text-transform:none;letter-spacing:0;color:var(--text-1);padding:0 0 8px">Shared workstations</h3>
        <p class="note">The partner PIN (set in Settings) is a <strong>soft gate</strong> that keeps prices and margins out of the prescriber view by default on shared machines. It is not a strong security control and does not encrypt data in storage. If the workstation is shared with non-clinical staff, consider who has access to the browser profile.</p>
      </div></div>

      <div class="panel"><div class="pad">
        <h3 style="font-size:0.86rem;text-transform:none;letter-spacing:0;color:var(--text-1);padding:0 0 8px">Verify it yourself</h3>
        <p class="note">You do not have to take this statement on trust:</p>
        <ul class="note" style="margin:6px 0;padding-left:18px">
          <li>Open browser DevTools (F12) and go to the <strong>Network</strong> tab. After the page loads, no requests appear -- the app makes no network calls at runtime</li>
          <li>The source code (<code>app.js</code>, <code>engine.js</code>) is unminified, readable JavaScript. There are no obfuscated sections</li>
          <li>DevTools &rarr; Application &rarr; Local Storage shows exactly what is stored under the <code>dc.*</code> keys</li>
        </ul>
      </div></div>`;

    bindMaybe('[data-a="godata"]', () => { state.view = 'data'; render(); });
  }

  // ── printSafeSvg: replace CSS variable references with literal print-safe colours ──
  function printSafeSvg(svg) {
    return svg
      .replace(/var\(--green\)/g, '#16a34a')
      .replace(/var\(--red\)/g, '#dc2626')
      .replace(/var\(--accent\)/g, '#2563eb')
      .replace(/var\(--text-1\)/g, '#0f172a')
      .replace(/var\(--text-2\)/g, '#475569')
      .replace(/var\(--text-3\)/g, '#475569')
      .replace(/var\(--stroke\)/g, '#cbd5e1')
      .replace(/var\(--panel\)/g, '#ffffff')
      .replace(/var\(--[^)]+\)/g, '#475569');
  }

  // ── board report (print) ──
  function printReport() {
    const t = E.practiceTotals(state.products, state.config);
    const bd = E.categoryBreakdown(state.products, state.config);
    const date = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
    const opp = t.switchOpportunities.slice(0, 15).map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.current ? m.current.name : '?')}</td><td>${esc(m.best ? m.best.name : '?')}</td><td class="r">${gbp(m.switchSavingMonthly)}</td><td class="r">${gbp(m.switchSavingAnnual)}</td></tr>`).join('');
    const loss = t.lossMakers.slice(0, 15).map((m) => `<tr><td>${esc(m.name)}</td><td class="r">${gbp(m.netReimb)}</td><td class="r">${gbp(m.currentCost)}</td><td class="r">${gbp(m.monthlyProfitCurrent)}</td></tr>`).join('');
    const cat = bd.map((r) => `<tr><td>${esc(r.label)}</td><td class="r">${r.productCount}</td><td class="r">${gbp(r.monthlyProfitCurrent)}</td><td class="r">${gbp(r.switchSavingMonthly)}</td><td class="r">${r.lossCount}</td></tr>`).join('');

    const trendSvgRaw = chartMarginTrend(state.history);
    const showTrend = state.history.length >= 2 && !trendSvgRaw.includes('<div class="empty"');
    const trendBlock = showTrend
      ? `<h2>Margin trend</h2>${printSafeSvg(trendSvgRaw)}`
      : '';
    const catBarsRaw = bd.length > 0 ? chartCategoryBars(bd) : '';
    const catBarsBlock = catBarsRaw
      ? `<h2>Margin by category (chart)</h2>${printSafeSvg(catBarsRaw)}`
      : '';

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Dispensing Margin report — ${esc(date)}</title><style>
      body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:32px;font-size:13px}h1{font-size:20px;margin:0 0 2px}.s{color:#475569;font-size:12px;margin:0 0 18px}
      .cards{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:20px}.c{border:1px solid #cbd5e1;border-radius:10px;padding:12px 14px;min-width:150px}.c .l{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#475569}.c .v{font-size:22px;font-weight:700;margin-top:4px}.pos{color:#16a34a}.neg{color:#dc2626}
      h2{font-size:14px;margin:18px 0 8px;border-bottom:1px solid #cbd5e1;padding-bottom:4px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0}.r{text-align:right}.f{margin-top:24px;color:#64748b;font-size:10px}
      .chart-axis,.chart-axis-label,.chart-bar-sub,.chart-bar-label,.chart-val-label{font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:10px;fill:#475569}
      .chart-bar-label{font-size:11px;fill:#0f172a}.chart-val-label{font-weight:700;fill:#475569}
      .chart-grid{stroke:#cbd5e1;stroke-dasharray:3 4}.chart-zero{stroke:#475569}
      </style></head><body>
      <h1>Dispensing Margin report</h1><p class="s">${esc(state.practiceName || 'Practice')} · ${esc(date)} · ${t.pricedCount}/${t.productCount} products priced</p>
      <div class="cards"><div class="c"><div class="l">Monthly margin</div><div class="v ${t.monthlyProfitCurrent >= 0 ? 'pos' : 'neg'}">${gbp0(t.monthlyProfitCurrent)}</div></div><div class="c"><div class="l">Annualised</div><div class="v">${gbp0(t.annualProfitCurrent)}</div></div><div class="c"><div class="l">Switch saving/mo</div><div class="v">${gbp0(t.switchSavingMonthly)}</div></div><div class="c"><div class="l">Switch saving/yr</div><div class="v">${gbp0(t.switchSavingAnnual)}</div></div><div class="c"><div class="l">Loss lines</div><div class="v ${t.lossCount ? 'neg' : ''}">${t.lossCount}</div></div></div>
      ${trendBlock}
      ${catBarsBlock}
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
    const previousFocus = document.activeElement;
    const host = document.createElement('div');
    host.className = 'modal-host';
    host.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3><div class="mbody">${bodyHtml}</div><div class="modal-actions"><button class="btn" data-x="cancel">Cancel</button><button class="btn btn-primary" data-x="save">Save</button></div></div>`;
    $('#modalRoot').appendChild(host);

    const modal = host.querySelector('.modal');

    function getFocusable() {
      return Array.from(modal.querySelectorAll(
        'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )).filter((el) => !el.disabled && el.offsetParent !== null);
    }

    const close = () => {
      host.remove();
      document.removeEventListener('keydown', onKey);
      if (previousFocus && previousFocus.focus) previousFocus.focus();
    };

    const onKey = (e) => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'Tab') {
        const focusable = getFocusable();
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    };
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

  loadBackupHandle();
  render();
})();
