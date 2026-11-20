import JSZip from 'jszip';
import XLSX from 'xlsx-js-style';
import { PACKING_COUNTRIES } from './importPackingErpMatches.js';
import { receiptBunchIssue } from './receiptBunchQuantity.js';
import { assertWarehousePackingLayout, normalizeExactProductName } from './warehousePackingImport.js';

const SHEETS = { EC: 'EC-Rosaleda', US: 'US-HC' };
const AUDIT_SHEETS = new Set(['날짜 적용 근거', '인식값 확인']);
const WEIGHT_LABELS = new Set(['gross weigth', 'chargeable weigth']);
export const PACKING_EXPORT_MAX_BYTES = 512 * 1024;

const reject = message => Object.assign(new Error(message), { statusCode: 422 });
const numeric = cell => cell?.t === 'n' && !cell.f ? cell.v : null;

export async function readPackingExport(buffer, country) {
  if (typeof country !== 'string' || !Object.hasOwn(SHEETS, country) || buffer.length > PACKING_EXPORT_MAX_BYTES) {
    throw reject('에콰도르·미국 패킹 엑셀 형식을 확인하세요.');
  }
  let workbook;
  try {
    const zip = await JSZip.loadAsync(buffer);
    const files = Object.values(zip.files).filter(file => !file.dir);
    // The existing generator writes a small XLSX with uncompressed entries.
    if (files.length > 24 || !zip.file('xl/workbook.xml') || files.some(file =>
      file._data?.compression?.magic !== '\x00\x00' ||
      /vbaproject|externallink|embedding/i.test(file.name))) throw new Error('unsupported representation');
    workbook = XLSX.read(buffer, { type: 'buffer', sheetRows: 59 });
    if (workbook.SheetNames[0] !== SHEETS[country] ||
        workbook.SheetNames.slice(1).some(name => !AUDIT_SHEETS.has(name))) {
      throw new Error('unexpected worksheets');
    }
    const sheet = workbook.Sheets[SHEETS[country]];
    const dimensions = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref']);
    if (dimensions.e.r !== 57 || sheet.A58?.v !== 'TOTAL') throw new Error('unexpected packing rows');
    const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 'A1:L5', defval: '' });
    assertWarehousePackingLayout(grid);
    const rows = [];
    for (let row = 6; row <= 57; row++) {
      const names = [sheet[`B${row}`], sheet[`E${row}`]];
      const name = names.map(cell => cell?.v)
        .filter(Boolean).map(value => String(value).trim()).join(' ');
      const cells = 'FGHIJKL'.split('').map(column => sheet[`${column}${row}`]);
      const hasQuantity = cells.slice(0, 5).some(cell => cell?.f || (cell?.v != null && cell.v !== ''));
      if (!name && !hasQuantity) continue;
      if (!name || names.some(cell => cell?.f) || cells.slice(0, 5).some(cell =>
        cell && (cell.f || (cell.v != null && cell.v !== '' && !Number.isFinite(numeric(cell)))))) {
        throw new Error('nonliteral quantities');
      }
      const [boxQuantity, stemsPerBunch, , bunchQuantity, stemQuantity, unitPrice] = cells.map(numeric);
      const isWeight = country === 'US' && WEIGHT_LABELS.has(normalizeExactProductName(name))
        && cells.slice(0, 4).every(cell => cell?.v == null || cell.v === '')
        && stemQuantity > 0 && (unitPrice ?? 0) === 0 && Number(cells[6]?.v ?? 0) === 0;
      rows.push({ row, name, boxQuantity, stemsPerBunch, bunchQuantity, stemQuantity, isWeight });
    }
    if (!rows.length) throw new Error('empty workbook');
    return rows;
  } catch {
    throw reject('생성된 패킹 엑셀을 검증하지 못했습니다. 인식값 확인 후 다시 생성하세요.');
  }
}

export function assertPackingExportBunches(rows, products, country) {
  const byName = new Map();
  for (const product of products) {
    const key = normalizeExactProductName(product.ProdName);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(product);
  }
  for (const row of rows) {
    const matches = byName.get(normalizeExactProductName(row.name)) || [];
    if (row.isWeight && (matches.length === 0 || matches.every(product => [3100, 3101].includes(product.ProdKey)))) continue;
    const product = matches[0];
    if (matches.length !== 1 || String(product.CounName).trim() !== PACKING_COUNTRIES[country]) {
      throw reject(`${row.row}행 ${row.name}: 전산 품목과 국가를 확인하세요.`);
    }
    const issue = receiptBunchIssue(product, row);
    if (issue) throw reject(`${row.row}행 ${row.name}: ${issue} 인식값 수정 · 원본 PDF 보기에서 확인하세요.`);
  }
}
