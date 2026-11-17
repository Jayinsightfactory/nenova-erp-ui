import XLSX from 'xlsx-js-style';
import { generatePedidosFromMatrix } from './importPedidos.js';
import { prepareCountryOrderPedidos } from './countryOrderPedidosAdapter.js';
import { importCountryLabel, importUnitLabel } from './importToolsDisplay.js';

const prefixes = /^(?:(?:SPRAY\s+ROSE|ROSE|Hydrangea|CARNATION|ALSTROMERIA|Ruscus|MiniCarnation)(?:\s+CHINA)?|CHINA)\s*(?:\/\s*|\s+)/i;
export function countryOrderShortName(row) {
  const full = String(row.label ?? row.name ?? '');
  return full.replace(prefixes, '').trim() || full;
}
export function countryOrderGroup(matrix, row) {
  return `${importCountryLabel(matrix.scope.country)} · ${row.flower || '기타'}`;
}
export function countryOrderIssue(message) {
  return String(message).replace(/DUPLICATE_CUSTOMER_CODE/g, '업체 코드 중복').replace(/DUPLICATE_PRODUCT_NAME/g, '품목명 중복')
    .replace(/DUPLICATE_MATRIX_IDENTITY/g, '업체·품목 식별값 중복').replace(/MISSING_CUSTOMER_CODE/g, '업체 코드 미등록')
    .replace(/UNRECOGNIZED_CUSTOMER_CODE/g, '업체 코드 형식 확인 필요')
    .replace(/STEM_QUANTITY_UNAVAILABLE/g, '송이 수량 확인 필요')
    .replace(/BUNCH_QUANTITY_UNAVAILABLE/g, '단 수량 확인 필요')
    .replace(/REQUIRED_QUANTITY_UNAVAILABLE/g, '발주 수량 확인 필요')
    .replace(/UNKNOWN_CUSTOMER_CODE/g, '업체 코드 확인 필요')
    .replace(/UNSUPPORTED_UNIT/g, '지원하지 않는 단위').replace(/DUPLICATE/gi, '중복').replace(/MISSING/gi, '미등록');
}

export function splitCountryOrderFarms(matrix, options = {}) {
  prepareCountryOrderPedidos(matrix); // Same scope, completeness and quantity validation as legacy exports.
  if (matrix.scope.country !== 'China') return [{ matrix, farm: '' }];
  const farms = (options.farms ?? ['Melody', 'CLOUD']).map(value => String(value).trim());
  if (farms.length !== 2 || farms.some(value => !value || value.length > 80 || /[<>:"/\\|?*\x00-\x1f]/.test(value)) || farms[0].toLowerCase() === farms[1].toLowerCase()) throw new Error('서로 다른 수신 농장 두 곳을 선택하세요. 파일명에 쓸 수 없는 문자는 제외하세요.');
  const selected = options.selected ?? {};
  const keys = new Set(matrix.rows.map(row => String(row.prodKey)));
  if (Object.entries(selected).some(([key, value]) => !keys.has(key) || typeof value !== 'boolean')) throw new Error('이전 조회의 농장 선택이 남아 있습니다. 다시 선택하세요.');
  if (options.split !== true) return [{ matrix, farm: farms[0] }];
  return farms.map((farm, index) => ({ farm, matrix: { ...matrix, rows: matrix.rows.filter(row => (selected[String(row.prodKey)] === true ? 0 : 1) === index) } })).filter(entry => entry.matrix.rows.length);
}

function matrixSheet(matrix, farm) {
  const headers = ['품목', '단위', ...matrix.customers.map(customer => customer.label), '합계'];
  const rows = [...matrix.rows].sort((a, b) => countryOrderGroup(matrix, a).localeCompare(countryOrderGroup(matrix, b), 'ko') || a.name.localeCompare(b.name, 'en'));
  const data = [[`${importCountryLabel(matrix.scope.country)} ${farm} 발주서 · ${matrix.scope.year} | Semana ${matrix.scope.orderWeek}차`], [], headers];
  let group;
  for (const row of rows) {
    const next = countryOrderGroup(matrix, row);
    if (next !== group) { data.push([next]); group = next; }
    data.push([countryOrderShortName(row), importUnitLabel(row.unit), ...matrix.customers.map(customer => row.quantities[customer.key] ?? 0), row.total]);
  }
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet['!cols'] = [{ wch: 48 }, { wch: 8 }, ...matrix.customers.map(() => ({ wch: 12 })), { wch: 14 }];
  sheet['!rows'] = data.map((_, index) => ({ hpt: index === 0 ? 60 : 23 }));
  sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];
  sheet['!freeze'] = 'C4';
  for (let r = 2; r < data.length; r += 1) {
    const isGroup = data[r].length === 1;
    for (let c = 0; c < headers.length; c += 1) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[address] ?? (sheet[address] = { t: 's', v: '' });
      cell.s = { font: { name: '맑은 고딕', sz: 10, bold: r === 2 || isGroup }, alignment: { horizontal: c < 2 ? 'left' : 'center', vertical: 'center' }, fill: { fgColor: { rgb: r === 2 || isGroup ? 'E8EEF6' : 'FFFFFF' } }, border: { bottom: { style: 'thin', color: { rgb: 'D8E0EA' } } } };
      if (cell.t === 'n') cell.z = '[=0]"";General';
    }
    if (!isGroup && r > 2) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c: headers.length - 1 })];
      cell.f = matrix.customers.length ? `SUM(C${r + 1}:${XLSX.utils.encode_col(headers.length - 2)}${r + 1})` : '0';
    }
  }
  return sheet;
}

