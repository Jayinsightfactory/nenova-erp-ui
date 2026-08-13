import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const XLSX = require('xlsx');

const repoRoot = process.cwd();
const workbookPath = path.resolve(repoRoot, '.verify/inputs/profit-report-week-28.xlsx');
const expectedPath = path.join(repoRoot, '.verify', 'inputs', 'profit-report-week-28.xlsx');

if (workbookPath !== expectedPath) {
  throw new Error(`검사 입력 경로가 허용 범위를 벗어났습니다: ${workbookPath}`);
}

const bytes = fs.readFileSync(workbookPath);
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sourceSha256 = hash(bytes);
const zip = await JSZip.loadAsync(bytes);
const workbook = XLSX.read(bytes, {
  type: 'buffer',
  cellFormula: true,
  cellNF: true,
  cellStyles: true,
  cellDates: true,
  bookDeps: true,
  bookFiles: true,
});

const cellEntries = (sheet) => Object.entries(sheet).filter(([address]) => !address.startsWith('!'));
const errorText = (cell) => cell?.w || (cell?.t === 'e' ? String(cell.v) : null);
const serializeValue = (value) => value instanceof Date ? value.toISOString() : value;
const cellRecord = (sheetName, address, cell) => ({
  sheet: sheetName,
  address,
  type: cell?.t ?? null,
  value: serializeValue(cell?.v),
  display: cell?.w ?? null,
  formula: cell?.f ?? null,
  error: cell?.t === 'e' ? errorText(cell) : null,
});

const formulaInventory = [];
const errorCells = [];
const brokenReferenceFormulas = [];
const externalReferenceFormulas = [];
const sheetSummaries = [];

for (const sheetName of workbook.SheetNames) {
  const sheet = workbook.Sheets[sheetName];
  let formulaCount = 0;
  let blankFormulaCacheCount = 0;
  let formulaErrorCount = 0;
  const entries = cellEntries(sheet);

  for (const [address, cell] of entries) {
    if (cell.f != null) {
      formulaCount += 1;
      const record = cellRecord(sheetName, address, cell);
      formulaInventory.push(record);
      if (cell.v == null && cell.w == null) blankFormulaCacheCount += 1;
      if (cell.t === 'e') formulaErrorCount += 1;
      if (String(cell.f).includes('#REF!')) brokenReferenceFormulas.push(record);
      if (/\[[^\]]+\]/.test(String(cell.f))) externalReferenceFormulas.push(record);
    }
    if (cell.t === 'e') errorCells.push(cellRecord(sheetName, address, cell));
  }

  const meta = workbook.Workbook?.Sheets?.find((item) => item.name === sheetName);
  sheetSummaries.push({
    name: sheetName,
    state: meta?.Hidden === 2 ? 'veryHidden' : meta?.Hidden === 1 ? 'hidden' : 'visible',
    usedRange: sheet['!ref'] || null,
    populatedOrStyledCells: entries.length,
    formulaCount,
    formulaErrorCount,
    blankFormulaCacheCount,
  });
}

const canonicalFormulas = formulaInventory
  .map(({ sheet, address, formula, type, value }) => `${sheet}!${address}\t${formula}\t${type}\t${String(value ?? '')}`)
  .sort();

const zipNames = Object.keys(zip.files).sort();
const externalPackageEntries = zipNames.filter((name) =>
  /(^|\/)externalLinks\//i.test(name) || /(^|\/)(connections|queryTables)\//i.test(name),
);
const relationshipXmlEntries = zipNames.filter((name) => name.endsWith('.rels'));
const externalRelationships = [];
for (const entryName of relationshipXmlEntries) {
  const xml = await zip.file(entryName)?.async('string');
  if (!xml) continue;
  for (const match of xml.matchAll(/<Relationship\b[^>]*Target="([^"]+)"[^>]*(?:TargetMode="External")[^>]*\/?\s*>/gi)) {
    externalRelationships.push({ entry: entryName, target: match[1] });
  }
  for (const match of xml.matchAll(/<Relationship\b[^>]*(?:TargetMode="External")[^>]*Target="([^"]+)"[^>]*\/?\s*>/gi)) {
    externalRelationships.push({ entry: entryName, target: match[1] });
  }
}

