/* Dispensing Check — data-import engine (v1.1, M1 + M2).
 *
 * No DOM, no storage, no runtime dependencies. Loads as a plain <script>
 * (exposes window.DispensingImporters) and as a CommonJS module (Node tests).
 *
 * Requires DispensingEngine helpers splitCsvRows and parseMoney (exported from
 * engine.js). In browser, DispensingEngine must be loaded before this script.
 * In Node, the require() at the bottom pulls it in automatically.
 */
(function (root, factory) {
  /* UMD pattern matching engine.js */
  const E =
    typeof module !== 'undefined' && module.exports
      ? require('./engine.js')
      : root.DispensingEngine;
  const api = factory(E);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DispensingImporters = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E) {
  'use strict';

  const splitCsvRows = E.splitCsvRows;
  const parseMoney = E.parseMoney;

  // ── XML entity decode ───────────────────────────────────────────────────────
  function decodeEntities(s) {
    return s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  // ── Column-letter to 0-based index ('A'->0, 'Z'->25, 'AA'->26) ─────────────
  function colLettersToIndex(letters) {
    let n = 0;
    for (let i = 0; i < letters.length; i++) {
      n = n * 26 + (letters.charCodeAt(i) - 64);
    }
    return n - 1;
  }

  // Parse a cell reference like 'A1', 'BC42' -> { col, row }
  function parseCellRef(ref) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    if (!m) return null;
    return { col: colLettersToIndex(m[1]), row: parseInt(m[2], 10) - 1 };
  }

  // ── Minimal ZIP reader ──────────────────────────────────────────────────────
  // Reads End Of Central Directory (EOCD) to locate the central directory,
  // then builds a map of filename -> { offset, size, compressedSize, method }.

  function readUint16LE(buf, offset) {
    return buf[offset] | (buf[offset + 1] << 8);
  }
  function readUint32LE(buf, offset) {
    return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0;
  }

  function findEOCD(bytes) {
    // Scan backwards for EOCD signature 0x06054b50
    for (let i = bytes.length - 22; i >= 0; i--) {
      if (
        bytes[i] === 0x50 &&
        bytes[i + 1] === 0x4b &&
        bytes[i + 2] === 0x05 &&
        bytes[i + 3] === 0x06
      ) {
        return i;
      }
    }
    return -1;
  }

  function parseZip(bytes) {
    const eocdOffset = findEOCD(bytes);
    if (eocdOffset < 0) throw new Error('Not a ZIP file: EOCD not found');

    const cdSize = readUint32LE(bytes, eocdOffset + 12);
    const cdOffset = readUint32LE(bytes, eocdOffset + 16);

    const entries = new Map(); // filename -> entry info
    let pos = cdOffset;
    const cdEnd = cdOffset + cdSize;

    while (pos < cdEnd) {
      // Central directory file header signature: 0x02014b50
      if (
        bytes[pos] !== 0x50 ||
        bytes[pos + 1] !== 0x4b ||
        bytes[pos + 2] !== 0x01 ||
        bytes[pos + 3] !== 0x02
      ) break;

      const compressedSize = readUint32LE(bytes, pos + 20);
      const uncompressedSize = readUint32LE(bytes, pos + 24);
      const method = readUint16LE(bytes, pos + 10);
      const fileNameLen = readUint16LE(bytes, pos + 28);
      const extraLen = readUint16LE(bytes, pos + 30);
      const commentLen = readUint16LE(bytes, pos + 32);
      const localHeaderOffset = readUint32LE(bytes, pos + 42);

      const fileNameBytes = bytes.slice(pos + 46, pos + 46 + fileNameLen);
      let fileName = '';
      for (let i = 0; i < fileNameBytes.length; i++) {
        fileName += String.fromCharCode(fileNameBytes[i]);
      }

      entries.set(fileName, { localHeaderOffset, compressedSize, uncompressedSize, method });
      pos += 46 + fileNameLen + extraLen + commentLen;
    }

    return entries;
  }

  function getEntryData(bytes, entry) {
    // Read local file header to find actual data start
    const lh = entry.localHeaderOffset;
    if (
      bytes[lh] !== 0x50 ||
      bytes[lh + 1] !== 0x4b ||
      bytes[lh + 2] !== 0x03 ||
      bytes[lh + 3] !== 0x04
    ) throw new Error('Invalid local file header');

    const fnLen = readUint16LE(bytes, lh + 26);
    const extraLen = readUint16LE(bytes, lh + 28);
    const dataStart = lh + 30 + fnLen + extraLen;
    return bytes.slice(dataStart, dataStart + entry.compressedSize);
  }

  async function decompressEntry(bytes, entry) {
    const raw = getEntryData(bytes, entry);
    if (entry.method === 0) {
      // Stored — no compression
      return raw;
    }
    if (entry.method === 8) {
      // Deflate-raw via DecompressionStream
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      writer.write(raw);
      writer.close();
      const chunks = [];
      let totalLen = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalLen += value.length;
      }
      const out = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
      }
      return out;
    }
    throw new Error('Unsupported ZIP compression method: ' + entry.method);
  }

  function uint8ArrayToString(bytes) {
    // Decode UTF-8
    let s = '';
    let i = 0;
    while (i < bytes.length) {
      const b = bytes[i];
      if (b < 0x80) {
        s += String.fromCharCode(b);
        i++;
      } else if ((b & 0xe0) === 0xc0) {
        const cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
        s += String.fromCharCode(cp);
        i += 2;
      } else if ((b & 0xf0) === 0xe0) {
        const cp = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
        s += String.fromCharCode(cp);
        i += 3;
      } else if ((b & 0xf8) === 0xf0) {
        const cp =
          ((b & 0x07) << 18) |
          ((bytes[i + 1] & 0x3f) << 12) |
          ((bytes[i + 2] & 0x3f) << 6) |
          (bytes[i + 3] & 0x3f);
        // Encode as surrogate pair
        const offset = cp - 0x10000;
        s += String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
        i += 4;
      } else {
        s += String.fromCharCode(b);
        i++;
      }
    }
    return s;
  }

  // ── Shared strings XML parser ───────────────────────────────────────────────
  // Extracts <si> entries: each may have a single <t> or multiple <r><t> runs.
  function parseSharedStrings(xml) {
    const strings = [];
    // Match each <si>...</si> block
    const siRe = /<si>([\s\S]*?)<\/si>/g;
    let siMatch;
    while ((siMatch = siRe.exec(xml)) !== null) {
      const siContent = siMatch[1];
      // Try <r><t>...</t></r> runs first
      const runs = [];
      const runRe = /<r\b[^>]*>([\s\S]*?)<\/r>/g;
      let runMatch;
      while ((runMatch = runRe.exec(siContent)) !== null) {
        const tMatch = /<t(?:\s[^>]*)?>([^<]*)<\/t>/.exec(runMatch[1]);
        if (tMatch) runs.push(decodeEntities(tMatch[1]));
      }
      if (runs.length > 0) {
        strings.push(runs.join(''));
      } else {
        // Single <t> (possibly with xml:space="preserve")
        const tMatch = /<t(?:\s[^>]*)?>([^<]*)<\/t>/.exec(siContent);
        strings.push(tMatch ? decodeEntities(tMatch[1]) : '');
      }
    }
    return strings;
  }

  // ── Sheet XML parser ────────────────────────────────────────────────────────
  // No DOMParser (not available in Node). Regex-scan for <c> cells.
  function parseSheetXml(xml, sharedStrings) {
    const grid = [];

    function ensureCell(r, c) {
      while (grid.length <= r) grid.push([]);
      while (grid[r].length <= c) grid[r].push('');
    }

    // Match each <c .../> or <c ...>...</c>
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let m;
    while ((m = cellRe.exec(xml)) !== null) {
      const attrs = m[1];
      const inner = m[2];

      // r= attribute (cell reference)
      const rAttr = /\br="([^"]+)"/.exec(attrs);
      if (!rAttr) continue;
      const cellRef = parseCellRef(rAttr[1]);
      if (!cellRef) continue;

      // t= attribute (type)
      const tAttr = /\bt="([^"]+)"/.exec(attrs);
      const cellType = tAttr ? tAttr[1] : '';

      let value = '';
      if (cellType === 'inlineStr') {
        // Inline string: <is><t>...</t></is>
        const isMatch = /<is>([\s\S]*?)<\/is>/.exec(inner);
        if (isMatch) {
          // May have <r><t> runs
          const runRe2 = /<r\b[^>]*>([\s\S]*?)<\/r>/g;
          const runs = [];
          let rm;
          while ((rm = runRe2.exec(isMatch[1])) !== null) {
            const tM = /<t(?:\s[^>]*)?>([^<]*)<\/t>/.exec(rm[1]);
            if (tM) runs.push(decodeEntities(tM[1]));
          }
          if (runs.length > 0) {
            value = runs.join('');
          } else {
            const tM = /<t(?:\s[^>]*)?>([^<]*)<\/t>/.exec(isMatch[1]);
            value = tM ? decodeEntities(tM[1]) : '';
          }
        }
      } else if (cellType === 's') {
        // Shared string index
        const vMatch = /<v>([^<]*)<\/v>/.exec(inner);
        if (vMatch) {
          const idx = parseInt(vMatch[1], 10);
          value = (sharedStrings && sharedStrings[idx] != null) ? String(sharedStrings[idx]) : '';
        }
      } else {
        // Numeric or other: read <v>
        const vMatch = /<v>([^<]*)<\/v>/.exec(inner);
        value = vMatch ? decodeEntities(vMatch[1]) : '';
      }

      ensureCell(cellRef.row, cellRef.col);
      grid[cellRef.row][cellRef.col] = value;
    }

    // Normalise: fill all rows to same width, ensure no sparse rows
    let maxCols = 0;
    for (const row of grid) if (row.length > maxCols) maxCols = row.length;
    for (const row of grid) {
      while (row.length < maxCols) row.push('');
    }

    return grid;
  }

  // ── Find the right worksheet entry from the ZIP ─────────────────────────────
  function findSheetEntry(entries) {
    // Prefer xl/worksheets/sheet1.xml, then any xl/worksheets/*.xml lowest number
    if (entries.has('xl/worksheets/sheet1.xml')) return 'xl/worksheets/sheet1.xml';
    let best = null;
    let bestNum = Infinity;
    for (const name of entries.keys()) {
      const m = /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(name);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n < bestNum) { bestNum = n; best = name; }
      }
    }
    return best;
  }

  // ── parseXlsx ───────────────────────────────────────────────────────────────
  async function parseXlsx(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const entries = parseZip(bytes);

    // Load shared strings if present
    let sharedStrings = [];
    if (entries.has('xl/sharedStrings.xml')) {
      const ssBytes = await decompressEntry(bytes, entries.get('xl/sharedStrings.xml'));
      const ssXml = uint8ArrayToString(ssBytes);
      sharedStrings = parseSharedStrings(ssXml);
    }

    // Find and parse the first worksheet
    const sheetName = findSheetEntry(entries);
    if (!sheetName) throw new Error('No worksheet found in XLSX');
    const sheetBytes = await decompressEntry(bytes, entries.get(sheetName));
    const sheetXml = uint8ArrayToString(sheetBytes);
    return parseSheetXml(sheetXml, sharedStrings);
  }

  // ── gridFromCsv ─────────────────────────────────────────────────────────────
  function gridFromCsv(text) {
    return splitCsvRows(text);
  }

  // ── detectColumns ────────────────────────────────────────────────────────────
  // kind: 'tariff' | 'concession' | 'generic' | 'statement' | 'volume'
  // For 'statement': Returns { name, pack, price, pence }
  // For 'volume':    Returns { name, pack, qty, pence: false }
  // Others:         Returns { name, pack, price, pence }
  function detectColumns(headerRow, kind) {
    const headers = (headerRow || []).map((h) => String(h || '').toLowerCase().trim());

    function find(tests) {
      for (let i = 0; i < headers.length; i++) {
        if (tests.some((t) => headers[i].includes(t))) return i;
      }
      return null;
    }

    let nameCol = null;
    let packCol = null;
    let pence = false;

    if (kind === 'tariff' || kind === 'concession' || kind === 'generic') {
      nameCol = find(['medicine', 'drug', 'name', 'description']);
      packCol = find(['pack', 'size', 'quantity', 'qty']);
      const priceCol = find(['price', 'tariff', 'basic', 'concession']);

      // pence detection from header
      if (priceCol !== null) {
        const ph = headers[priceCol];
        if (ph.includes('(p)') || ph.includes('pence')) pence = true;
      }

      return { name: nameCol, pack: packCol, price: priceCol, pence };
    }

    if (kind === 'statement') {
      nameCol = find(['description', 'product description', 'item', 'medicine', 'drug', 'name']);
      packCol = find(['pack size', 'pack', 'size']);
      const priceCol = find(['trade price', 'net price', 'unit price', 'cost', 'price', 'tariff', 'basic', 'concession']);

      // pence detection from header
      if (priceCol !== null) {
        const ph = headers[priceCol];
        if (ph.includes('(p)') || ph.includes('pence')) pence = true;
      }

      return { name: nameCol, pack: packCol, price: priceCol, pence };
    }

    if (kind === 'volume') {
      nameCol = find(['bnf name', 'presentation', 'medicine', 'drug', 'name', 'description']);
      packCol = find(['pack size', 'pack', 'size']);
      const qtyCol = find(['quantity', 'qty', 'items', 'packs', 'volume', 'number of']);

      return { name: nameCol, pack: packCol, qty: qtyCol, pence: false };
    }

    // Fallback for unknown kinds
    return { name: null, pack: null, price: null, pence: false };
  }

  // Detect pence from sampled values (integer-only and large median > 500)
  function detectPenceFromValues(grid, priceColIdx, startRow) {
    if (priceColIdx === null) return false;
    const vals = [];
    for (let r = startRow; r < Math.min(grid.length, startRow + 20); r++) {
      const cell = String((grid[r] && grid[r][priceColIdx]) || '').trim();
      const n = Number(cell);
      if (Number.isFinite(n) && n > 0) vals.push(n);
    }
    if (vals.length === 0) return false;
    const allInteger = vals.every((v) => Number.isInteger(v));
    if (!allInteger) return false;
    vals.sort((a, b) => a - b);
    const median = vals[Math.floor(vals.length / 2)];
    return median > 500;
  }

  // ── extractRows ──────────────────────────────────────────────────────────────
  // mapping = { name, pack, price, pence, headerRows }
  // Returns [{ name, pack, price }] — price in pounds.
  function extractRows(grid, mapping) {
    const headerRows = mapping.headerRows != null ? mapping.headerRows : 1;
    const nameCol = mapping.name;
    const packCol = mapping.pack;
    const priceCol = mapping.price;

    // Auto-detect pence from values if not already set by header
    let pence = !!mapping.pence;
    if (!pence && priceCol !== null) {
      pence = detectPenceFromValues(grid, priceCol, headerRows);
    }

    const result = [];
    for (let r = headerRows; r < grid.length; r++) {
      const row = grid[r] || [];
      const name = nameCol !== null ? String(row[nameCol] || '').trim() : '';
      const pack = packCol !== null ? String(row[packCol] || '').trim() : '';

      let rawPrice = '';
      if (priceCol !== null) rawPrice = String(row[priceCol] || '').trim();

      if (!name) continue;

      // Skip rows with empty price cell
      if (rawPrice === '') continue;

      // Parse price — strip £, spaces, commas
      const n = Number(rawPrice.replace(/[£\s,]/g, ''));
      if (!Number.isFinite(n)) continue;

      const price = pence ? n / 100 : n;
      if (!Number.isFinite(price)) continue;

      result.push({ name, pack, price });
    }
    return result;
  }

  // ── extractVolumeRows ─────────────────────────────────────────────────────────
  // mapping = { name, pack, qty, headerRows }  (pack may be null)
  // Returns [{ name, pack, qty }] where qty is a non-negative integer.
  // Skips rows with empty name or non-finite qty.
  function extractVolumeRows(grid, mapping) {
    const headerRows = mapping.headerRows != null ? mapping.headerRows : 1;
    const nameCol = mapping.name;
    const packCol = mapping.pack != null ? mapping.pack : null;
    const qtyCol = mapping.qty;

    const result = [];
    for (let r = headerRows; r < grid.length; r++) {
      const row = grid[r] || [];
      const name = nameCol !== null ? String(row[nameCol] || '').trim() : '';
      if (!name) continue;

      const pack = packCol !== null ? String(row[packCol] || '').trim() : '';

      let rawQty = '';
      if (qtyCol !== null) rawQty = String(row[qtyCol] || '').trim();

      const n = Number(rawQty.replace(/[,\s]/g, ''));
      if (!Number.isFinite(n)) continue;

      const qty = Math.max(0, Math.round(n));

      result.push({ name, pack, qty });
    }
    return result;
  }

  // ── normaliseName ─────────────────────────────────────────────────────────────
  // Returns a canonical token string for fuzzy matching.
  const SYNONYMS = [
    // Must be ordered longest-first within each group so replacements don't
    // partially collide (e.g. 'tablets' before 'tab').
    [/\boral\s+sol(?:ution|n)\b/g, 'soln'],
    [/\bsugar[\s-]free\b/g, 'sf'],
    [/\btablets?\b/g, 'tab'],
    [/\bcaps(?:ules?)?\b/g, 'cap'],
    [/\bmicrograms?\b/gi, 'mcg'],
    [/\bm(?:illi)?litres?\b/gi, 'ml'],
    [/\bmilligrams?\b/gi, 'mg'],
    [/\boral\s+soln\b/g, 'soln'], // catches 'soln' that wasn't preceded by 'oral '
    [/\btabs?\b/g, 'tab'],
    [/\bug\b/g, 'mcg'],
    [/\bsf\b/g, 'sf'],
  ];

  function normaliseName(s) {
    let t = String(s || '').toLowerCase();
    // Apply synonym replacements
    for (const [re, rep] of SYNONYMS) {
      t = t.replace(re, rep);
    }
    // Attach digits to immediately following quantity units ('20 mg' -> '20mg').
    // Only quantity units (mg, mcg, ml, g) — NOT form descriptors (tab, cap)
    // so that '28 tablets' -> '28 tab' stays as two tokens, not '28tab'.
    t = t.replace(/(\d)\s+(mcg|mg|ml|g)\b/g, '$1$2');
    // Strip punctuation except hyphens between alphanumeric (keep '20mg', drop '.')
    t = t.replace(/[^\w\s]/g, ' ');
    // Collapse whitespace
    t = t.replace(/\s+/g, ' ').trim();
    return t;
  }

  // ── matchRows ─────────────────────────────────────────────────────────────────
  // products: array of { id, name, pack }
  // rows: array of { name, pack, price }
  // Returns [{ productId, row, confidence }], at most one per product.
  const { parsePackQty } = E;

  function tokenSet(s) {
    return new Set(s.split(/\s+/).filter(Boolean));
  }

  function jaccardOverlap(a, b) {
    const setA = tokenSet(a);
    const setB = tokenSet(b);
    let inter = 0;
    for (const t of setA) if (setB.has(t)) inter++;
    const union = setA.size + setB.size - inter;
    return union === 0 ? 0 : inter / union;
  }

  function allTokensContained(shorter, longer) {
    const shortSet = tokenSet(shorter);
    const longSet = tokenSet(longer);
    for (const t of shortSet) if (!longSet.has(t)) return false;
    return true;
  }

  const CONF_RANK = { exact: 3, strong: 2, weak: 1 };

  function matchRows(products, rows) {
    const proposals = [];

    for (const product of products) {
      const pNorm = normaliseName((product.name || '') + ' ' + (product.pack || ''));
      const pNameNorm = normaliseName(product.name || '');
      const pPackQty = parsePackQty(product.pack);

      let best = null;

      for (const row of rows) {
        const rNorm = normaliseName((row.name || '') + ' ' + (row.pack || ''));
        const rNameNorm = normaliseName(row.name || '');
        const rPackQty = parsePackQty(row.pack);
        const packMatch = pPackQty !== null && rPackQty !== null && pPackQty === rPackQty;

        let confidence = null;

        // exact: normalised full strings match OR names match and pack qty match
        if (pNorm === rNorm) {
          confidence = 'exact';
        } else if (pNameNorm === rNameNorm && packMatch) {
          confidence = 'exact';
        } else {
          // strong: all tokens of shorter name-set contained in longer AND pack qty matches
          const shorterName = pNameNorm.length <= rNameNorm.length ? pNameNorm : rNameNorm;
          const longerName = pNameNorm.length <= rNameNorm.length ? rNameNorm : pNameNorm;
          if (packMatch && allTokensContained(shorterName, longerName)) {
            confidence = 'strong';
          } else {
            // weak: >= 60% Jaccard token overlap on full normalised string
            const j = jaccardOverlap(pNorm, rNorm);
            if (j >= 0.6) confidence = 'weak';
          }
        }

        if (!confidence) continue;

        if (
          best === null ||
          CONF_RANK[confidence] > CONF_RANK[best.confidence] ||
          (CONF_RANK[confidence] === CONF_RANK[best.confidence] &&
            packMatch &&
            !best._packMatch)
        ) {
          best = { productId: product.id, row, confidence, _packMatch: packMatch };
        }
      }

      if (best) {
        proposals.push({ productId: best.productId, row: best.row, confidence: best.confidence });
      }
    }

    return proposals;
  }

  // ── parseConcessions ─────────────────────────────────────────────────────────
  // Accepts CSV (with headers) or pasted text lines.
  // Returns { rows: [{ name, pack, price }], skipped: string[] }
  function parseConcessions(text) {
    const lines = String(text || '').split(/\r?\n/);
    const rows = [];
    const skipped = [];

    // Detect CSV with column headers: first non-blank line must have commas AND
    // at least one field that looks like a column header (not a drug name).
    const firstNonBlank = lines.find((l) => l.trim() !== '');
    if (!firstNonBlank) return { rows, skipped };

    const commaCount = (firstNonBlank.match(/,/g) || []).length;
    const headerKeywords = ['medicine', 'drug', 'name', 'description', 'pack', 'size',
      'quantity', 'qty', 'price', 'tariff', 'basic', 'concession'];
    const firstFields = firstNonBlank.split(',').map((f) => f.trim().toLowerCase());
    const hasHeaderKeyword = firstFields.some((f) => headerKeywords.some((k) => f === k || f.startsWith(k)));
    const isCsv = commaCount >= 1 && hasHeaderKeyword;

    if (isCsv) {
      // Parse as CSV grid
      const grid = splitCsvRows(text);
      if (grid.length === 0) return { rows, skipped };

      const headerRow = grid[0];
      const mapping = detectColumns(headerRow, 'concession');

      // Check pence from values
      const pence = mapping.pence || detectPenceFromValues(grid, mapping.price, 1);

      if (mapping.name === null && mapping.price === null) {
        // No usable columns detected — try headerless path on each row
        for (let i = 1; i < grid.length; i++) {
          const row = grid[i];
          const joined = row.join(',');
          if (!joined.trim()) continue;
          const parsed = parseFreeTextLine(row.join(', '));
          if (parsed) rows.push(parsed);
          else skipped.push(joined);
        }
        return { rows, skipped };
      }

      const extracted = extractRows(grid, {
        name: mapping.name,
        pack: mapping.pack,
        price: mapping.price,
        pence,
        headerRows: 1,
      });
      return { rows: extracted, skipped };
    }

    // Free-text / pasted lines
    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = parseFreeTextLine(line);
      if (parsed) {
        rows.push(parsed);
      } else {
        skipped.push(line);
      }
    }
    return { rows, skipped };
  }

  // Parse a free-text concession line. Common formats:
  //   'Drug name strength form, pack size, £price'
  //   'Drug name strength form\tpack size\t£price'
  //   'Drug name strength form   pack size   £price'
  // Also tolerates 'per pack' suffix and bare numeric prices.
  function parseFreeTextLine(line) {
    const s = line.trim();
    if (!s) return null;

    // Split by comma, tab, or 2+ spaces
    let parts;
    if (s.includes(',')) {
      parts = s.split(',').map((p) => p.trim());
    } else if (s.includes('\t')) {
      parts = s.split('\t').map((p) => p.trim());
    } else {
      // Split on 2+ spaces
      parts = s.split(/\s{2,}/).map((p) => p.trim());
    }

    parts = parts.filter((p) => p !== '');

    if (parts.length < 2) return null;

    // Find the price part — it contains £ or looks like a number, possibly with 'per pack'
    let priceStr = null;
    let priceIdx = -1;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i].replace(/\s*per\s+pack\s*$/i, '').trim();
      const n = Number(p.replace(/[£\s]/g, ''));
      if (Number.isFinite(n) && n > 0) {
        priceStr = p;
        priceIdx = i;
        break;
      }
    }

    if (priceStr === null || priceIdx < 1) return null;

    const price = Number(priceStr.replace(/[£\s]/g, ''));
    if (!Number.isFinite(price) || price <= 0) return null;

    // Name is part 0; pack is parts between name and price, or just the part before price
    const name = parts[0];
    const pack = priceIdx >= 2 ? parts.slice(1, priceIdx).join(' ') : (priceIdx === 1 ? '' : parts[1]);

    if (!name) return null;

    return { name, pack, price };
  }

  return {
    parseXlsx,
    gridFromCsv,
    detectColumns,
    extractRows,
    extractVolumeRows,
    normaliseName,
    matchRows,
    parseConcessions,
  };
});
