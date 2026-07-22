// 영업수입 불량차감 양식 파서/생성기
// 원본 양식의 병합 셀·제목·테두리·로고를 보존하고 값만 교체한다.

import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { normalizeUnit } from './salesDefectDeductionCore.js';

export const DEFECT_TEMPLATE_PATH = path.join(
  process.cwd(),
  'data',
  'sales-defect-deduction-template.xlsx',
);

const HEADER_NAMES = new Set(['거래처', '품종', '품명', '색상', '차감수량', '크레딧(수입부)', '크레딧', '농장', '비고']);
const UNIT_RE = /(박스|box|단|bunch|대|스팀\s*\(?대\)?|stem|steam|송이)/i;

function cellText(cell) {
  const value = cell?.value;
  if (value == null) return '';
  if (typeof value === 'object' && value.richText) return value.richText.map((x) => x.text || '').join('');
  if (typeof value === 'object' && value.result != null) return String(value.result);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function compact(text) {
  return String(text || '').replace(/[\s_:\-]/g, '').toLowerCase();
}

export function parseQuantityCell(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { quantity: 0, unit: '', raw: '' };
  const match = raw.replace(/,/g, '').match(/(-?\d+(?:\.\d+)?)\s*(.*)$/);
  if (!match) return { quantity: 0, unit: '', raw };
  const quantity = Number(match[1]);
  const suffix = match[2] || '';
  const unitMatch = suffix.match(UNIT_RE);
  return {
    quantity: Number.isFinite(quantity) ? Math.abs(quantity) : 0,
    unit: normalizeUnit(unitMatch?.[1] || suffix),
    raw,
  };
}

function isChecked(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return ['✓', '✔', '☑', 'o', 'ok', 'y', 'yes', 'true', '1', '완료', '처리'].includes(text);
}

function findHeaderRow(ws) {
  for (let r = 1; r <= Math.min(ws.actualRowCount || 100, 100); r += 1) {
    const values = [];
    for (let c = 1; c <= Math.min(ws.actualColumnCount || 20, 20); c += 1) {
      const text = compact(cellText(ws.getCell(r, c)));
      if (text) values.push(text);
    }
    const hit = values.filter((v) => [...HEADER_NAMES].some((h) => compact(h) === v)).length;
    const hasVariety = values.includes(compact('품종')) || values.includes(compact('품명'));
    if (hit >= 4 && values.includes(compact('거래처')) && hasVariety) return r;
  }
  return 5;
}

function findTitle(ws) {
  for (let r = 1; r <= Math.min(ws.actualRowCount || 100, 100); r += 1) {
    for (let c = 1; c <= Math.min(ws.actualColumnCount || 20, 20); c += 1) {
      const text = cellText(ws.getCell(r, c));
      const match = text.match(/(\d{4})\s*년\s*\(\s*(\d{1,2})\s*\)\s*차/);
      if (match) return { year: match[1], week: String(Number(match[2])), text };
    }
  }
  return { year: String(new Date().getFullYear()), week: '', text: '' };
}

function rowValues(ws, row) {
  // 원본 양식은 B:C, D:E, J:K가 병합되어 있다. 병합의 왼쪽 셀을 기준으로 읽는다.
  const customer = cellText(ws.getCell(row, 2));
  const product = cellText(ws.getCell(row, 4));
  const color = cellText(ws.getCell(row, 6));
  const qty = parseQuantityCell(cellText(ws.getCell(row, 7)));
  const credit = isChecked(cellText(ws.getCell(row, 8)));
  const farm = cellText(ws.getCell(row, 9));
  const note = cellText(ws.getCell(row, 10));
  return { customerName: customer, productName: product, colorName: color, ...qty, creditApplied: credit, farmName: farm, note };
}

export async function parseSalesDefectWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('엑셀 시트를 찾을 수 없습니다.');
  const title = findTitle(ws);
  const headerRow = findHeaderRow(ws);
  const rows = [];
  for (let r = headerRow + 1; r <= (ws.actualRowCount || headerRow); r += 1) {
    const row = rowValues(ws, r);
    const hasData = [row.customerName, row.productName, row.colorName, row.farmName, row.note, row.raw]
      .some((v) => String(v || '').trim());
    if (!hasData || /^합계$/i.test(row.customerName) || /^합계$/i.test(row.productName)) continue;
    rows.push({ ...row, sourceRowNo: r });
  }
  return {
    sheetName: ws.name,
    title,
    headerRow,
    rows,
  };
}