const workbookXml = await zip.file('xl/workbook.xml')?.async('string') || '';
const calcPr = workbookXml.match(/<calcPr\b([^>]*)\/?\s*>/i)?.[1] || '';
const calcAttr = (name) => calcPr.match(new RegExp(`${name}="([^"]+)"`, 'i'))?.[1] ?? null;
const calcChainXml = await zip.file('xl/calcChain.xml')?.async('string') || '';
const calcChainCount = (calcChainXml.match(/<c\b/g) || []).length;

function stripDoubleQuotedStrings(formula) {
  return formula.replace(/"(?:[^"]|"")*"/g, (text) => ' '.repeat(text.length));
}

function parseFormulaReferences(formula, defaultSheet) {
  const refs = [];
  const masked = [...stripDoubleQuotedStrings(String(formula || ''))];
  const crossSheet = /(?:'((?:[^']|'')+)'|([^\s'!()+\-*/,:]+))!\$?([A-Z]{1,3})(?:\$?(\d+))?(?::\$?([A-Z]{1,3})(?:\$?(\d+))?)?/g;
  for (const match of stripDoubleQuotedStrings(String(formula || '')).matchAll(crossSheet)) {
    const sheet = (match[1] || match[2]).replace(/''/g, "'");
    const start = `${match[3]}${match[4] || ''}`;
    const end = match[5] ? `${match[5]}${match[6] || ''}` : null;
    refs.push({ sheet, range: end ? `${start}:${end}` : start, fullColumn: !match[4] || (match[5] && !match[6]) });
    for (let i = match.index; i < match.index + match[0].length; i += 1) masked[i] = ' ';
  }

  const local = /(?<![A-Za-z0-9_!'])\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?/g;
  for (const match of masked.join('').matchAll(local)) {
    const start = `${match[1]}${match[2]}`;
    const end = match[3] ? `${match[3]}${match[4]}` : null;
    refs.push({ sheet: defaultSheet, range: end ? `${start}:${end}` : start, fullColumn: false });
  }

  return [...new Map(refs.map((ref) => [`${ref.sheet}!${ref.range}`, ref])).values()];
}

function expandReference(ref, maxCells = 500) {
  if (ref.fullColumn || !/^[A-Z]+\d+(?::[A-Z]+\d+)?$/.test(ref.range)) return null;
  const decoded = XLSX.utils.decode_range(ref.range);
  const size = (decoded.e.r - decoded.s.r + 1) * (decoded.e.c - decoded.s.c + 1);
  if (size > maxCells) return null;
  const addresses = [];
  for (let row = decoded.s.r; row <= decoded.e.r; row += 1) {
    for (let col = decoded.s.c; col <= decoded.e.c; col += 1) {
      addresses.push(XLSX.utils.encode_cell({ r: row, c: col }));
    }
  }
  return addresses;
}

function traceRoot(sheetName, address) {
  const rootKey = `${sheetName}!${address}`;
  const seen = new Set();
  const formulaNodes = [];
  const terminalRanges = [];
  const terminalValueCounts = {};
  const missingReferences = [];

  function visit(currentSheet, currentAddress, depth) {
    const key = `${currentSheet}!${currentAddress}`;
    if (seen.has(key) || depth > 12) return;
    seen.add(key);
    const sheet = workbook.Sheets[currentSheet];
    if (!sheet) {
      missingReferences.push({ sheet: currentSheet, range: currentAddress, reason: 'sheet_missing' });
      return;
    }
    const cell = sheet[currentAddress];
    if (!cell) {
      terminalValueCounts[currentSheet] = (terminalValueCounts[currentSheet] || 0) + 1;
      return;
    }
    if (!cell.f) {
      terminalValueCounts[currentSheet] = (terminalValueCounts[currentSheet] || 0) + 1;
      return;
    }

    const refs = parseFormulaReferences(cell.f, currentSheet);
    formulaNodes.push({
      key,
      formula: cell.f,
      cachedType: cell.t ?? null,
      cachedValue: serializeValue(cell.v),
      references: refs.map((ref) => `${ref.sheet}!${ref.range}`),
    });
    for (const ref of refs) {
      const expanded = expandReference(ref);
      if (!expanded) {
        terminalRanges.push({ sheet: ref.sheet, range: ref.range, reason: ref.fullColumn ? 'full_column' : 'range_too_large_or_non_cell' });
        continue;
      }
      for (const nextAddress of expanded) visit(ref.sheet, nextAddress, depth + 1);
    }
  }

  visit(sheetName, address, 0);
  const rootCell = workbook.Sheets[sheetName]?.[address];
  const traceCanonical = formulaNodes
    .map((node) => `${node.key}\t${node.formula}\t${node.references.join(',')}`)
    .sort()
    .join('\n');
  return {
    root: cellRecord(sheetName, address, rootCell),
    status: rootCell?.f ? 'formula' : rootCell?.v != null ? 'hardcoded_no_formula' : 'blank_no_formula',
    visitedCellCount: seen.size,
    formulaNodeCount: formulaNodes.length,
    formulaSheets: [...new Set(formulaNodes.map((node) => node.key.split('!')[0]))].sort(),
    formulaNodes,
    terminalRanges: [...new Map(terminalRanges.map((ref) => [`${ref.sheet}!${ref.range}`, ref])).values()],
    terminalValueCounts,
    missingReferences,
    traceSha256: hash(traceCanonical),
  };
}

const reportSheet = '주차별 매출이익 보고서';
const inventoryLineage = [];
for (const column of ['E', 'F']) {
  for (let row = 7; row <= 23; row += 1) inventoryLineage.push(traceRoot(reportSheet, `${column}${row}`));
}

const inventorySourceSummary = {
  opening: inventoryLineage
    .filter((trace) => trace.root.address.startsWith('E'))
    .map((trace) => ({ address: trace.root.address, value: trace.root.value, formula: trace.root.formula, status: trace.status })),
  closing: inventoryLineage
    .filter((trace) => trace.root.address.startsWith('F'))
    .map((trace) => ({ address: trace.root.address, value: trace.root.value, formula: trace.root.formula, status: trace.status })),
};

const sourceSha256After = hash(fs.readFileSync(workbookPath));
const report = {
  input: {
    path: workbookPath,
    bytes: bytes.length,
    sha256Before: sourceSha256,
    sha256After: sourceSha256After,
    unchanged: sourceSha256 === sourceSha256After,
  },
  workbook: {
    sheetCount: workbook.SheetNames.length,
    sheets: sheetSummaries,
    formulaCount: formulaInventory.length,
    formulaInventorySha256: hash(canonicalFormulas.join('\n')),
    formulaErrorCount: formulaInventory.filter((cell) => cell.error).length,
    errorCellCount: errorCells.length,
    errorCells,
    brokenReferenceFormulaCount: brokenReferenceFormulas.length,
    brokenReferenceFormulas,
    blankFormulaCacheCount: sheetSummaries.reduce((sum, sheet) => sum + sheet.blankFormulaCacheCount, 0),
    calculation: {
      calcId: calcAttr('calcId'),
      calcMode: calcAttr('calcMode'),
      fullCalcOnLoad: calcAttr('fullCalcOnLoad'),
      forceFullCalc: calcAttr('forceFullCalc'),
      calcChainPresent: Boolean(calcChainXml),
      calcChainCellCount: calcChainCount,
    },
    externalReferences: {
      packageEntries: externalPackageEntries,
      relationships: externalRelationships,
      formulaCount: externalReferenceFormulas.length,
      formulas: externalReferenceFormulas,
      present: externalPackageEntries.length > 0 || externalRelationships.length > 0 || externalReferenceFormulas.length > 0,
    },
  },
  inventoryColumns: {
    sourceSummary: inventorySourceSummary,
    lineage: inventoryLineage,
  },
};

console.log(JSON.stringify(report, null, 2));
