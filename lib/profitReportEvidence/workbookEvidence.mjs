import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { canonicalDigest, sha256 } from './canonical.mjs';
import { formulaFingerprint } from './formulaFingerprint.mjs';
import { provenanceDigestForCell } from './provenance.mjs';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const XLSX = require('xlsx');

export const MAIN_SHEET = '주차별 매출이익 보고서';
export const FORMULA_SPEC_FILE = 'formula-template.xlsx';
export const FORMULA_SPEC_SHA256 = '222484dc07e392ad88d52b7a0f9406c4e19b21af7de97500d176ed726b8234bb';
export const ANNOTATED_FORMULA_SPEC_SHA256 = '20696dd6725302549a6f913949d33b1c2b58d8b6bc3dc17d29c4d57e0e0d8ca4';
export const FORMULA_SPEC_SOURCES = Object.freeze({
  [FORMULA_SPEC_SHA256]: Object.freeze({ version: 1, kind: 'formula-and-product-catalog' }),
  [ANNOTATED_FORMULA_SPEC_SHA256]: Object.freeze({ version: 2, kind: 'formula-product-and-source-lineage' }),
});
export const FORMULA_SPEC_ROW = 7;
export const FORMULA_SPEC_COLUMNS = Object.freeze(['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U']);
export const FORMULA_SOURCE_ANNOTATION_CELLS = Object.freeze([
  Object.freeze({ sheet: '그외통관비', address: 'B2', text: 'AWB 서류에서 무게' }),
  Object.freeze({ sheet: '그외통관비', address: 'H2', text: '선율 청구서에서 관세 부분' }),
  Object.freeze({ sheet: '그외통관비', address: 'B17', text: '선율 청구서에서 검역수수료+통관수수료 공급가액' }),
  Object.freeze({ sheet: '그외통관비', address: 'H17', text: '1+2차 무게 합쳤을 때 운송비' }),
  Object.freeze({ sheet: '포워딩', address: 'F13', text: '네덜란드, 중국:' }),
  Object.freeze({ sheet: '포워딩', address: 'G13', text: '입고관리에 있는 운송료' }),
  Object.freeze({ sheet: '포워딩', address: 'F14', text: '콜수국:' }),
  Object.freeze({ sheet: '포워딩', address: 'G14', text: 'freightwise' }),
  Object.freeze({ sheet: '포워딩', address: 'F15', text: '에콰:' }),
  Object.freeze({ sheet: '포워딩', address: 'G15', text: 'freightwise ecuador' }),
  Object.freeze({ sheet: '포워딩', address: 'F16', text: '태국:' }),
  Object.freeze({ sheet: '포워딩', address: 'G16', text: 'excel' }),
  Object.freeze({ sheet: '콜롬비아 1차', address: 'E6', text: '← freightwise 운송료' }),
  Object.freeze({ sheet: '콜롬비아 1차', address: 'E9', text: '↓ awb 무게' }),
  Object.freeze({ sheet: '콜롬비아 1차', address: 'E13', text: '↑고정' }),
  Object.freeze({ sheet: '콜롬비아 1차', address: 'J29', text: 'awb 무게, 부피→' }),
  Object.freeze({ sheet: '콜롬비아 1차', address: 'I37', text: '스케줄 공유방에 있는 품목별 박스수량→' }),
]);
export const STANDARD_HELPER_SHEETS = Object.freeze([
  '재고잔량', '그외통관비', '구매현황', '포워딩', '판매현황', '불량차감', '그 외 매출액', '콜롬비아 1차', '콜롬비아 2차', '품목리스트',
]);
export const MAIN_GEOMETRY = Object.freeze({ range: 'B:U', headerRow: 6, firstItemRow: 7, lastItemRow: 22, totalRow: 23, noteCell: 'B25', ratioColumns: ['D', 'K', 'M', 'U'] });

const xmlDecode = text => String(text || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function attribute(source, name) {
  const match = String(source || '').match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return match ? xmlDecode(match[1]) : null;
}

async function workbookSheetPaths(zip) {
  const workbookXml = await zip.file('xl/workbook.xml').async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const rels = new Map();
  for (const match of relsXml.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)) {
    rels.set(attribute(match[1], 'Id'), attribute(match[1], 'Target'));
  }
  const sheets = [];
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/?\s*>/g)) {
    const attrs = match[1];
    const target = rels.get(attribute(attrs, 'r:id')) || '';
    const normalized = target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join('xl', target));
    sheets.push({ name: attribute(attrs, 'name'), state: attribute(attrs, 'state') || 'visible', path: normalized });
  }
  return { sheets, workbookXml };
}

function knownError(sheet, address) {
  return ['콜롬비아 1차', '콜롬비아 2차'].includes(sheet) && /^N2[1-4]$/.test(address);
}