function safeSheetName(value) {
  const raw = String(value || '차감').replace(/[\\/?*\[\]:]/g, '').trim();
  return (raw || '차감').slice(0, 31);
}

function exportGroupKey(value) {
  return compact(String(value || '')).replace(/국내|콜롬비아|네덜란드|태국|호주|미국|중국|에콰도르|이스라엘|뉴질랜드|일본|베트남/g, '');
}

function countryVarietyName(item) {
  const country = String(item?.countryName || item?.CounName || '').trim();
  const variety = String(item?.productName || item?.matchedFlowerName || item?.FlowerName || '').trim();
  if (!country || !variety) return variety || country;
  const countryKey = exportGroupKey(country);
  const varietyKey = exportGroupKey(variety);
  return countryKey && varietyKey.startsWith(countryKey) ? variety : `${country} ${variety}`;
}

/**
 * 원본 양식의 표시 규칙을 적용한다.
 * - 업체는 업체 그룹의 첫 행만 표시
 * - 같은 업체의 같은 품종은 품종 그룹의 첫 행만 표시
 * - 업체 그룹 사이에는 양식용 공백 행 삽입
 * - 품종에는 Product.CounName(국가)을 붙인다.
 */
export function formatSalesDefectExportRows(records) {
  const source = Array.isArray(records) ? records.filter(Boolean) : [];
  const customerGroups = new Map();
  for (const item of source) {
    const key = exportGroupKey(item.customerName || item.CustName) || `row-${customerGroups.size}`;
    if (!customerGroups.has(key)) customerGroups.set(key, { customerName: item.customerName || item.CustName || '', rows: [] });
    customerGroups.get(key).rows.push(item);
  }

  const output = [];
  for (const group of customerGroups.values()) {
    if (output.length) output.push({ blank: true });
    const varietyGroups = new Map();
    for (const item of group.rows) {
      const variety = item.productName || item.matchedFlowerName || item.FlowerName || '';
      const key = exportGroupKey(variety) || `row-${varietyGroups.size}`;
      if (!varietyGroups.has(key)) varietyGroups.set(key, []);
      varietyGroups.get(key).push(item);
    }
    let firstCustomerRow = true;
    for (const varietyRows of varietyGroups.values()) {
      let firstVarietyRow = true;
      for (const item of varietyRows) {
        output.push({
          ...item,
          customerName: firstCustomerRow ? group.customerName : '',
          productName: firstVarietyRow ? countryVarietyName(item) : '',
        });
        firstCustomerRow = false;
        firstVarietyRow = false;
      }
    }
  }
  return output;
}

function cloneStyle(style) {
  try { return JSON.parse(JSON.stringify(style)); } catch { return style; }
}

function ensureRows(ws, requiredRows) {
  const firstDataRow = 6;
  const templateLast = 44;
  const currentCapacity = templateLast - firstDataRow + 1;
  if (requiredRows <= currentCapacity) return;
  const source = ws.getRow(templateLast);
  for (let r = templateLast + 1; r <= firstDataRow + requiredRows - 1; r += 1) {
    const row = ws.insertRow(r, []);
    row.height = source.height;
    for (let c = 1; c <= 11; c += 1) row.getCell(c).style = cloneStyle(source.getCell(c).style);
    ws.mergeCells(`B${r}:C${r}`);
    ws.mergeCells(`D${r}:E${r}`);
    ws.mergeCells(`J${r}:K${r}`);
  }
}

