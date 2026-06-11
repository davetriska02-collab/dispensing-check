/* Dispensing Check — importers tests. Run: node test/importers.test.js */
'use strict';
const I = require('../importers.js');

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
const approx = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

// ── Minimal ZIP builder (for XLSX fixture) ────────────────────────────────────
// Builds a valid ZIP with STORED (method 0) or DEFLATED (method 8) entries.
// Returns a Buffer / Uint8Array suitable for parseXlsx.

function writeUint16LE(buf, offset, val) {
  buf[offset] = val & 0xff;
  buf[offset + 1] = (val >> 8) & 0xff;
}
function writeUint32LE(buf, offset, val) {
  buf[offset] = val & 0xff;
  buf[offset + 1] = (val >> 8) & 0xff;
  buf[offset + 2] = (val >> 16) & 0xff;
  buf[offset + 3] = (val >> 24) & 0xff;
}

function crc32(data) {
  // CRC-32 for ZIP
  const table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(files) {
  // files: [{ name: string, data: Uint8Array, method: 0|8 }]
  // Returns Uint8Array of the ZIP
  const localHeaders = [];
  let offset = 0;

  // First pass: build local headers + data
  for (const f of files) {
    const nameBytes = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.method === 0 ? f.data : f.originalData || f.data);
    const uncompressedSize = (f.method === 0 ? f.data.length : (f.originalData || f.data).length);
    const compressedSize = f.data.length;

    const lh = Buffer.alloc(30 + nameBytes.length);
    writeUint32LE(lh, 0, 0x04034b50); // local file header sig
    writeUint16LE(lh, 4, 20);          // version needed
    writeUint16LE(lh, 6, 0);           // flags
    writeUint16LE(lh, 8, f.method);    // compression method
    writeUint16LE(lh, 10, 0);          // mod time
    writeUint16LE(lh, 12, 0);          // mod date
    writeUint32LE(lh, 14, crc);        // crc-32
    writeUint32LE(lh, 18, compressedSize);
    writeUint32LE(lh, 22, uncompressedSize);
    writeUint16LE(lh, 26, nameBytes.length);
    writeUint16LE(lh, 28, 0);          // extra field length
    nameBytes.copy(lh, 30);

    localHeaders.push({ nameBytes, lh, data: f.data, crc, uncompressedSize, compressedSize, offset, method: f.method });
    offset += lh.length + f.data.length;
  }

  const cdOffset = offset;

  // Central directory
  const cdParts = [];
  for (const e of localHeaders) {
    const cd = Buffer.alloc(46 + e.nameBytes.length);
    writeUint32LE(cd, 0, 0x02014b50); // central dir sig
    writeUint16LE(cd, 4, 20);          // version made by
    writeUint16LE(cd, 6, 20);          // version needed
    writeUint16LE(cd, 8, 0);           // flags
    writeUint16LE(cd, 10, e.method);   // compression method
    writeUint16LE(cd, 12, 0);          // mod time
    writeUint16LE(cd, 14, 0);          // mod date
    writeUint32LE(cd, 16, e.crc);
    writeUint32LE(cd, 20, e.compressedSize);
    writeUint32LE(cd, 24, e.uncompressedSize);
    writeUint16LE(cd, 28, e.nameBytes.length);
    writeUint16LE(cd, 30, 0);          // extra field length
    writeUint16LE(cd, 32, 0);          // file comment length
    writeUint16LE(cd, 34, 0);          // disk number start
    writeUint16LE(cd, 36, 0);          // internal attributes
    writeUint32LE(cd, 38, 0);          // external attributes
    writeUint32LE(cd, 42, e.offset);   // relative offset of local header
    e.nameBytes.copy(cd, 46);
    cdParts.push(cd);
  }

  const cdBuf = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  writeUint32LE(eocd, 0, 0x06054b50); // EOCD sig
  writeUint16LE(eocd, 4, 0);           // disk number
  writeUint16LE(eocd, 6, 0);           // disk with CD
  writeUint16LE(eocd, 8, localHeaders.length);  // entries on disk
  writeUint16LE(eocd, 10, localHeaders.length); // total entries
  writeUint32LE(eocd, 12, cdBuf.length);
  writeUint32LE(eocd, 16, cdOffset);
  writeUint16LE(eocd, 20, 0);          // comment length

  const parts = [];
  for (const e of localHeaders) {
    parts.push(e.lh);
    parts.push(Buffer.from(e.data));
  }
  parts.push(cdBuf);
  parts.push(eocd);

  return Buffer.concat(parts);
}

