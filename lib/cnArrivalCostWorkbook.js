// 중국 도착원가 .xlsx 생성기. 화면에서 수정한 상단·행 입력값을 노란 입력칸에 그대로 쓰고,
// 나머지 칸은 그 입력칸만 참조하는 수식으로 만든다. 수식 캐시값은 computeCnCost 결과와 같다.
import ExcelJS from 'exceljs';
import { CN_MODES, cnCategory } from './cnArrivalCostRules.js';
import { CN_HEADER_FIELDS, computeCnCost, isCnWeightAllocation } from './cnArrivalCostEngine.js';
import { formatCostSheetName } from './costMasterStore.js';

export const CN_WORKBOOK_FONT = '맑은 고딕';
const FONT = { name: CN_WORKBOOK_FONT, size: 10 };
const INPUT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4C2' } };
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF6' } };
const REVIEW_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE2E1' } };
const BORDER = { top: { style: 'thin', color: { argb: 'FFC9D1DC' } }, bottom: { style: 'thin', color: { argb: 'FFC9D1DC' } },
  left: { style: 'thin', color: { argb: 'FFC9D1DC' } }, right: { style: 'thin', color: { argb: 'FFC9D1DC' } } };
const colName = n => { let s = ''; for (n++; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };

const LINE_COLUMNS = {
  HUBFRESH: [
    ['no', 'No', 5], ['name', '품명', 44], ['category', '카테고리', 22], ['quantity', '수량(단)', 9, 'in'], ['fob', 'FOB (CNY/단)', 10, 'in'],
    ['bunchesPerBox', '박스당단수', 9, 'in'], ['cbmPerBunch', '단당 CBM', 10, 'in'], ['tariffRate', '관세율', 8, 'in'], ['stemsPerBunch', '단당줄기수', 9, 'in'],
    ['boxFee', '박스비(단)', 10], ['freight', '운송비(단)', 10], ['cnf', 'CNF(단)', 10], ['fee', '수수료(원)', 10], ['cnfKrw', 'CNF 원화(단)', 11],
    ['duty', '관세(원)', 10], ['customs', '그외통관(단)', 11], ['cost', '도착원가(단)', 12], ['costPerStem', '줄기당 원가', 11], ['salePrice', '목표마진 판매가(단)', 13],
    ['totalCost', '총 도착원가', 14], ['rowMetric', '총 CBM', 10],
  ],
  CLOUD: [
    ['no', 'No', 5], ['name', '품명', 44], ['category', '카테고리', 22], ['quantity', '수량(단)', 9, 'in'], ['fob', 'FOB (CNY/단)', 10, 'in'],
    ['bunchesPerBox', '박스당단수', 9, 'in'], ['cbmPerBunch', '단당 CBM(kg환산)', 11, 'in'], ['weightKgPerBunch', '단당 중량(kg)', 10, 'in'], ['tariffRate', '관세율', 8, 'in'],
    ['stemsPerBunch', '단당줄기수', 9, 'in'], ['orchid', '호접(1/0)', 8, 'in'], ['metric', '배분값(단)', 10], ['permit', '허가증(단)', 10], ['freight', '운송비(단)', 10],
    ['cnf', 'CNF(단)', 10], ['fee', '수수료(원)', 10], ['cnfKrw', 'CNF 원화(단)', 11], ['duty', '관세(원)', 10], ['customs', '그외통관(단)', 11], ['cost', '도착원가(단)', 12],
    ['costPerStem', '줄기당 원가', 11], ['salePrice', '목표마진 판매가(단)', 13], ['totalCost', '총 도착원가', 14], ['rowMetric', '총 배분값', 10], ['orchidQty', '호접 수량', 9],
  ],
};

export function cnWorkbookLayout(mode, rowCount) {
  const fields = CN_HEADER_FIELDS[mode];
  const inputStart = 5;
  const input = Object.fromEntries(fields.map((field, index) => [field.key, `$B$${inputStart + index}`]));
  const derivedKeys = mode === CN_MODES.HUBFRESH
    ? ['share', 'containerCharges', 'allocatedFreight', 'rate', 'customsTotal', 'totalQty', 'customsPerBunch']
    : ['warehouseFee', 'quarantineFee', 'customsTotal', 'totalQty', 'customsPerBunch', 'totalMetric', 'rate', 'orchidQty'];
  const derived = Object.fromEntries(derivedKeys.map((key, index) => [key, `$F$${inputStart + index}`]));
  const headerRow = inputStart + Math.max(fields.length, derivedKeys.length) + 2;
  const firstLine = headerRow + 1, lastLine = headerRow + rowCount;
  const columns = LINE_COLUMNS[mode].map(([key, label, width, kind], index) => ({ key, label, width, input: kind === 'in', col: colName(index) }));
  const col = Object.fromEntries(columns.map(c => [c.key, c.col]));
  return { fields, input, derived, derivedKeys, headerRow, firstLine, lastLine, totalRow: lastLine + 1, columns, col };
}

function derivedFormulas(mode, L) {
  const i = L.input, d = L.derived, c = L.col, range = key => `${c[key]}${L.firstLine}:${c[key]}${L.lastLine}`;
  if (mode === CN_MODES.HUBFRESH) return {
    share: [`${i.nenovaCbm}/${i.realCbm}`, 'CBM 지분율 = Nenova CBM ÷ Real CBM'],
    containerCharges: [`${i.docFee}+${i.processUnit}*${i.processBoxes}+${i.quarantineBoxUnit}*${i.quarantineBoxes}+${i.seaFreight}+${i.logger}+${i.loading}`, '컨테이너 비용 100% 원액 (CNY)'],
    allocatedFreight: [`${d.containerCharges}*${d.share}`, '안분운송료 C11 (CNY)'],
    rate: [`${d.allocatedFreight}/${i.nenovaCbm}`, 'CBM당 단가 Rate P5 (CNY/CBM)'],
    customsTotal: [`${i.commonCustoms}*${d.share}+${i.dedicatedCustoms}`, '안분 통관비 합계 (원)'],
    totalQty: [`SUM(${range('quantity')})`, '실제 입고단수'],
    customsPerBunch: [`${d.customsTotal}/${d.totalQty}`, '그외통관(단) = 통관비 ÷ 입고단수'],
  };
  return {
    warehouseFee: [`IF(${i.warehouseFeeOverride}>0,${i.warehouseFeeOverride},${i.gw}*${i.warehousePerKg})`, '백상비 = 직접입력 또는 GW × 백상단가 (원)'],
    quarantineFee: [`${i.quarantineCount}*${i.quarantinePerItem}`, '검역비 = 품목수 × 검역단가 (원)'],
    customsTotal: [`${d.warehouseFee}+${i.brokerage}+${d.quarantineFee}+${i.domesticTransport}+${i.quarantineDeduct}+${i.disinfection}`, '총 통관비 (원)'],
    totalQty: [`SUM(${range('quantity')})`, '총 입고단수'],
    customsPerBunch: [`${d.customsTotal}/${d.totalQty}`, '그외통관(단) = 총통관비 ÷ 총단수 균등배분'],
    totalMetric: [`SUM(${range('rowMetric')})`, '배분값 합계 (CBM kg환산 또는 중량)'],
    rate: [`${i.airFreight}/${d.totalMetric}`, '배분 단가 Rate = 항공운임 ÷ 배분값 합계'],
    orchidQty: [`SUM(${range('orchidQty')})`, '호접란 수량 합계'],
  };
}

function lineFormulas(mode, L, r) {
  const i = L.input, d = L.derived, c = L.col, at = key => `${c[key]}${r}`;
  const common = {
    cnf: mode === CN_MODES.HUBFRESH ? `${at('fob')}+${at('boxFee')}+${at('freight')}` : `${at('fob')}+${at('permit')}+${at('freight')}`,
    fee: `${at('cnf')}*${i.commissionRate}*${i.exchangeRate}`,
    cnfKrw: `${at('cnf')}*${i.exchangeRate}`,
    duty: `${at('cnfKrw')}*${at('tariffRate')}`,
    customs: `${d.customsPerBunch}`,
    cost: `${at('fee')}+${at('cnfKrw')}+${at('duty')}+${at('customs')}`,
    costPerStem: `${at('cost')}/${at('stemsPerBunch')}`,
    salePrice: `${at('cost')}/(1-${i.marginRate})*1.1`,
    totalCost: `${at('cost')}*${at('quantity')}`,
  };
  if (mode === CN_MODES.HUBFRESH) return { ...common,
    boxFee: `${i.boxUnitPrice}/${at('bunchesPerBox')}`,
    freight: `${at('cbmPerBunch')}*${d.rate}`,
    rowMetric: `${at('quantity')}*${at('cbmPerBunch')}` };
  return { ...common,
    metric: `IF(${i.allocationMode}=2,${at('weightKgPerBunch')},IF(${i.allocationMode}=1,${at('cbmPerBunch')},IF(${i.gw}>0,IF(${i.gw}=${i.cw},${at('weightKgPerBunch')},${at('cbmPerBunch')}),${at('cbmPerBunch')})))`,
    permit: `IF(${d.orchidQty}>0,${at('orchid')}*${i.orchidPermit}/${d.orchidQty},0)`,
    freight: `${at('metric')}*${d.rate}`,
    rowMetric: `${at('quantity')}*${at('metric')}`,
    orchidQty: `${at('quantity')}*${at('orchid')}` };
}

export async function createCnArrivalCostWorkbook(payload) {
  const result = computeCnCost(payload);
  if (result.issues.length && !result.rows.length) throw Object.assign(new Error(result.issues[0].text), { statusCode: 422 });
  const mode = result.mode, L = cnWorkbookLayout(mode, result.rows.length);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'nenova-erp'; wb.created = new Date(0);
  const sheetName = formatCostSheetName(payload.orderWeek);
  const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: L.headerRow }] });
  const put = (addr, value, style = {}) => {
    const cell = ws.getCell(addr.replace(/\$/g, ''));
    cell.value = value; cell.font = { ...FONT, ...(style.font || {}) };
    if (style.fill) cell.fill = style.fill;
    if (style.numFmt) cell.numFmt = style.numFmt;
    if (style.border !== false) cell.border = BORDER;
    cell.alignment = { vertical: 'middle', wrapText: !!style.wrap, horizontal: style.align };
    return cell;
  };
  const modeLabel = mode === CN_MODES.HUBFRESH ? 'HUBFRESH(중국 해상)' : 'CLOUD(중국 항공)';
  const keyText = Array.isArray(payload.warehouseKeys) && payload.warehouseKeys.length > 1
    ? payload.warehouseKeys.map(k => `#${k}`).join('+')
    : `#${payload.warehouseKey ?? '-'}`;
  put('A1', `중국 도착원가 · ${modeLabel} · ${payload.orderYear || ''}/${payload.orderWeek || ''} · 입고 ${keyText} ${payload.farmName || ''}`.trim(), { font: { bold: true, size: 13 }, border: false });
  ws.mergeCells('A1:L1');
  put('A4', '입력값 (화면 수정값 그대로)', { font: { bold: true }, fill: HEAD_FILL }); put('B4', '값', { font: { bold: true }, fill: HEAD_FILL }); put('C4', '단위', { font: { bold: true }, fill: HEAD_FILL });
  put('E4', '계산값', { font: { bold: true }, fill: HEAD_FILL }); put('F4', '값', { font: { bold: true }, fill: HEAD_FILL });
  L.fields.forEach(field => {
    const addr = L.input[field.key], row = addr.replace(/\D/g, '');
    const unitLabel = field.select ? '0=자동,1=CBM,2=중량' : field.unit;
    put(`A${row}`, field.label); put(addr, result.header[field.key], { fill: INPUT_FILL, numFmt: field.percent ? '0.00%' : field.select ? '0' : '#,##0.######' }); put(`C${row}`, unitLabel);
  });
  const dForm = derivedFormulas(mode, L);
  for (const key of L.derivedKeys) {
    const addr = L.derived[key], row = addr.replace(/\D/g, '');
    put(`E${row}`, dForm[key][1]);
    put(addr, { formula: dForm[key][0], result: result.derived[key] }, { numFmt: key === 'share' ? '0.0000%' : '#,##0.####' });
  }
  L.columns.forEach((column, index) => {
    put(`${column.col}${L.headerRow}`, column.label, { font: { bold: true }, fill: HEAD_FILL, wrap: true, align: 'center' });
    ws.getColumn(index + 1).width = column.width;
  });
  ws.getRow(L.headerRow).height = 32;
  ws.autoFilter = `A${L.headerRow}:${L.columns.at(-1).col}${L.lastLine}`;
  const useWeight = mode === CN_MODES.CLOUD && isCnWeightAllocation(result.header);
  result.rows.forEach((row, index) => {
    const r = L.firstLine + index, f = lineFormulas(mode, L, r);
    const values = { no: index + 1, name: row.name, category: cnCategory(row.categoryCode)?.label || row.categoryCode, quantity: row.quantity, fob: row.fob,
      bunchesPerBox: row.bunchesPerBox, cbmPerBunch: row.cbmPerBunch, weightKgPerBunch: row.weightKgPerBunch, tariffRate: row.tariffRate, stemsPerBunch: row.stemsPerBunch, orchid: row.orchid };
    const metricVal = mode === CN_MODES.CLOUD ? (useWeight ? row.weightKgPerBunch : row.cbmPerBunch) : row.cbmPerBunch;
    const cached = { ...row, metric: mode === CN_MODES.CLOUD ? metricVal : null,
      rowMetric: row.quantity * metricVal, orchidQty: row.quantity * row.orchid };
    for (const column of L.columns) {
      const addr = `${column.col}${r}`;
      if (column.key in f) put(addr, { formula: f[column.key], result: cached[column.key] }, { numFmt: ['cost', 'cnfKrw', 'duty', 'customs', 'fee', 'costPerStem', 'salePrice', 'totalCost'].includes(column.key) ? '#,##0.00' : '#,##0.0000' });
      else put(addr, values[column.key], { fill: column.input ? INPUT_FILL : (row.needsReview && column.key === 'category' ? REVIEW_FILL : undefined), numFmt: column.key === 'tariffRate' ? '0.0%' : column.input ? '#,##0.######' : undefined });
    }
  });
  const t = L.totalRow;
  put(`B${t}`, '합계', { font: { bold: true } });
  for (const key of ['quantity', 'totalCost', 'rowMetric', ...(mode === CN_MODES.CLOUD ? ['orchidQty'] : [])]) {
    put(`${L.col[key]}${t}`, { formula: `SUM(${L.col[key]}${L.firstLine}:${L.col[key]}${L.lastLine})`, result: result.rows.reduce((s, row) => s + (key === 'quantity' ? row.quantity : key === 'totalCost' ? row.totalCost : key === 'orchidQty' ? row.quantity * row.orchid : row.quantity * (mode === CN_MODES.CLOUD && useWeight ? row.weightKgPerBunch : row.cbmPerBunch)), 0) }, { font: { bold: true }, numFmt: '#,##0.00' });
  }
  const review = result.rows.filter(row => row.needsReview).length;
  if (review) put(`B${t + 2}`, `미등록 품종 ${review}건은 임시 10단 규격으로 계산했습니다. 카테고리를 확인하세요.`, { font: { color: { argb: 'FFB42318' } }, border: false });
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), result, layout: L, sheetName };
}