function setMergedCell(ws, address, value) {
  ws.getCell(address).value = value == null || value === '' ? null : value;
}

function setExportCellLayout(ws, rowNumber) {
  for (const column of ['B', 'D', 'F', 'I', 'J']) {
    const cell = ws.getCell(`${column}${rowNumber}`);
    cell.alignment = {
      ...(cell.alignment || {}),
      horizontal: 'left',
      vertical: 'middle',
      indent: 1,
      wrapText: true,
    };
  }
  for (const column of ['G', 'H']) {
    const cell = ws.getCell(`${column}${rowNumber}`);
    cell.alignment = {
      ...(cell.alignment || {}),
      horizontal: 'center',
      vertical: 'middle',
      wrapText: true,
    };
  }
  // 원본 병합셀은 Excel에 CSS padding이 없어 행 높이와 indent로 안쪽 여백을 만든다.
  const row = ws.getRow(rowNumber);
  row.height = Math.max(Number(row.height) || 0, 25);
}

function titleCells(ws, title) {
  // 원본 파일은 D2:H4가 같은 제목으로 저장되어 있어 일부 엑셀 뷰어에서도 동일하게 보인다.
  for (let r = 2; r <= 4; r += 1) {
    for (let c = 4; c <= 8; c += 1) {
      if (cellText(ws.getCell(r, c))) ws.getCell(r, c).value = title;
    }
  }
}

export async function buildSalesDefectWorkbook(records, { year, week, managerName = '' } = {}) {
  if (!fs.existsSync(DEFECT_TEMPLATE_PATH)) throw new Error('불량 차감 엑셀 원본 양식이 배포 파일에 없습니다.');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(DEFECT_TEMPLATE_PATH);
  const ws = wb.worksheets[0];
  const normalizedWeek = String(Number(week || 0) || week || '').replace(/^0+/, '') || '';
  const title = `${year}년 ( ${normalizedWeek} )차 차감 내역`;
  ws.name = safeSheetName(`${normalizedWeek}차`);
  titleCells(ws, title);
  setMergedCell(ws, 'D5', '품종');
  setMergedCell(ws, 'F5', '품명');
  if (managerName) ws.getCell('I3').value = managerName;

  const rows = formatSalesDefectExportRows(records);
  ensureRows(ws, Math.max(rows.length, 1));
  const first = 6;
  const last = Math.max(44, first + rows.length - 1);
  for (let r = first; r <= last; r += 1) {
    setMergedCell(ws, `B${r}`, null);
    setMergedCell(ws, `D${r}`, null);
    setMergedCell(ws, `F${r}`, null);
    setMergedCell(ws, `G${r}`, null);
    setMergedCell(ws, `H${r}`, null);
    setMergedCell(ws, `I${r}`, null);
    setMergedCell(ws, `J${r}`, null);
    setExportCellLayout(ws, r);
  }

  rows.forEach((item, index) => {
    const r = first + index;
    if (item.blank) return;
    const qty = Number(item.quantity || 0);
    const unit = item.unit || item.sourceUnit || '';
    setMergedCell(ws, `B${r}`, item.customerName || '');
    setMergedCell(ws, `D${r}`, item.productName || item.prodName || '');
    setMergedCell(ws, `F${r}`, item.colorName || '');
    setMergedCell(ws, `G${r}`, `${Number.isInteger(qty) ? qty : qty}${unit || ''}`);
    setMergedCell(ws, `H${r}`, item.creditApplied ? '✓' : null);
    setMergedCell(ws, `I${r}`, item.farmName || '');
    setMergedCell(ws, `J${r}`, item.note || '');
  });

  wb.creator = 'nenovaweb';
  wb.modified = new Date();
  return Buffer.from(await wb.xlsx.writeBuffer());
}