/** File-only presentation. Legacy templates and their formulas remain additional sheets. */
export function generateCompactCountryOrders(matrix, options) {
  return splitCountryOrderFarms(matrix, options).flatMap(({ matrix: partition, farm }) => {
    const legacy = generatePedidosFromMatrix(partition);
    // One file per recipient, even when China has both bunch and stem orders.
    // Keep unlike units separate rather than presenting a meaningless grand total.
    if (partition.scope.country === 'China') {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, matrixSheet(partition, farm), '업체별 발주');
      let index = 0;
      for (const output of legacy) for (const name of output.workbook.SheetNames) XLSX.utils.book_append_sheet(workbook, output.workbook.Sheets[name], `${++index}_${name}`.slice(0, 31));
      workbook.Workbook = { CalcPr: { calcMode: 'auto', fullCalcOnLoad: true } };
      const totals = {};
      for (const row of partition.rows) totals[row.unit] = (totals[row.unit] ?? 0) + row.total;
      const mixed = Object.keys(totals).length > 1;
      return [{ ...legacy[0], workbook, filename: `${partition.scope.orderWeek}_${farm}.xlsx`, itemCount: partition.rows.length,
        totalQuantity: mixed ? Object.entries(totals).map(([unit, value]) => `${value.toLocaleString('ko-KR')} ${importUnitLabel(unit)}`).join(' · ') : Object.values(totals)[0] ?? 0,
        totalQuantityByUnit: totals, unit: mixed ? '' : partition.rows[0]?.unit ?? '',
        warnings: [...new Set(legacy.flatMap(output => output.warnings))],
        preview: { headers: ['품목', '단위', ...partition.customers.map(customer => customer.label)], rows: partition.rows.map(row => [countryOrderShortName(row), importUnitLabel(row.unit), ...partition.customers.map(customer => row.quantities[customer.key] ?? 0)]) } }];
    }
    return legacy.map(output => {
    const rows = partition.rows.filter(row => {
      if (partition.scope.country === 'Colombia') return row.flower === output.category;
      if (partition.scope.country === 'Netherlands') return row.name.toLowerCase().startsWith('[ez]') === /_EZ\.xlsx$/i.test(output.filename);
      if (partition.scope.country === 'China') return row.unit === output.unit;
      return true;
    });
    const subset = { ...partition, rows };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, matrixSheet(subset, farm), '업체별 발주');
    let index = 0;
    for (const name of output.workbook.SheetNames) {
      XLSX.utils.book_append_sheet(workbook, output.workbook.Sheets[name], `${++index}_${name}`.slice(0, 31));
    }
    workbook.Workbook = { CalcPr: { calcMode: 'auto', fullCalcOnLoad: true } };
    return { ...output, workbook, filename: farm ? output.filename.replace(`${partition.scope.orderWeek}_Melody`, `${partition.scope.orderWeek}_${farm}`) : output.filename, preview: { headers: ['품목', '단위', ...partition.customers.map(customer => customer.label)], rows: rows.map(row => [countryOrderShortName(row), importUnitLabel(row.unit), ...partition.customers.map(customer => row.quantities[customer.key] ?? 0)]) } };
    });
  });
}