function strToUint8(s) {
  return new Uint8Array(Buffer.from(s, 'utf8'));
}

// Convert a Node Buffer (which may be a slice of a pooled ArrayBuffer)
// to a standalone ArrayBuffer suitable for parseXlsx.
function bufToArrayBuffer(buf) {
  const ab = new ArrayBuffer(buf.length);
  const view = new Uint8Array(ab);
  for (let i = 0; i < buf.length; i++) view[i] = buf[i];
  return ab;
}

// ── Build a minimal XLSX fixture ─────────────────────────────────────────────
// Cells:
//   A1: shared string 0 -> "Medicine"     (type s)
//   B1: shared string 1 -> "Hello & World" (shared string with entity)
//   C1: inline string "InlineCell"
//   A2: numeric 42.5
//   B2: shared string 2 -> "SharedVal"

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`;

const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">
  <si><t>Medicine</t></si>
  <si><t>Hello &amp; World</t></si>
  <si><t>SharedVal</t></si>
</sst>`;

const sheet1Xml = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
      <c r="C1" t="inlineStr"><is><t>InlineCell</t></is></c>
    </row>
    <row r="2">
      <c r="A2"><v>42.5</v></c>
      <c r="B2" t="s"><v>2</v></c>
    </row>
  </sheetData>