function cellRole({ sheet, address, formula, type, value, rawValue }) {
  if (knownError(sheet, address)) return 'KNOWN_ERROR';
  if (formula) return 'FORMULA';
  if (value == null && rawValue == null) return 'EXPLICIT_BLANK';
  if (sheet === MAIN_SHEET && /^R(?:[7-9]|1\d|2[0-2])$/.test(address)) return 'MANUAL';
  if (typeof value === 'string' || type === 's' || type === 'str') return 'STATIC';
  return 'SOURCE';
}

function semanticFieldId(sheet, address, xlsxSheet) {
  if (sheet !== MAIN_SHEET) return `helper.${sheet}.${address}`;
  if (address === MAIN_GEOMETRY.noteCell) return 'report.note';
  const match = address.match(/^([A-Z]+)(\d+)$/);
  if (!match) return `report.cell.${address}`;
  const row = Number(match[2]);
  if (row === MAIN_GEOMETRY.totalRow) return `report.total.${match[1]}`;
  if (row >= MAIN_GEOMETRY.firstItemRow && row <= MAIN_GEOMETRY.lastItemRow) {
    const category = String(xlsxSheet?.[`B${row}`]?.v || `row-${row}`).trim();
    return `report.category.${category}.${match[1]}`;
  }
  return `report.cell.${address}`;
}

function persistedCells(xml, sheetName, xlsxSheet, workbookHash) {
  const cells = [];
  // attrs는 반드시 non-greedy여야 한다. greedy이면 `<c .../>`의 `/`를 attrs가 먹고
  // 다음 셀의 `</c>`까지 한 셀로 합쳐 persisted cell/formula를 누락한다.
  for (const match of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = match[1];
    const body = match[2] || '';
    const address = attribute(attrs, 'r');
    if (!address) continue;
    const xlsxCell = xlsxSheet?.[address] || null;
    const formulaMatch = body.match(/<f\b([^>]*)>([\s\S]*?)<\/f>|<f\b([^>]*)\/>/);
    const formula = xlsxCell?.f != null ? String(xlsxCell.f) : formulaMatch?.[2] ? xmlDecode(formulaMatch[2]) : null;
    const valueMatch = body.match(/<v>([\s\S]*?)<\/v>/);
    const inlineMatch = body.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/);
    const rawValue = valueMatch ? xmlDecode(valueMatch[1]) : inlineMatch ? xmlDecode(inlineMatch[1]) : null;
    const formulaMeta = formulaMatch ? { type: attribute(formulaMatch[1] || formulaMatch[3], 't'), sharedIndex: attribute(formulaMatch[1] || formulaMatch[3], 'si'), ref: attribute(formulaMatch[1] || formulaMatch[3], 'ref') } : null;
    const fingerprint = formula ? formulaFingerprint(formula, address, formulaMeta || {}) : null;
    const role = cellRole({ sheet: sheetName, address, formula, type: attribute(attrs, 't'), value: xlsxCell?.v, rawValue });
    const valueDigest = canonicalDigest({ type: xlsxCell?.t || attribute(attrs, 't'), value: xlsxCell?.v ?? rawValue, display: xlsxCell?.w ?? null });
    const mappingId = `confirmed.cell@1:${sheetName}!${address}`;
    const fieldId = semanticFieldId(sheetName, address, xlsxSheet);
    const cell = {
      id: `${sheetName}!${address}`,
      mappingId,
      semanticFieldId: fieldId,
      sheet: sheetName,
      address,
      style: Number(attribute(attrs, 's') || 0),
      type: xlsxCell?.t || attribute(attrs, 't') || null,
      role,
      formula: formula || null,
      formulaExactFingerprint: fingerprint?.exact || null,
      formulaShapeFingerprint: fingerprint?.shape || null,
      value: xlsxCell?.v ?? null,
      rawValue,
      valueDigest,
      formulaMeta,
    };
    cell.provenanceDigest = provenanceDigestForCell({ workbookHash, sheet: sheetName, address, mappingId, semanticFieldId: fieldId, role, formulaFingerprint: cell.formulaExactFingerprint, valueDigest, source: 'persisted-workbook-cell@1' });
    cells.push(cell);
  }
  return cells;
}

function structuralDigest(xml) {
  const normalized = [
    xml.match(/<dimension\b[^>]*\/?\s*>/)?.[0] || '',
    xml.match(/<cols>[\s\S]*?<\/cols>/)?.[0] || '',
    ...(xml.match(/<row\b[^>]*>/g) || []).map(row => row.replace(/\s+/g, ' ').trim()),
    xml.match(/<mergeCells[\s\S]*?<\/mergeCells>/)?.[0] || '',
    xml.match(/<sheetFormatPr\b[^>]*\/?\s*>/)?.[0] || '',
    xml.match(/<sheetViews>[\s\S]*?<\/sheetViews>/)?.[0] || '',
  ];
  return canonicalDigest(normalized);
}

