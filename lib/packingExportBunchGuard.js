import JSZip from 'jszip';
import XLSX from 'xlsx-js-style';
import { createHash } from 'node:crypto';
import { PACKING_COUNTRIES } from './importPackingErpMatches.js';
import { resolveReceiptBunch } from './receiptBunchQuantity.js';
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
    const digest = createHash('sha256').update(buffer).digest('hex');
    const ratios = JSON.parse(workbook.Custprops?.packingBunchesPerBox ?? '[]');
    if (!Array.isArray(ratios) || ratios.length > 52) throw new Error('invalid source packing evidence');
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
      const [boxQuantity, stemsPerBunch, stemsPerBox, bunchQuantity, stemQuantity, unitPrice] = cells.map(numeric);
      const isWeight = country === 'US' && WEIGHT_LABELS.has(normalizeExactProductName(name))
        && cells.slice(0, 4).every(cell => cell?.v == null || cell.v === '')
        && stemQuantity > 0 && (unitPrice ?? 0) === 0 && Number(cells[6]?.v ?? 0) === 0;
      rows.push({ row, name, boxQuantity, stemsPerBunch, stemsPerBox, bunchesPerBox:ratios[row-6],
        bunchQuantity, stemQuantity, isWeight,scopeKey:[country,digest,row] });
    }
    if (!rows.length) throw new Error('empty workbook');
    return rows;
  } catch {
    throw reject('생성된 패킹 엑셀을 검증하지 못했습니다. 인식값 확인 후 다시 생성하세요.');
  }
}

export async function applyPackingExportBunches(buffer, rows, automatic) {
  if (!automatic.length) return buffer;
  const zip = await JSZip.loadAsync(buffer);
  const sheetPath = 'xl/worksheets/sheet1.xml';
  let xml = await zip.file(sheetPath).async('string');
  const setNumeric = (column,row,quantity,next) => {
    const cell = new RegExp(`<c\\b([^>]*\\br="${column}${row}"[^>]*?)(?:\\/>|>[\\s\\S]*?<\\/c>)`);
    if (cell.test(xml)) {
      xml = xml.replace(cell, (_, attributes) => `<c${attributes.replace(/ t="[^"]*"/g, '')}><v>${quantity}</v></c>`);
      return;
    }
    const nextCell = new RegExp(`(<c\\b[^>]*\\br="${next}${row}")`);
    if (!nextCell.test(xml)) throw reject('단 수량을 엑셀 행에 반영하지 못했습니다.');
    xml = xml.replace(nextCell, `<c r="${column}${row}"><v>${quantity}</v></c>$1`);
  };
  for (const {row,quantity,status} of automatic) {
    setNumeric('I',row,quantity,'J');
    if (status !== 'confirmed') continue;
    const original = rows.find(item => item.row === row);
    if (original.stemQuantity > 0) {
      if (original.boxQuantity > 0) setNumeric('H',row,original.stemQuantity/original.boxQuantity,'I');
      setNumeric('G',row,original.stemQuantity/quantity,original.boxQuantity > 0 ? 'H' : 'I');
    }
  }
  const quantities = new Map(automatic.map(item => [item.row,item.quantity]));
  const total = rows.filter(row => !row.isWeight).reduce((sum,row) => sum + (quantities.get(row.row) ?? row.bunchQuantity ?? 0),0);
  xml = xml.replace(/(<c\b[^>]*\br="I58"[^>]*>)([\s\S]*?)(<\/c>)/, (_, open, contents, close) =>
    open + contents.replace(/<v>[\s\S]*?<\/v>/g, '') + `<v>${total}</v>` + close);
  zip.file(sheetPath, xml);
  return zip.generateAsync({type:'nodebuffer',compression:'STORE'});
}

export function assertPackingExportBunches(rows, products, country, confirmations = {}) {
  const issues = [];
  const automatic = [];
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
    const resolution = resolveReceiptBunch(product, {...row,legacyWorkbook:true,confirmation:confirmations?.[row.row]});
    if (resolution.status === 'review') issues.push({row:row.row,name:row.name,
      message:resolution.message,candidates:resolution.candidates,snapshot:resolution.snapshot});
    if (resolution.status === 'derived' || resolution.status === 'confirmed') automatic.push({row:row.row,
      quantity:resolution.quantity,status:resolution.status});
  }
  if (issues.length) throw Object.assign(reject(`${issues[0].row}행 ${issues[0].name}: ${issues[0].message}`),{issues});
  return automatic;
}