</worksheet>`;

const storedXlsx = buildZip([
  { name: '[Content_Types].xml', data: strToUint8(contentTypesXml), method: 0 },
  { name: 'xl/sharedStrings.xml', data: strToUint8(sharedStringsXml), method: 0 },
  { name: 'xl/worksheets/sheet1.xml', data: strToUint8(sheet1Xml), method: 0 },
]);

// ── XLSX tests ────────────────────────────────────────────────────────────────
(async () => {
  // Test STORED entries
  const grid = await I.parseXlsx(bufToArrayBuffer(storedXlsx));
  check(Array.isArray(grid) && grid.length === 2, 'parseXlsx STORED: returns 2 rows');
  check(grid[0][0] === 'Medicine', 'parseXlsx STORED: A1 shared string');
  check(grid[0][1] === 'Hello & World', 'parseXlsx STORED: B1 shared string with entity decode (&amp;)');
  check(grid[0][2] === 'InlineCell', 'parseXlsx STORED: C1 inline string');
  check(grid[1][0] === '42.5', 'parseXlsx STORED: A2 numeric cell');
  check(grid[1][1] === 'SharedVal', 'parseXlsx STORED: B2 shared string');

  // Test DEFLATE (method 8) entries if DecompressionStream is available
  const hasDecomp = typeof DecompressionStream !== 'undefined';
  check(hasDecomp, 'DecompressionStream available in this Node');

  if (hasDecomp) {
    const zlib = require('zlib');
    const deflatedSheet = zlib.deflateRawSync(Buffer.from(sheet1Xml, 'utf8'));
    const deflatedSS = zlib.deflateRawSync(Buffer.from(sharedStringsXml, 'utf8'));
    const deflatedCT = zlib.deflateRawSync(Buffer.from(contentTypesXml, 'utf8'));

    const deflatedXlsx = buildZip([
      {
        name: '[Content_Types].xml',
        data: deflatedCT,
        originalData: strToUint8(contentTypesXml),
        method: 8,
      },
      {
        name: 'xl/sharedStrings.xml',
        data: deflatedSS,
        originalData: strToUint8(sharedStringsXml),
        method: 8,
      },
      {
        name: 'xl/worksheets/sheet1.xml',
        data: deflatedSheet,
        originalData: strToUint8(sheet1Xml),
        method: 8,
      },
    ]);
    const grid8 = await I.parseXlsx(bufToArrayBuffer(deflatedXlsx));
    check(Array.isArray(grid8) && grid8.length === 2, 'parseXlsx DEFLATE: returns 2 rows');
    check(grid8[0][0] === 'Medicine', 'parseXlsx DEFLATE: A1 shared string');
    check(grid8[0][1] === 'Hello & World', 'parseXlsx DEFLATE: B1 entity decoded');
    check(grid8[0][2] === 'InlineCell', 'parseXlsx DEFLATE: C1 inline string');
    check(grid8[1][0] === '42.5', 'parseXlsx DEFLATE: A2 numeric cell');
    check(grid8[1][1] === 'SharedVal', 'parseXlsx DEFLATE: B2 shared string');
  }

  // ── gridFromCsv ──────────────────────────────────────────────────────────────
  const csvText = 'a,b,c\n1,2,3\n"x,y",z,';
  const csvGrid = I.gridFromCsv(csvText);
  check(csvGrid.length === 3, 'gridFromCsv: 3 rows');
  check(csvGrid[0][0] === 'a' && csvGrid[0][2] === 'c', 'gridFromCsv: header row parsed');
  check(csvGrid[1][1] === '2', 'gridFromCsv: numeric cell');
  check(csvGrid[2][0] === 'x,y', 'gridFromCsv: quoted field with comma');

  // ── detectColumns — tariff kind ───────────────────────────────────────────────
  const tariffHeaders = ['Medicine', 'Pack Size', 'Basic Price (p)'];
  const colMap = I.detectColumns(tariffHeaders, 'tariff');
  check(colMap.name === 0, 'detectColumns tariff: name col found (Medicine)');
  check(colMap.pack === 1, 'detectColumns tariff: pack col found (Pack Size)');
  check(colMap.price === 2, 'detectColumns tariff: price col found (Basic Price (p))');
  check(colMap.pence === true, 'detectColumns tariff: pence true when header contains (p)');

  // detectColumns with 'pence' in header
  const penceHeaders = ['Drug Name', 'Pack', 'Price in pence'];
  const colMap2 = I.detectColumns(penceHeaders, 'tariff');
  check(colMap2.pence === true, 'detectColumns: pence true when header contains pence');

  // detectColumns with generic price header (no pence flag from header)
  const genericHeaders = ['Name', 'Quantity', 'Price'];
  const colMap3 = I.detectColumns(genericHeaders, 'tariff');
  check(colMap3.name === 0 && colMap3.price === 2, 'detectColumns: name and price found generically');
  check(colMap3.pence === false, 'detectColumns: pence false when no (p) or pence in header');

  // ── extractRows — pence conversion ───────────────────────────────────────────
  const tariffGrid = [
    ['Medicine', 'Pack Size', 'Basic Price (p)'],
    ['Amoxicillin 250mg', '21', '89'],
    ['Ibuprofen 400mg', '84', '182'],
    ['Bad Row', 'none', 'abc'],
    ['', '28', '100'],   // empty name — should be skipped
  ];
  const tariffMapping = { name: 0, pack: 1, price: 2, pence: true, headerRows: 1 };
  const extracted = I.extractRows(tariffGrid, tariffMapping);
  check(extracted.length === 2, 'extractRows: 2 valid rows (skips non-numeric price and empty name)');
  check(extracted[0].name === 'Amoxicillin 250mg', 'extractRows: name correct');
  check(extracted[0].pack === '21', 'extractRows: pack correct');
  check(approx(extracted[0].price, 0.89), 'extractRows: pence converted to pounds (89p -> £0.89)');
  check(approx(extracted[1].price, 1.82), 'extractRows: pence converted to pounds (182p -> £1.82)');

  // extractRows without pence flag (pounds)
  const poundsGrid = [
    ['Name', 'Pack', 'Price'],
    ['Metformin 500mg', '28', '1.50'],
  ];
  const poundsMapping = { name: 0, pack: 1, price: 2, pence: false, headerRows: 1 };
  const poundsExtracted = I.extractRows(poundsGrid, poundsMapping);
  check(poundsExtracted.length === 1 && approx(poundsExtracted[0].price, 1.50), 'extractRows: pounds passed through unchanged');

  // extractRows: auto-detect pence from large integer values
  const autoGrid = [
    ['Name', 'Pack', 'Price'],
    ['Drug A', '28', '850'],
    ['Drug B', '56', '1200'],
  ];
  const autoExtracted = I.extractRows(autoGrid, { name: 0, pack: 1, price: 2, pence: false, headerRows: 1 });
  // median is 1025 > 500 and all integers: auto-detect pence
  check(approx(autoExtracted[0].price, 8.50), 'extractRows: auto-detect pence when values are large integers');

  // ── normaliseName ─────────────────────────────────────────────────────────────
  check(
    I.normaliseName('Atorvastatin 20 mg Tablets') === I.normaliseName('atorvastatin 20mg tablets'),
    'normaliseName: case-insensitive, space before unit collapsed'
  );
  check(
    I.normaliseName('Atorvastatin 20 mg Tablets').includes('tab'),
    'normaliseName: tablets -> tab'
  );
  check(
    !I.normaliseName('Atorvastatin 20 mg Tablets').includes('tablet'),
    'normaliseName: tablets fully replaced'
  );
  check(
    I.normaliseName('Salbutamol 100 micrograms Inhaler').includes('100mcg'),
    'normaliseName: micrograms -> mcg and digit attached'
  );
  check(
    I.normaliseName('Salbutamol 100 ug Inhaler').includes('100mcg'),
    'normaliseName: ug -> mcg'
  );
  check(
    I.normaliseName('Sugar Free Oral Solution 5ml').includes('sf'),
    'normaliseName: sugar free -> sf'
  );
  check(
    I.normaliseName('Amoxicillin Capsules 250mg').includes('cap'),
    'normaliseName: capsules -> cap'
  );
  check(
    I.normaliseName('Ibuprofen 200 mg Oral Solution').includes('soln'),
    'normaliseName: oral solution -> soln'
  );
  check(
    I.normaliseName('Metformin 500 mg Tablets 28').includes('500mg'),
    'normaliseName: mg digit attached'
  );
  check(
    I.normaliseName('Ondansetron 4 mg Tabs 10').includes('tab'),
    'normaliseName: tabs -> tab'
  );

  // ── matchRows ─────────────────────────────────────────────────────────────────
  const products = [
    { id: 'p1', name: 'Atorvastatin 20mg', pack: '28 tablets' },
    { id: 'p2', name: 'Metformin 500mg', pack: '28 tablets' },
    { id: 'p3', name: 'Amoxicillin 250mg', pack: '21 capsules' },
    { id: 'p4', name: 'Obscure Drug 99mg', pack: '7 tablets' },
  ];

  // Exact match: normalised name+pack strings match
  const exactRows = [
    { name: 'Atorvastatin 20 mg', pack: '28 Tablets', price: 1.43 },
  ];
  const exactProposals = I.matchRows([products[0]], exactRows);
  check(exactProposals.length === 1, 'matchRows: exact match found');
  check(exactProposals[0].confidence === 'exact', 'matchRows: exact confidence');
  check(exactProposals[0].productId === 'p1', 'matchRows: correct productId');

  // Exact match by name equality + matching pack qty
  const exactQtyRows = [
    { name: 'Metformin 500mg Tablets', pack: '28', price: 1.50 },
  ];
  const exactQtyProposals = I.matchRows([products[1]], exactQtyRows);
  check(exactQtyProposals.length >= 1, 'matchRows: exact/strong match with matching pack qty');
  check(['exact', 'strong'].includes(exactQtyProposals[0].confidence), 'matchRows: confidence is exact or strong for pack-qty match');

  // Strong match: all tokens of shorter name in longer, pack qty matches
  const strongRows = [
    { name: 'Amoxicillin 250 mg Capsules', pack: '21', price: 0.89 },
  ];
  const strongProposals = I.matchRows([products[2]], strongRows);
  check(strongProposals.length === 1, 'matchRows: strong match found');
  check(['exact', 'strong'].includes(strongProposals[0].confidence), 'matchRows: confidence is exact or strong');

  // Weak match: >= 60% Jaccard token overlap, different pack size (28 vs 56)
  // p: 'atorvastatin 20mg tab 28' (4 tokens)
  // r: 'atorvastatin 20mg tab 56' (4 tokens) — 3 in common, union=5, jaccard=0.6
  const weakRows = [
    { name: 'Atorvastatin 20mg tablets', pack: '56', price: 1.80 },
  ];
  const weakProposals = I.matchRows([products[0]], weakRows);
  check(weakProposals.length === 1, 'matchRows: weak match found');
  check(weakProposals[0].confidence === 'weak', 'matchRows: weak confidence');

  // Non-match: completely different drug
  const noMatchRows = [
    { name: 'Ramipril 5mg', pack: '28 tablets', price: 0.70 },
  ];
  const noMatchProposals = I.matchRows([products[3]], noMatchRows);
  check(noMatchProposals.length === 0, 'matchRows: no match below threshold');

  // At most one proposal per product (best wins)
  const multiRows = [
    { name: 'Atorvastatin 20mg Tablets', pack: '28', price: 1.40 }, // strong/exact
    { name: 'Atorvastatin 20 mg', pack: '28 tablets', price: 1.43 }, // exact
  ];
  const multiProposals = I.matchRows([products[0]], multiRows);
  check(multiProposals.length === 1, 'matchRows: at most one proposal per product');
  check(multiProposals[0].confidence === 'exact', 'matchRows: best (exact) proposal chosen when multiple candidates');

  // ── parseConcessions — CSV form ───────────────────────────────────────────────
  const concessionCsv = [
    'Drug Name,Pack Size,Concession Price',
    'Amlodipine 5mg tablets,28,1.45',
    'Metformin 500mg tablets,28,2.10',
    'junk line with no price,,',
    '',
  ].join('\n');
  const { rows: csvConRows, skipped: csvConSkipped } = I.parseConcessions(concessionCsv);
  check(csvConRows.length === 2, 'parseConcessions CSV: 2 valid rows');
  check(csvConRows[0].name === 'Amlodipine 5mg tablets', 'parseConcessions CSV: name correct');
  check(approx(csvConRows[0].price, 1.45), 'parseConcessions CSV: price correct');
  check(csvConRows[1].name === 'Metformin 500mg tablets', 'parseConcessions CSV: second row name');

  // ── parseConcessions — pasted lines form ─────────────────────────────────────
  const pastedText = [
    'Amlodipine 5mg tablets, 28, £1.45',
    'Metformin 500mg tablets, 28, £2.10 per pack',
    'this is junk',
    '',
    'Atorvastatin 20mg tablets, 28, £1.43',
  ].join('\n');
  const { rows: pastedRows, skipped: pastedSkipped } = I.parseConcessions(pastedText);
  check(pastedRows.length === 3, 'parseConcessions pasted: 3 valid rows');
  check(pastedRows[0].name === 'Amlodipine 5mg tablets', 'parseConcessions pasted: first row name');
  check(pastedRows[0].pack === '28', 'parseConcessions pasted: pack extracted');
  check(approx(pastedRows[0].price, 1.45), 'parseConcessions pasted: price stripped of £');
  check(approx(pastedRows[1].price, 2.10), 'parseConcessions pasted: per pack suffix ignored');
  check(pastedRows[2].name === 'Atorvastatin 20mg tablets', 'parseConcessions pasted: third row name');
  check(pastedSkipped.length >= 1, 'parseConcessions pasted: junk line counted as skipped');
  check(pastedSkipped.some((l) => l.includes('junk')), 'parseConcessions pasted: junk line in skipped array');

  // ── parseConcessions — tab-separated ─────────────────────────────────────────
  const tabText = 'Lisinopril 10mg\t28\t£0.95\nBad\t\t';
  const { rows: tabRows, skipped: tabSkipped } = I.parseConcessions(tabText);
  check(tabRows.length === 1, 'parseConcessions tab-separated: 1 valid row');
  check(tabRows[0].name === 'Lisinopril 10mg', 'parseConcessions tab: name correct');
  check(approx(tabRows[0].price, 0.95), 'parseConcessions tab: price correct');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
})();