function reportSnapshot(workbook) {
  const sheet = workbook.Sheets[MAIN_SHEET];
  const cells = {};
  for (let row = MAIN_GEOMETRY.firstItemRow; row <= MAIN_GEOMETRY.totalRow; row += 1) {
    for (let col = 1; col <= 20; col += 1) {
      const address = XLSX.utils.encode_cell({ r: row - 1, c: col });
      const cell = sheet?.[address];
      cells[address] = { value: cell?.v ?? null, type: cell?.t ?? null, formula: cell?.f ?? null };
    }
  }
  return {
    title: sheet?.B1?.v ?? null,
    note: sheet?.[MAIN_GEOMETRY.noteCell]?.v ?? null,
    usedRange: sheet?.['!ref'] || null,
    categories: Array.from({ length: 16 }, (_, index) => sheet?.[`B${MAIN_GEOMETRY.firstItemRow + index}`]?.v ?? null),
    totalU: cells[`U${MAIN_GEOMETRY.totalRow}`],
    cells,
  };
}

export async function inspectProfitReportWorkbook(workbookPath) {
  const bytes = fs.readFileSync(workbookPath);
  const workbookHash = sha256(bytes);
  const [zip, workbook] = await Promise.all([
    JSZip.loadAsync(bytes),
    Promise.resolve(XLSX.read(bytes, { type: 'buffer', cellFormula: true, cellNF: true, cellStyles: true, bookDeps: true, bookFiles: true })),
  ]);
  const { sheets: sheetPaths, workbookXml } = await workbookSheetPaths(zip);
  const sheets = [];
  const allCells = [];
  for (const sheetInfo of sheetPaths) {
    const xml = await zip.file(sheetInfo.path).async('string');
    const cells = persistedCells(xml, sheetInfo.name, workbook.Sheets[sheetInfo.name], workbookHash);
    allCells.push(...cells);
    sheets.push({ name: sheetInfo.name, state: sheetInfo.state, path: sheetInfo.path, usedRange: workbook.Sheets[sheetInfo.name]?.['!ref'] || null, structuralDigest: structuralDigest(xml), persistedCellCount: cells.length, formulaCount: cells.filter(cell => cell.formula).length, knownErrorCount: cells.filter(cell => cell.role === 'KNOWN_ERROR').length });
  }
  const formulaCells = allCells.filter(cell => cell.formula);
  const registry = Object.fromEntries(allCells.map(cell => [cell.id, cell]));
  const registryDigest = canonicalDigest(Object.values(registry).map(cell => ({ id: cell.id, mappingId: cell.mappingId, semanticFieldId: cell.semanticFieldId, role: cell.role, formula: cell.formulaExactFingerprint, value: cell.valueDigest, provenance: cell.provenanceDigest })));
  return {
    schemaVersion: 1,
    path: path.resolve(workbookPath),
    bytes: bytes.length,
    sha256: workbookHash,
    sheetNames: workbook.SheetNames,
    sheets,
    persistedCellCount: allCells.length,
    formulaCount: formulaCells.length,
    formulaFingerprintCount: formulaCells.filter(cell => cell.formulaExactFingerprint).length,
    formulaCatalogDigest: canonicalDigest(formulaCells.map(cell => [cell.id, cell.formulaExactFingerprint, cell.formulaShapeFingerprint])),
    registryDigest,
    registry,
    report: reportSnapshot(workbook),
    workbookStructureDigest: canonicalDigest({ workbook: workbookXml.match(/<workbookPr\b[^>]*\/?\s*>/)?.[0] || '', sheets: sheets.map(sheet => ({ name: sheet.name, state: sheet.state, structuralDigest: sheet.structuralDigest })) }),
  };
}

/**
 * 차수 없는 `매출원가 양식.xlsx`는 주차 원본이 아니라 계산 규칙 명세다.
 * 일반 주차 workbook의 7~22행 geometry로 해석하지 않고, 7행 설명과
 * 품목리스트의 실제 ProdKey만 별도 provenance로 고정한다.
 */
export function inspectFormulaSpecification(workbookPath) {
  const bytes = fs.readFileSync(workbookPath);
  const workbookHash = sha256(bytes);
  const specification = FORMULA_SPEC_SOURCES[workbookHash];
  if (!specification) {
    throw new Error(`수식 명세 workbook SHA-256 불일치: ${workbookHash}`);
  }
  const workbook = XLSX.read(bytes, { type: 'buffer', cellFormula: true, cellNF: true });
  const reportSheet = workbook.Sheets[MAIN_SHEET];
  const productSheet = workbook.Sheets['품목리스트'];
  if (!reportSheet || !productSheet) throw new Error('수식 명세 workbook의 필수 시트가 없습니다.');

  const formulaDescriptions = Object.fromEntries(FORMULA_SPEC_COLUMNS.map((column) => {
    const address = `${column}${FORMULA_SPEC_ROW}`;
    const text = String(reportSheet[address]?.v ?? '').trim();
    const mappingId = `formula-spec@1:${MAIN_SHEET}!${address}`;
    return [column, {
      column,
      address,
      text,
      mappingId,
      provenanceDigest: provenanceDigestForCell({
        workbookHash,
        sheet: MAIN_SHEET,
        address,
        mappingId,
        semanticFieldId: `report.formula-spec.${column}`,
        role: 'FORMULA_SPEC',
        formulaFingerprint: null,
        valueDigest: canonicalDigest(text),
        source: 'formula-spec-workbook-cell@1',
      }),
    }];
  }));

  const productRange = XLSX.utils.decode_range(productSheet['!ref'] || 'A1:I1');
  const products = [];
  for (let row = 1; row <= productRange.e.r; row += 1) {
    const prodKey = Number(productSheet[XLSX.utils.encode_cell({ r: row, c: 0 })]?.v);
    const prodName = String(productSheet[XLSX.utils.encode_cell({ r: row, c: 2 })]?.v ?? '').trim();
    if (!(prodKey > 0) || !prodName) continue;
    const address = `A${row + 1}:I${row + 1}`;
    const mappingId = `formula-spec-product@1:${prodKey}`;
    const item = {
      prodKey,
      prodCode: String(productSheet[XLSX.utils.encode_cell({ r: row, c: 1 })]?.v ?? '').trim(),
      prodName,
      flowerName: String(productSheet[XLSX.utils.encode_cell({ r: row, c: 3 })]?.v ?? '').trim(),
      countryName: String(productSheet[XLSX.utils.encode_cell({ r: row, c: 4 })]?.v ?? '').trim(),
      outUnit: String(productSheet[XLSX.utils.encode_cell({ r: row, c: 6 })]?.v ?? '').trim(),
      estimateUnit: String(productSheet[XLSX.utils.encode_cell({ r: row, c: 7 })]?.v ?? '').trim(),
      sourceRef: `${FORMULA_SPEC_FILE}#품목리스트!${address}`,
      mappingId,
    };
    item.provenanceDigest = canonicalDigest({ workbookHash, ...item });
    products.push(item);
  }

  const sourceAnnotations = FORMULA_SOURCE_ANNOTATION_CELLS.map((expected) => {
    const sheet = workbook.Sheets[expected.sheet];
    const actual = String(sheet?.[expected.address]?.v ?? '').trim();
    return {
      ...expected,
      actual,
      present: actual === expected.text,
      sourceRef: `${path.basename(workbookPath)}#${expected.sheet}!${expected.address}`,
    };
  });
  if (specification.version >= 2 && sourceAnnotations.some((item) => !item.present)) {
    const missing = sourceAnnotations.filter((item) => !item.present).map((item) => `${item.sheet}!${item.address}`).join(', ');
    throw new Error(`수식 명세 원천 주석 불일치: ${missing}`);
  }

  return {
    schemaVersion: 1,
    specificationVersion: specification.version,
    specificationKind: specification.kind,
    path: path.resolve(workbookPath),
    file: path.basename(workbookPath),
    sha256: workbookHash,
    formulaRow: FORMULA_SPEC_ROW,
    formulaDescriptions,
    sourceAnnotations: specification.version >= 2 ? sourceAnnotations : [],
    sourceAnnotationCount: specification.version >= 2 ? sourceAnnotations.length : 0,
    productCount: products.length,
    products,
    productCatalogDigest: canonicalDigest(products.map(({ prodKey, prodCode, prodName, flowerName, countryName, outUnit, estimateUnit, provenanceDigest }) => ({ prodKey, prodCode, prodName, flowerName, countryName, outUnit, estimateUnit, provenanceDigest }))),
  };
}

export function historicalCategoryRule(majorWeek) {
  const week = Number(majorWeek);
  if (week >= 22 && week <= 27) return { lastRowCategory: '공제', ruleId: 'legacy-deduction-row@1' };
  if (week === 28) return { lastRowCategory: '국내', ruleId: 'domestic-row@1' };
  throw new Error(`근거 registry 범위 밖 차수입니다: ${majorWeek}`);
}

export function registryCoverage(evidence) {
  const mapped = Object.values(evidence.registry).filter(cell => cell.role && cell.provenanceDigest).length;
  return { total: evidence.persistedCellCount, mapped, rate: evidence.persistedCellCount ? mapped / evidence.persistedCellCount : 0 };
}
